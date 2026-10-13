-- =============================================================================
-- Administrator password reset.
-- An administrator may replace a staff account's password and hand over the new
-- one. The database authorizes the reset and records that the account must choose
-- its own password again; the server changes the password through the Auth API.
-- Design reference: docs/01-database-and-authorization-design.md §2.2, §5.4
-- =============================================================================

-- -----------------------------------------------------------------------------
-- public.prepare_password_reset — authorize the reset, returning the account to change.
-- -----------------------------------------------------------------------------
create function public.prepare_password_reset(p_staff_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
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

  if v_staff.user_id is null then
    raise exception 'ACCOUNT_NOT_FOUND'
      using errcode = 'P0002',
            hint = 'This staff member has no sign-in account yet.';
  end if;

  -- Changing your own password goes through the account's own password page,
  -- where the current session is re-verified.
  if v_staff.user_id = (select auth.uid()) then
    raise exception 'CANNOT_RESET_OWN_ACCOUNT'
      using errcode = '42501',
            hint = 'Change your own password from your account instead.';
  end if;

  if v_staff.status <> 'active' then
    raise exception 'STAFF_NOT_ACTIVE'
      using errcode = '22023',
            hint = 'Only active staff can have their password reset.';
  end if;

  return v_staff.user_id;
end;
$$;

revoke all on function public.prepare_password_reset(uuid) from public, anon;
grant execute on function public.prepare_password_reset(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- public.finish_password_reset — the password was changed; the account must now
-- choose its own. Separate from the authorization step so the flag is only set
-- once the Auth API has accepted the new password.
-- -----------------------------------------------------------------------------
create function public.finish_password_reset(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := public.prepare_password_reset(p_staff_id);

  perform set_config('app.audit_reason', 'Password reset by an administrator', true);

  update public.profiles
  set must_change_password = true
  where id = v_user_id;
end;
$$;

revoke all on function public.finish_password_reset(uuid) from public, anon;
grant execute on function public.finish_password_reset(uuid) to authenticated;
