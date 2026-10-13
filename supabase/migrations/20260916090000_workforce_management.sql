-- =============================================================================
-- Workforce management: account invitations, staff status changes, column-level
-- write grants, directory views and bulk rostering.
-- Design reference: docs/01-database-and-authorization-design.md §2.2, §5.4–5.7, §8
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Account activation tracking
-- -----------------------------------------------------------------------------
alter table public.profiles add column activated_at timestamptz;

create function private.mark_account_activated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set activated_at = new.email_confirmed_at
  where id = new.id and activated_at is null;
  return null;
end;
$$;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.mark_account_activated();

-- -----------------------------------------------------------------------------
-- account_invitations
-- Supabase's invite API cannot set app_metadata, and user_metadata is editable by
-- users, so it must never grant access. Instead the database authorizes an
-- invitation first; the provisioning trigger then consumes it when the Auth
-- service creates the user. Invitations are short-lived by design: they only
-- bridge the RPC call and the Auth API call that follows it.
-- -----------------------------------------------------------------------------
create table public.account_invitations (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals (id),
  staff_id     uuid not null,
  email        text not null,
  role         public.app_role not null,
  invited_by   uuid not null references public.profiles (id),
  expires_at   timestamptz not null default (now() + interval '15 minutes'),
  accepted_at  timestamptz,
  user_id      uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  constraint account_invitations_staff_fk foreign key (hospital_id, staff_id)
    references public.staff (hospital_id, id),
  constraint account_invitations_role_check check (role in ('hospital_admin', 'staff')),
  constraint account_invitations_email_check check (email = lower(email)),
  constraint account_invitations_acceptance_check check ((accepted_at is null) = (user_id is null))
);

create index account_invitations_pending_email_idx on public.account_invitations (email) where accepted_at is null;
create index account_invitations_staff_idx on public.account_invitations (staff_id, created_at desc);

create trigger account_invitations_audit
  after insert or update or delete on public.account_invitations
  for each row execute function private.audit_row_change();

alter table public.account_invitations enable row level security;
revoke all on public.account_invitations from anon, authenticated;
grant select on public.account_invitations to authenticated;

create policy account_invitations_select on public.account_invitations
  for select to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

-- -----------------------------------------------------------------------------
-- Provisioning trigger: trusted app_metadata (bootstrap) or a pending invitation.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata      jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_invitation    public.account_invitations%rowtype;
  v_role          public.app_role;
  v_hospital_id   uuid;
  v_staff_id      uuid;
  v_staff_name    text;
begin
  if nullif(v_metadata ->> 'role', '') is not null then
    v_role        := (v_metadata ->> 'role')::public.app_role;
    v_hospital_id := nullif(v_metadata ->> 'hospital_id', '')::uuid;
    v_staff_id    := nullif(v_metadata ->> 'staff_id', '')::uuid;
  else
    select * into v_invitation
    from public.account_invitations i
    where i.email = lower(new.email)
      and i.accepted_at is null
      and i.expires_at > now()
    order by i.created_at desc
    limit 1
    for update;

    if not found then
      raise exception 'ACCOUNT_PROVISIONING_REQUIRED'
        using errcode = '42501',
              hint = 'Accounts must be created through a hospital invitation or trusted provisioning.';
    end if;

    v_role        := v_invitation.role;
    v_hospital_id := v_invitation.hospital_id;
    v_staff_id    := v_invitation.staff_id;
  end if;

  if v_role = 'super_admin' then
    if v_hospital_id is not null or v_staff_id is not null then
      raise exception 'INVALID_PROVISIONING_METADATA'
        using errcode = '22023',
              hint = 'Super admin accounts cannot belong to a hospital or staff record.';
    end if;
  else
    if not exists (select 1 from public.hospitals h where h.id = v_hospital_id and h.is_active) then
      raise exception 'HOSPITAL_NOT_AVAILABLE'
        using errcode = '22023',
              hint = 'The hospital does not exist or is not active.';
    end if;

    if v_role = 'staff' and v_staff_id is null then
      raise exception 'STAFF_RECORD_REQUIRED'
        using errcode = '22023',
              hint = 'Staff accounts must be linked to a staff record.';
    end if;
  end if;

  if v_staff_id is not null then
    select s.first_name || ' ' || s.last_name
      into v_staff_name
    from public.staff s
    where s.id = v_staff_id
      and s.hospital_id = v_hospital_id
      and s.status = 'active'
      and s.user_id is null
      and (v_invitation.id is null or lower(s.email) = lower(new.email))
    for update;

    if not found then
      raise exception 'STAFF_RECORD_NOT_AVAILABLE'
        using errcode = '22023',
              hint = 'The staff record is not in this hospital, is not active, already has an account, or its email changed.';
    end if;
  end if;

  perform set_config('app.audit_source', 'account_provisioning', true);

  insert into public.profiles (id, hospital_id, role, display_name, activated_at)
  values (
    new.id,
    v_hospital_id,
    v_role,
    coalesce(v_staff_name, nullif(btrim(v_metadata ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    new.email_confirmed_at
  );

  if v_staff_id is not null then
    update public.staff set user_id = new.id where id = v_staff_id;
  end if;

  if v_invitation.id is not null then
    update public.account_invitations
    set accepted_at = now(), user_id = new.id
    where id = v_invitation.id;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- public.prepare_account_invitation — authorize (re)sending an invitation email.
-- Returns the address the server must send the Supabase invitation to.
-- -----------------------------------------------------------------------------
create function public.prepare_account_invitation(p_staff_id uuid, p_role public.app_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff        public.staff%rowtype;
  v_activated_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_staff from public.staff where id = p_staff_id for update;

  if not found or not coalesce(
    private.is_super_admin() or v_staff.hospital_id = private.admin_hospital_id(),
    false
  ) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_role not in ('staff', 'hospital_admin') then
    raise exception 'INVALID_ROLE'
      using errcode = '22023',
            hint = 'Invitations can grant the staff or hospital admin role only.';
  end if;

  if v_staff.status <> 'active' then
    raise exception 'STAFF_NOT_ACTIVE'
      using errcode = '22023',
            hint = 'Only active staff can be invited.';
  end if;

  if v_staff.email is null then
    raise exception 'STAFF_EMAIL_REQUIRED'
      using errcode = '22023',
            hint = 'Add an email address to the staff record before inviting.';
  end if;

  if v_staff.user_id is not null then
    select p.activated_at into v_activated_at from public.profiles p where p.id = v_staff.user_id;
    if v_activated_at is not null then
      raise exception 'ACCOUNT_ALREADY_ACTIVE'
        using errcode = '22023',
              hint = 'This staff member has already activated their account.';
    end if;
    -- The account exists but was never activated: the invitation email may be resent.
    return lower(v_staff.email);
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = lower(v_staff.email)) then
    raise exception 'EMAIL_IN_USE'
      using errcode = '22023',
            hint = 'Another account already uses this email address.';
  end if;

  -- Supersede any earlier invitation that was never used.
  update public.account_invitations
  set expires_at = now()
  where staff_id = v_staff.id and accepted_at is null and expires_at > now();

  insert into public.account_invitations (hospital_id, staff_id, email, role, invited_by)
  values (v_staff.hospital_id, v_staff.id, lower(v_staff.email), p_role, auth.uid());

  return lower(v_staff.email);
end;
$$;

revoke all on function public.prepare_account_invitation(uuid, public.app_role) from public, anon;
grant execute on function public.prepare_account_invitation(uuid, public.app_role) to authenticated;

-- -----------------------------------------------------------------------------
-- Staff: column-level write grants, linked email lock, status changes via RPC.
-- -----------------------------------------------------------------------------
revoke insert, update on public.staff from authenticated;
grant insert (
  hospital_id, department_id, employee_number, first_name, last_name,
  email, phone, job_title, employment_type, hire_date, photo_path
) on public.staff to authenticated;
grant update (
  department_id, employee_number, first_name, last_name,
  email, phone, job_title, employment_type, hire_date, photo_path
) on public.staff to authenticated;

create function private.prevent_linked_email_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is not null and lower(new.email) is distinct from lower(old.email) then
    raise exception 'EMAIL_LINKED_TO_ACCOUNT'
      using errcode = '22023',
            hint = 'This staff member has an account; their email address must match their sign-in email.';
  end if;
  return new;
end;
$$;

create trigger staff_lock_linked_email
  before update of email on public.staff
  for each row execute function private.prevent_linked_email_change();

-- Returns the number of future shift assignments cancelled.
create function public.change_staff_status(
  p_staff_id        uuid,
  p_status          public.staff_status,
  p_reason          text,
  p_effective_date  date default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff      public.staff%rowtype;
  v_today      date;
  v_cancelled  integer := 0;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'REASON_REQUIRED'
      using errcode = '22023',
            hint = 'Provide a reason of at least 5 characters.';
  end if;

  select * into v_staff from public.staff where id = p_staff_id for update;

  if not found or not coalesce(
    private.is_super_admin() or v_staff.hospital_id = private.admin_hospital_id(),
    false
  ) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_staff.user_id = auth.uid() then
    raise exception 'CANNOT_CHANGE_OWN_STATUS' using errcode = '42501';
  end if;

  if v_staff.status = p_status then
    raise exception 'STATUS_UNCHANGED' using errcode = '22023';
  end if;

  if p_status = 'terminated' then
    if p_effective_date is null then
      raise exception 'TERMINATION_DATE_REQUIRED' using errcode = '22023';
    end if;

    select (now() at time zone h.timezone)::date into v_today
    from public.hospitals h where h.id = v_staff.hospital_id;

    if p_effective_date > v_today then
      raise exception 'TERMINATION_DATE_IN_FUTURE'
        using errcode = '22023',
              hint = 'Record a termination on or after the date it takes effect.';
    end if;
  end if;

  perform set_config('app.audit_reason', btrim(p_reason), true);

  update public.staff
  set status = p_status,
      termination_date = case when p_status = 'terminated' then p_effective_date end
  where id = p_staff_id;

  if p_status <> 'active' then
    update public.shift_assignments
    set status = 'cancelled'
    where staff_id = p_staff_id
      and status = 'scheduled'
      and starts_at > now();
    get diagnostics v_cancelled = row_count;
  end if;

  return v_cancelled;
end;
$$;

revoke all on function public.change_staff_status(uuid, public.staff_status, text, date) from public, anon;
grant execute on function public.change_staff_status(uuid, public.staff_status, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Column-level write grants for master data (hospital ownership never changes).
-- -----------------------------------------------------------------------------
revoke insert, update on public.departments from authenticated;
grant insert (hospital_id, name, code, description, is_active) on public.departments to authenticated;
grant update (name, code, description, head_staff_id, is_active) on public.departments to authenticated;

revoke insert, update on public.shifts from authenticated;
grant insert (
  hospital_id, department_id, name, code, start_time, duration_minutes, break_minutes,
  late_grace_minutes, early_leave_grace_minutes, overtime_threshold_minutes, check_in_opens_minutes, is_active
) on public.shifts to authenticated;
grant update (
  department_id, name, code, start_time, duration_minutes, break_minutes,
  late_grace_minutes, early_leave_grace_minutes, overtime_threshold_minutes, check_in_opens_minutes, is_active
) on public.shifts to authenticated;

revoke update on public.shift_assignments from authenticated;
grant update (staff_id, shift_id, work_date, status, notes) on public.shift_assignments to authenticated;

-- -----------------------------------------------------------------------------
-- Directory views. security_invoker makes every underlying table apply the
-- caller's RLS, so a view never reveals more than the tables would.
-- -----------------------------------------------------------------------------
create view public.department_directory
with (security_invoker = true)
as
select
  d.id,
  d.hospital_id,
  d.name,
  d.code,
  d.description,
  d.is_active,
  d.head_staff_id,
  nullif(concat_ws(' ', head.first_name, head.last_name), '') as head_name,
  -- Counts only staff visible to the caller (complete for hospital admins).
  (select count(*)::integer from public.staff s where s.department_id = d.id and s.status = 'active') as active_staff_count,
  d.created_at,
  d.updated_at
from public.departments d
left join public.staff head on head.id = d.head_staff_id;

create view public.staff_directory
with (security_invoker = true)
as
select
  s.id,
  s.hospital_id,
  s.department_id,
  d.name as department_name,
  s.employee_number,
  s.first_name,
  s.last_name,
  s.first_name || ' ' || s.last_name as full_name,
  s.email,
  s.phone,
  s.job_title,
  s.employment_type,
  s.status,
  s.hire_date,
  s.termination_date,
  s.user_id,
  -- Account details are visible only to callers who can read the profile (admins, the user).
  p.role as account_role,
  p.is_active as account_is_active,
  p.activated_at as account_activated_at,
  lower(concat_ws(' ', s.first_name, s.last_name, s.employee_number, s.email, s.job_title)) as search_text,
  s.created_at,
  s.updated_at
from public.staff s
join public.departments d on d.id = s.department_id
left join public.profiles p on p.id = s.user_id;

revoke all on public.department_directory from anon, authenticated;
revoke all on public.staff_directory from anon, authenticated;
grant select on public.department_directory to authenticated;
grant select on public.staff_directory to authenticated;

-- -----------------------------------------------------------------------------
-- public.create_shift_assignments — bulk rostering.
-- Runs as the caller, so the shift_assignments RLS policies authorize every row.
-- Overlaps and inactive staff are skipped and reported; anything else aborts.
-- -----------------------------------------------------------------------------
create function public.create_shift_assignments(p_shift_id uuid, p_staff_ids uuid[], p_work_dates date[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hospital_id  uuid;
  v_staff_id     uuid;
  v_work_date    date;
  v_created      integer := 0;
  v_skipped      jsonb := '[]'::jsonb;
begin
  if coalesce(cardinality(p_staff_ids), 0) = 0 or coalesce(cardinality(p_work_dates), 0) = 0 then
    raise exception 'NOTHING_TO_ASSIGN' using errcode = '22023';
  end if;

  if cardinality(p_staff_ids) * cardinality(p_work_dates) > 2000 then
    raise exception 'TOO_MANY_ASSIGNMENTS'
      using errcode = '22023',
            hint = 'Assign at most 2,000 shifts at a time.';
  end if;

  select sh.hospital_id into v_hospital_id
  from public.shifts sh
  where sh.id = p_shift_id and sh.is_active;

  if not found then
    raise exception 'SHIFT_NOT_ACTIVE'
      using errcode = '22023',
            hint = 'The shift does not exist or is not active.';
  end if;

  for v_staff_id in select distinct unnest(p_staff_ids) order by 1 loop
    for v_work_date in select distinct unnest(p_work_dates) order by 1 loop
      begin
        insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date)
        values (v_hospital_id, v_staff_id, p_shift_id, v_work_date);
        v_created := v_created + 1;
      exception
        when exclusion_violation then
          v_skipped := v_skipped || jsonb_build_object('staff_id', v_staff_id, 'work_date', v_work_date, 'reason', 'overlap');
        when invalid_parameter_value then
          if sqlerrm <> 'STAFF_NOT_ACTIVE' then
            raise;
          end if;
          v_skipped := v_skipped || jsonb_build_object('staff_id', v_staff_id, 'work_date', v_work_date, 'reason', 'staff_not_active');
      end;
    end loop;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

revoke all on function public.create_shift_assignments(uuid, uuid[], date[]) from public, anon;
grant execute on function public.create_shift_assignments(uuid, uuid[], date[]) to authenticated;
