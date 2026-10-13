-- =============================================================================
-- Tenancy & identity: hospitals, hospital_settings, profiles, RLS helpers.
-- Design reference: docs/01-database-and-authorization-design.md §2, §5.1–5.3, §8
-- =============================================================================

create type public.app_role as enum ('super_admin', 'hospital_admin', 'staff');
create type public.geolocation_mode as enum ('off', 'record', 'enforce');

-- -----------------------------------------------------------------------------
-- hospitals
-- -----------------------------------------------------------------------------
create table public.hospitals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null,
  timezone    text not null,
  address     text,
  phone       text,
  email       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint hospitals_code_key unique (code),
  constraint hospitals_name_check check (char_length(name) between 2 and 200 and name = btrim(name)),
  constraint hospitals_code_check check (code ~ '^[A-Z0-9-]{2,20}$'),
  constraint hospitals_address_check check (char_length(address) <= 500),
  constraint hospitals_phone_check check (char_length(phone) <= 30),
  constraint hospitals_email_check check (char_length(email) <= 320 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create function private.validate_hospital_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'INVALID_TIMEZONE'
      using errcode = '22023',
            hint = format('"%s" is not a recognised IANA time zone.', new.timezone);
  end if;
  return new;
end;
$$;

create trigger hospitals_validate_timezone
  before insert or update of timezone on public.hospitals
  for each row execute function private.validate_hospital_timezone();

create trigger hospitals_set_updated_at
  before update on public.hospitals
  for each row execute function private.set_updated_at();

create trigger hospitals_audit
  after insert or update or delete on public.hospitals
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- hospital_settings (1:1 with hospitals, created automatically)
-- -----------------------------------------------------------------------------
create table public.hospital_settings (
  hospital_id                 uuid primary key references public.hospitals (id) on delete cascade,
  allow_unscheduled_check_in  boolean not null default false,
  min_session_minutes         integer not null default 10,
  check_out_window_minutes    integer not null default 480,
  half_day_threshold_percent  integer not null default 50,
  geolocation_mode            public.geolocation_mode not null default 'off',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint hospital_settings_min_session_check check (min_session_minutes between 0 and 120),
  constraint hospital_settings_check_out_window_check check (check_out_window_minutes between 60 and 1440),
  constraint hospital_settings_half_day_check check (half_day_threshold_percent between 1 and 99)
);

create function private.create_hospital_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.hospital_settings (hospital_id) values (new.id);
  return null;
end;
$$;

create trigger hospitals_create_settings
  after insert on public.hospitals
  for each row execute function private.create_hospital_settings();

create trigger hospital_settings_set_updated_at
  before update on public.hospital_settings
  for each row execute function private.set_updated_at();

create trigger hospital_settings_audit
  after insert or update or delete on public.hospital_settings
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- profiles (authorization identity, 1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  hospital_id   uuid references public.hospitals (id),
  role          public.app_role not null default 'staff',
  display_name  text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_hospital_id_id_key unique (hospital_id, id),
  constraint profiles_super_admin_scope_check check ((role = 'super_admin') = (hospital_id is null)),
  constraint profiles_display_name_check check (char_length(display_name) between 1 and 200 and display_name = btrim(display_name))
);

create index profiles_hospital_role_idx on public.profiles (hospital_id, role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS helper functions.
-- Every helper returns nothing for inactive accounts or inactive hospitals, so
-- deactivation takes effect on the next statement, regardless of JWT lifetime.
-- Always call them wrapped in (select ...) inside policies.
-- -----------------------------------------------------------------------------
create function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'super_admin'
      and p.is_active
  );
$$;

create function private.user_hospital_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.hospital_id
  from public.profiles p
  join public.hospitals h on h.id = p.hospital_id
  where p.id = (select auth.uid())
    and p.is_active
    and h.is_active;
$$;

create function private.admin_hospital_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.hospital_id
  from public.profiles p
  join public.hospitals h on h.id = p.hospital_id
  where p.id = (select auth.uid())
    and p.role = 'hospital_admin'
    and p.is_active
    and h.is_active;
$$;

grant execute on function private.is_super_admin() to authenticated;
grant execute on function private.user_hospital_id() to authenticated;
grant execute on function private.admin_hospital_id() to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security & grants
-- -----------------------------------------------------------------------------

-- hospitals: members read their own hospital; only super admins create or edit.
alter table public.hospitals enable row level security;
revoke all on public.hospitals from anon, authenticated;
grant select, insert, update on public.hospitals to authenticated;

create policy hospitals_select on public.hospitals
  for select to authenticated
  using ((select private.is_super_admin()) or id = (select private.user_hospital_id()));

create policy hospitals_insert on public.hospitals
  for insert to authenticated
  with check ((select private.is_super_admin()));

create policy hospitals_update on public.hospitals
  for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

-- hospital_settings: members read; hospital admins edit their own hospital.
alter table public.hospital_settings enable row level security;
revoke all on public.hospital_settings from anon, authenticated;
grant select on public.hospital_settings to authenticated;
grant update (
  allow_unscheduled_check_in,
  min_session_minutes,
  check_out_window_minutes,
  half_day_threshold_percent,
  geolocation_mode
) on public.hospital_settings to authenticated;

create policy hospital_settings_select on public.hospital_settings
  for select to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.user_hospital_id()));

create policy hospital_settings_update on public.hospital_settings
  for update to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()))
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

-- profiles: users read themselves; admins read accounts in scope.
-- Role, hospital and activation change only through public.update_account_access.
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_super_admin())
    or hospital_id = (select private.admin_hospital_id())
  );

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and is_active)
  with check (id = (select auth.uid()));

-- audit_logs: super admins read everything; hospital admins read their hospital.
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));
