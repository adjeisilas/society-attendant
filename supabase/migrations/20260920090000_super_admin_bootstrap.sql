-- =============================================================================
-- Super admin bootstrap.
-- Supabase Auth's admin createUser inserts the auth.users row first and writes
-- custom app_metadata in a later update, so the provisioning trigger never sees
-- app_metadata.role in production. A super admin is instead authorized ahead of
-- time with a short-lived grant that only the secret key can create, and the
-- trigger consumes it when the account is inserted.
-- =============================================================================

create table private.super_admin_grants (
  email         text primary key,
  display_name  text not null,
  expires_at    timestamptz not null default now() + interval '15 minutes',
  created_at    timestamptz not null default now(),
  constraint super_admin_grants_email_check check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  constraint super_admin_grants_display_name_check check (char_length(display_name) between 1 and 200 and display_name = btrim(display_name))
);

revoke all on private.super_admin_grants from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- public.authorize_super_admin_signup — service role only (scripts/create-super-admin.ts).
-- -----------------------------------------------------------------------------
create function public.authorize_super_admin_signup(p_email text, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users u where lower(u.email) = lower(btrim(p_email))) then
    raise exception 'EMAIL_IN_USE'
      using errcode = '23505',
            hint = 'An account already uses this email address.';
  end if;

  insert into private.super_admin_grants (email, display_name)
  values (lower(btrim(p_email)), btrim(p_display_name))
  on conflict (email) do update
    set display_name = excluded.display_name,
        expires_at   = excluded.expires_at,
        created_at   = excluded.created_at;
end;
$$;

revoke execute on function public.authorize_super_admin_signup(text, text) from public, anon, authenticated;
grant execute on function public.authorize_super_admin_signup(text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Provisioning trigger: trusted app_metadata, a super admin grant, or a pending
-- invitation, in that order.
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

  insert into public.profiles (id, hospital_id, role, display_name, activated_at)
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
