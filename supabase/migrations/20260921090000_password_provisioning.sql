-- =============================================================================
-- Password provisioning.
-- An administrator may create a staff account with a password instead of emailing
-- an invitation. The account is authorized the same way (a pending invitation row),
-- and the person must choose their own password the first time they sign in.
-- Design reference: docs/01-database-and-authorization-design.md §2.2, §5.4
-- =============================================================================

alter table public.profiles add column must_change_password boolean not null default false;
alter table public.account_invitations add column requires_password_change boolean not null default false;

comment on column public.account_invitations.requires_password_change is
  'The administrator set an initial password; the account must replace it at first sign-in.';

-- -----------------------------------------------------------------------------
-- public.prepare_account_invitation — authorize an invitation email or an
-- administrator-set password. Returns the address the account is created with.
-- -----------------------------------------------------------------------------
-- Adding a parameter would leave the old signature behind as an overload.
drop function public.prepare_account_invitation(uuid, public.app_role);

create function public.prepare_account_invitation(
  p_staff_id uuid,
  p_role public.app_role,
  p_with_password boolean default false
)
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
    -- A password creates the account itself, so an existing one cannot be replaced here.
    if p_with_password then
      raise exception 'ACCOUNT_ALREADY_EXISTS'
        using errcode = '22023',
              hint = 'This staff member already has a sign-in account.';
    end if;

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

  insert into public.account_invitations (hospital_id, staff_id, email, role, invited_by, requires_password_change)
  values (v_staff.hospital_id, v_staff.id, lower(v_staff.email), p_role, auth.uid(), p_with_password);

  return lower(v_staff.email);
end;
$$;

revoke all on function public.prepare_account_invitation(uuid, public.app_role, boolean) from public, anon;
grant execute on function public.prepare_account_invitation(uuid, public.app_role, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- public.complete_password_change — called after the account sets its own password.
-- -----------------------------------------------------------------------------
create function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  update public.profiles
  set must_change_password = false
  where id = (select auth.uid()) and must_change_password;
end;
$$;

revoke execute on function public.complete_password_change() from public, anon;
grant execute on function public.complete_password_change() to authenticated;

-- -----------------------------------------------------------------------------
-- Provisioning trigger: carries the invitation's password requirement onto the profile.
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
  v_grant         private.super_admin_grants%rowtype;
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
    delete from private.super_admin_grants g
    where g.email = lower(new.email)
      and g.expires_at > now()
    returning g.* into v_grant;

    if v_grant.email is not null then
      v_role := 'super_admin';
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

  insert into public.profiles (id, hospital_id, role, display_name, activated_at, must_change_password)
  values (
    new.id,
    v_hospital_id,
    v_role,
    coalesce(
      v_staff_name,
      nullif(btrim(v_metadata ->> 'display_name'), ''),
      v_grant.display_name,
      split_part(new.email, '@', 1)
    ),
    new.email_confirmed_at,
    coalesce(v_invitation.requires_password_change, false)
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
