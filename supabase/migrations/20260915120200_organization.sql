-- =============================================================================
-- Organization: departments, staff, account provisioning, account access RPC.
-- Design reference: docs/01-database-and-authorization-design.md §2.2, §5.4–5.5, §8
-- =============================================================================

create type public.staff_status as enum ('active', 'suspended', 'terminated');
create type public.employment_type as enum ('full_time', 'part_time', 'contract', 'locum', 'intern');

-- -----------------------------------------------------------------------------
-- departments
-- -----------------------------------------------------------------------------
create table public.departments (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references public.hospitals (id),
  name           text not null,
  code           text not null,
  description    text,
  head_staff_id  uuid,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint departments_hospital_id_id_key unique (hospital_id, id),
  constraint departments_hospital_code_key unique (hospital_id, code),
  constraint departments_name_check check (char_length(name) between 2 and 120 and name = btrim(name)),
  constraint departments_code_check check (code ~ '^[A-Z0-9-]{2,20}$'),
  constraint departments_description_check check (char_length(description) <= 1000)
);

create unique index departments_hospital_name_key on public.departments (hospital_id, lower(name));
create index departments_head_staff_id_idx on public.departments (head_staff_id);

-- -----------------------------------------------------------------------------
-- staff (employment record; a login is optional)
-- -----------------------------------------------------------------------------
create table public.staff (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null references public.hospitals (id),
  user_id           uuid,
  department_id     uuid not null,
  employee_number   text not null,
  first_name        text not null,
  last_name         text not null,
  email             text,
  phone             text,
  job_title         text not null,
  employment_type   public.employment_type not null,
  status            public.staff_status not null default 'active',
  hire_date         date not null,
  termination_date  date,
  photo_path        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint staff_hospital_id_id_key unique (hospital_id, id),
  constraint staff_user_id_key unique (user_id),
  constraint staff_hospital_employee_number_key unique (hospital_id, employee_number),
  -- Composite keys keep every reference inside the same hospital.
  constraint staff_user_fk foreign key (hospital_id, user_id)
    references public.profiles (hospital_id, id),
  constraint staff_department_fk foreign key (hospital_id, department_id)
    references public.departments (hospital_id, id),
  constraint staff_employee_number_check check (employee_number ~ '^[A-Za-z0-9/._-]{1,30}$'),
  constraint staff_first_name_check check (char_length(first_name) between 1 and 100 and first_name = btrim(first_name)),
  constraint staff_last_name_check check (char_length(last_name) between 1 and 100 and last_name = btrim(last_name)),
  constraint staff_email_check check (char_length(email) <= 320 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint staff_phone_check check (char_length(phone) <= 30),
  constraint staff_job_title_check check (char_length(job_title) between 2 and 120 and job_title = btrim(job_title)),
  constraint staff_photo_path_check check (char_length(photo_path) <= 500),
  constraint staff_termination_date_check check (termination_date is null or termination_date >= hire_date),
  constraint staff_terminated_has_date_check check ((status = 'terminated') = (termination_date is not null))
);

create unique index staff_hospital_email_key on public.staff (hospital_id, lower(email)) where email is not null;
create index staff_department_id_idx on public.staff (department_id);
create index staff_hospital_status_idx on public.staff (hospital_id, status);

alter table public.departments
  add constraint departments_head_staff_fk foreign key (hospital_id, head_staff_id)
    references public.staff (hospital_id, id);

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function private.set_updated_at();

create trigger departments_audit
  after insert or update or delete on public.departments
  for each row execute function private.audit_row_change();

create trigger staff_set_updated_at
  before update on public.staff
  for each row execute function private.set_updated_at();

create trigger staff_audit
  after insert or update or delete on public.staff
  for each row execute function private.audit_row_change();

-- A staff member who stops being active loses their account access immediately.
-- Reactivating the staff record does not silently re-enable the account.
create function private.deactivate_account_for_inactive_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null and old.status = 'active' and new.status <> 'active' then
    update public.profiles set is_active = false where id = new.user_id and is_active;
  end if;
  return null;
end;
$$;

create trigger staff_deactivate_account
  after update of status on public.staff
  for each row execute function private.deactivate_account_for_inactive_staff();

-- -----------------------------------------------------------------------------
-- RLS helpers that depend on staff and departments
-- -----------------------------------------------------------------------------
create function private.user_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.staff s
  join public.profiles p on p.id = s.user_id
  join public.hospitals h on h.id = s.hospital_id
  where s.user_id = (select auth.uid())
    and s.status = 'active'
    and p.is_active
    and h.is_active;
$$;

create function private.headed_department_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(d.id), '{}'::uuid[])
  from public.departments d
  where d.head_staff_id = (select private.user_staff_id())
    and d.is_active;
$$;

grant execute on function private.user_staff_id() to authenticated;
grant execute on function private.headed_department_ids() to authenticated;

-- -----------------------------------------------------------------------------
-- Account provisioning.
-- Accounts are created only by trusted server code (Auth admin API) that sets
-- app_metadata: { role, hospital_id?, staff_id?, display_name? }.
-- app_metadata cannot be edited by users, unlike user_metadata.
-- Any failure here aborts the auth.users insert, so no orphan accounts exist.
-- -----------------------------------------------------------------------------
create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata      jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_role          public.app_role;
  v_hospital_id   uuid;
  v_staff_id      uuid;
  v_staff_name    text;
begin
  if nullif(v_metadata ->> 'role', '') is null then
    raise exception 'ACCOUNT_PROVISIONING_REQUIRED'
      using errcode = '42501',
            hint = 'Accounts must be created through the invitation flow with app_metadata.role set.';
  end if;

  v_role        := (v_metadata ->> 'role')::public.app_role;
  v_hospital_id := nullif(v_metadata ->> 'hospital_id', '')::uuid;
  v_staff_id    := nullif(v_metadata ->> 'staff_id', '')::uuid;

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
    for update;

    if not found then
      raise exception 'STAFF_RECORD_NOT_AVAILABLE'
        using errcode = '22023',
              hint = 'The staff record is not in this hospital, is not active, or already has an account.';
    end if;
  end if;

  perform set_config('app.audit_source', 'account_provisioning', true);

  insert into public.profiles (id, hospital_id, role, display_name)
  values (
    new.id,
    v_hospital_id,
    v_role,
    coalesce(v_staff_name, nullif(btrim(v_metadata ->> 'display_name'), ''), split_part(new.email, '@', 1))
  );

  if v_staff_id is not null then
    update public.staff set user_id = new.id where id = v_staff_id;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- public.update_account_access — change role and/or activation of an account.
-- -----------------------------------------------------------------------------
create function public.update_account_access(
  p_user_id    uuid,
  p_role       public.app_role,
  p_is_active  boolean,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id  uuid := auth.uid();
  v_target    public.profiles%rowtype;
begin
  if v_actor_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'REASON_REQUIRED'
      using errcode = '22023',
            hint = 'Provide a reason of at least 5 characters.';
  end if;

  if p_user_id = v_actor_id then
    raise exception 'CANNOT_CHANGE_OWN_ACCESS' using errcode = '42501';
  end if;

  select * into v_target from public.profiles where id = p_user_id for update;

  -- Same error for "missing" and "out of scope" so account ids cannot be probed.
  -- coalesce is required: admin_hospital_id() is null for non-admins, and a null
  -- condition would otherwise skip this check instead of failing it.
  if not found or not coalesce(
    private.is_super_admin()
    or (v_target.role <> 'super_admin' and v_target.hospital_id = private.admin_hospital_id()),
    false
  ) then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if (p_role = 'super_admin') <> (v_target.role = 'super_admin') then
    raise exception 'SUPER_ADMIN_CHANGE_NOT_ALLOWED'
      using errcode = '42501',
            hint = 'Super admin status can only be granted through account provisioning.';
  end if;

  if p_role = 'staff' and not exists (select 1 from public.staff s where s.user_id = p_user_id) then
    raise exception 'STAFF_RECORD_REQUIRED'
      using errcode = '22023',
            hint = 'Only accounts linked to a staff record can have the staff role.';
  end if;

  perform set_config('app.audit_reason', btrim(p_reason), true);

  update public.profiles
  set role = p_role,
      is_active = p_is_active
  where id = p_user_id;
end;
$$;

revoke all on function public.update_account_access(uuid, public.app_role, boolean, text) from public, anon;
grant execute on function public.update_account_access(uuid, public.app_role, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security & grants
-- -----------------------------------------------------------------------------

-- departments: every member of the hospital can read; admins write.
alter table public.departments enable row level security;
revoke all on public.departments from anon, authenticated;
grant select, insert, update on public.departments to authenticated;

create policy departments_select on public.departments
  for select to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.user_hospital_id()));

create policy departments_insert on public.departments
  for insert to authenticated
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

create policy departments_update on public.departments
  for update to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()))
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

-- staff: admins see the hospital, department heads their departments, staff themselves.
alter table public.staff enable row level security;
revoke all on public.staff from anon, authenticated;
grant select, insert, update on public.staff to authenticated;

create policy staff_select on public.staff
  for select to authenticated
  using (
    (select private.is_super_admin())
    or hospital_id = (select private.admin_hospital_id())
    or department_id = any ((select private.headed_department_ids())::uuid[])
    or id = (select private.user_staff_id())
  );

create policy staff_insert on public.staff
  for insert to authenticated
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

create policy staff_update on public.staff
  for update to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()))
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));
