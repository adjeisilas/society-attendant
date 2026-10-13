-- =============================================================================
-- Attendance terminals: staff clock in and out at registered computers.
--
-- An administrator registers a computer at an attendance location. The computer keeps
-- a random key in an HTTP-only cookie and the database stores only its SHA-256 hash.
-- Staff sign in at the terminal with their own credentials, so check_in and check_out
-- still run as that person: identity comes from the session, the time from the server
-- clock, and the location from the terminal key. A staff member at home has a session
-- but no key; a terminal has a key but acts only for whoever has just signed in on it.
--
-- This replaces the location QR codes and the phone position checks, which are dropped.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- attendance_terminals
-- -----------------------------------------------------------------------------
create table public.attendance_terminals (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals (id),
  location_id  uuid not null,
  name         text not null,
  key_hash     text not null,
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles (id),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint attendance_terminals_key_hash_key unique (key_hash),
  constraint attendance_terminals_location_fk foreign key (hospital_id, location_id)
    references public.attendance_locations (hospital_id, id),
  constraint attendance_terminals_name_check check (char_length(name) between 2 and 80 and name = btrim(name)),
  constraint attendance_terminals_key_hash_check check (key_hash ~ '^[0-9a-f]{64}$')
);

create index attendance_terminals_location_idx on public.attendance_terminals (location_id, created_at desc);

create trigger attendance_terminals_set_updated_at
  before update on public.attendance_terminals
  for each row execute function private.set_updated_at();

create trigger attendance_terminals_audit
  after insert or update or delete on public.attendance_terminals
  for each row execute function private.audit_row_change();

/** Terminal keys are never stored; only this hash is. */
create function private.terminal_key_hash(p_terminal_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(p_terminal_key, 'sha256'), 'hex');
$$;

-- -----------------------------------------------------------------------------
-- The scan log records the terminal instead of a QR code and a phone position.
-- -----------------------------------------------------------------------------
drop function public.check_in(text, jsonb);
drop function public.check_out(text, jsonb);
drop function public.generate_location_qr_code(uuid);
drop function public.revoke_location_qr_code(uuid);
drop function private.resolve_scan(text, jsonb);
drop type private.scan_context;
drop function private.record_scan_event(uuid, uuid, uuid, uuid, public.scan_type, public.scan_outcome, text, uuid, uuid, jsonb);
drop function private.extract_qr_token(text);
drop function private.client_number(jsonb, text);
drop function private.distance_metres(numeric, numeric, numeric, numeric);

alter table public.attendance_events
  add column terminal_id uuid references public.attendance_terminals (id),
  drop column qr_code_id,
  drop column latitude,
  drop column longitude,
  drop column accuracy_m;

create index attendance_events_terminal_idx on public.attendance_events (terminal_id, occurred_at desc);

drop table public.attendance_qr_codes;
drop type public.qr_kind;

-- A terminal stays where it was installed, so locations no longer need a geofence and
-- hospitals no longer choose how a phone's reported position is used.
alter table public.attendance_locations
  drop constraint attendance_locations_geofence_check,
  drop constraint attendance_locations_latitude_check,
  drop constraint attendance_locations_longitude_check,
  drop constraint attendance_locations_radius_check,
  drop column latitude,
  drop column longitude,
  drop column geofence_radius_m;

alter table public.hospital_settings drop column geolocation_mode;
drop type public.geolocation_mode;

-- -----------------------------------------------------------------------------
-- Clock request helpers
-- -----------------------------------------------------------------------------

-- Everything a clock-in or clock-out needs, or the reason it cannot proceed.
create type private.clock_context as (
  user_id                     uuid,
  staff_id                    uuid,
  staff_name                  text,
  hospital_id                 uuid,
  department_id               uuid,
  timezone                    text,
  terminal_id                 uuid,
  location_id                 uuid,
  location_name               text,
  allow_unscheduled_check_in  boolean,
  min_session_minutes         integer,
  check_out_window_minutes    integer,
  half_day_threshold_percent  integer,
  rejection_code              text
);

/** Identifies the signed-in staff member and the terminal they are standing at. */
create function private.resolve_clock_request(p_terminal_key text)
returns private.clock_context
language plpgsql
security definer
set search_path = ''
as $$
declare
  v private.clock_context;
  v_staff     public.staff%rowtype;
  v_hospital  public.hospitals%rowtype;
  v_settings  public.hospital_settings%rowtype;
  v_terminal  public.attendance_terminals%rowtype;
  v_location  public.attendance_locations%rowtype;
begin
  v.user_id := auth.uid();
  if v.user_id is null then
    v.rejection_code := 'NOT_AUTHENTICATED';
    return v;
  end if;

  -- Locking the staff row serialises concurrent requests by the same person.
  select s.* into v_staff
  from public.staff s
  join public.profiles p on p.id = s.user_id
  where s.user_id = v.user_id and s.status = 'active' and p.is_active
  for update of s;

  if not found then
    v.rejection_code := 'STAFF_NOT_ACTIVE';
    return v;
  end if;

  v.staff_id := v_staff.id;
  v.staff_name := v_staff.first_name || ' ' || v_staff.last_name;
  v.hospital_id := v_staff.hospital_id;
  v.department_id := v_staff.department_id;

  select * into v_hospital from public.hospitals where id = v_staff.hospital_id and is_active;
  if not found then
    v.rejection_code := 'HOSPITAL_NOT_ACTIVE';
    return v;
  end if;
  v.timezone := v_hospital.timezone;

  select * into v_settings from public.hospital_settings where hospital_id = v_hospital.id;
  v.allow_unscheduled_check_in := v_settings.allow_unscheduled_check_in;
  v.min_session_minutes := v_settings.min_session_minutes;
  v.check_out_window_minutes := v_settings.check_out_window_minutes;
  v.half_day_threshold_percent := v_settings.half_day_threshold_percent;

  select * into v_terminal
  from public.attendance_terminals
  where key_hash = private.terminal_key_hash(p_terminal_key);

  if not found then
    v.rejection_code := 'TERMINAL_NOT_REGISTERED';
    return v;
  end if;
  v.terminal_id := v_terminal.id;
  v.location_id := v_terminal.location_id;

  if v_terminal.revoked_at is not null then
    v.rejection_code := 'TERMINAL_REVOKED';
    return v;
  end if;

  if v_terminal.hospital_id <> v_staff.hospital_id then
    v.rejection_code := 'WRONG_HOSPITAL';
    return v;
  end if;

  select * into v_location from public.attendance_locations where id = v_terminal.location_id;
  v.location_name := v_location.name;

  if not v_location.is_active then
    v.rejection_code := 'LOCATION_NOT_ACTIVE';
    return v;
  end if;

  return v;
end;
$$;

/** Appends to the scan log. Accepted when no rejection code is given. */
create function private.record_clock_event(
  p_context   private.clock_context,
  p_record_id uuid,
  p_scan_type public.scan_type,
  p_code      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only reachable without a session, which the grants below already prevent.
  if p_context.user_id is null then
    return;
  end if;

  insert into public.attendance_events (
    user_id, hospital_id, staff_id, attendance_record_id, scan_type, outcome, rejection_code,
    terminal_id, location_id, ip_address, user_agent
  )
  values (
    p_context.user_id, p_context.hospital_id, p_context.staff_id, p_record_id, p_scan_type,
    case when p_code is null then 'accepted'::public.scan_outcome else 'rejected'::public.scan_outcome end,
    p_code, p_context.terminal_id, p_context.location_id,
    private.request_ip(), private.request_user_agent()
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- public.check_in
-- -----------------------------------------------------------------------------
create function public.check_in(p_terminal_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context    private.clock_context;
  v_now        timestamptz := now();
  v_assignment public.shift_assignments%rowtype;
  v_shift      public.shifts%rowtype;
  v_outcome    private.attendance_outcome;
  v_record     public.attendance_records%rowtype;
  v_work_date  date;
  v_flags      public.attendance_flag[] := '{}';
begin
  v_context := private.resolve_clock_request(p_terminal_key);
  if v_context.rejection_code is not null then
    perform private.record_clock_event(v_context, null, 'check_in', v_context.rejection_code);
    return jsonb_build_object('ok', false, 'code', v_context.rejection_code);
  end if;

  if exists (select 1 from public.attendance_records r where r.staff_id = v_context.staff_id and r.closed_at is null) then
    perform private.record_clock_event(v_context, null, 'check_in', 'ALREADY_CHECKED_IN');
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CHECKED_IN');
  end if;

  -- The shift whose check-in window is open now; with back-to-back shifts, the nearest start.
  select sa.* into v_assignment
  from public.shift_assignments sa
  join public.shifts sh on sh.id = sa.shift_id
  where sa.staff_id = v_context.staff_id
    and sa.status = 'scheduled'
    and v_now >= sa.starts_at - make_interval(mins => sh.check_in_opens_minutes)
    and v_now <= sa.ends_at
    and not exists (select 1 from public.attendance_records r where r.shift_assignment_id = sa.id)
  order by abs(extract(epoch from (sa.starts_at - v_now)))
  limit 1;

  if found then
    select * into v_shift from public.shifts where id = v_assignment.shift_id;
    v_work_date := v_assignment.work_date;
  else
    if not coalesce(v_context.allow_unscheduled_check_in, false) then
      perform private.record_clock_event(v_context, null, 'check_in', 'NO_SHIFT');
      return jsonb_build_object('ok', false, 'code', 'NO_SHIFT');
    end if;
    v_flags := array_append(v_flags, 'unscheduled'::public.attendance_flag);
    v_work_date := (v_now at time zone v_context.timezone)::date;
  end if;

  v_outcome := private.compute_attendance_outcome(
    v_assignment.starts_at, v_assignment.ends_at, v_now, null,
    coalesce(v_shift.break_minutes, 0), coalesce(v_shift.late_grace_minutes, 0), v_context.half_day_threshold_percent
  );

  insert into public.attendance_records (
    hospital_id, staff_id, department_id, shift_assignment_id, work_date,
    scheduled_start, scheduled_end, break_minutes, late_grace_minutes, early_leave_grace_minutes,
    overtime_threshold_minutes, half_day_threshold_percent,
    check_in_at, check_in_location_id, status, late_minutes, flags
  )
  values (
    v_context.hospital_id, v_context.staff_id, v_context.department_id, v_assignment.id, v_work_date,
    v_assignment.starts_at, v_assignment.ends_at,
    coalesce(v_shift.break_minutes, 0), coalesce(v_shift.late_grace_minutes, 0),
    coalesce(v_shift.early_leave_grace_minutes, 0), coalesce(v_shift.overtime_threshold_minutes, 0),
    v_context.half_day_threshold_percent,
    v_now, v_context.location_id, v_outcome.status, v_outcome.late_minutes, v_flags
  )
  returning * into v_record;

  perform private.record_clock_event(v_context, v_record.id, 'check_in', null);

  return jsonb_build_object(
    'ok', true,
    'record_id', v_record.id,
    'staff_name', v_context.staff_name,
    'status', v_record.status,
    'late_minutes', v_record.late_minutes,
    'checked_in_at', v_record.check_in_at,
    'scheduled_start', v_record.scheduled_start,
    'scheduled_end', v_record.scheduled_end,
    'shift_name', v_shift.name,
    'location_name', v_context.location_name,
    'flags', to_jsonb(v_record.flags)
  );
exception
  when unique_violation then
    -- Two requests at once: the partial unique index is the final guard.
    perform private.record_clock_event(v_context, null, 'check_in', 'ALREADY_CHECKED_IN');
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CHECKED_IN');
end;
$$;

-- -----------------------------------------------------------------------------
-- public.check_out
-- -----------------------------------------------------------------------------
create function public.check_out(p_terminal_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context  private.clock_context;
  v_now      timestamptz := now();
  v_record   public.attendance_records%rowtype;
  v_outcome  private.attendance_outcome;
  v_deadline timestamptz;
begin
  v_context := private.resolve_clock_request(p_terminal_key);
  if v_context.rejection_code is not null then
    perform private.record_clock_event(v_context, null, 'check_out', v_context.rejection_code);
    return jsonb_build_object('ok', false, 'code', v_context.rejection_code);
  end if;

  select * into v_record
  from public.attendance_records
  where staff_id = v_context.staff_id and closed_at is null
  for update;

  if not found then
    perform private.record_clock_event(v_context, null, 'check_out', 'NO_OPEN_SESSION');
    return jsonb_build_object('ok', false, 'code', 'NO_OPEN_SESSION');
  end if;

  if v_now < v_record.check_in_at + make_interval(mins => coalesce(v_context.min_session_minutes, 0)) then
    perform private.record_clock_event(v_context, v_record.id, 'check_out', 'TOO_SOON');
    return jsonb_build_object('ok', false, 'code', 'TOO_SOON');
  end if;

  v_deadline := coalesce(v_record.scheduled_end, v_record.check_in_at)
    + make_interval(mins => coalesce(v_context.check_out_window_minutes, 480));
  if v_now > v_deadline then
    perform private.record_clock_event(v_context, v_record.id, 'check_out', 'CHECK_OUT_WINDOW_CLOSED');
    return jsonb_build_object('ok', false, 'code', 'CHECK_OUT_WINDOW_CLOSED');
  end if;

  v_outcome := private.compute_attendance_outcome(
    v_record.scheduled_start, v_record.scheduled_end, v_record.check_in_at, v_now,
    v_record.break_minutes, v_record.late_grace_minutes, v_record.half_day_threshold_percent
  );

  update public.attendance_records
  set check_out_at = v_now,
      check_out_location_id = v_context.location_id,
      closed_at = v_now,
      status = v_outcome.status,
      late_minutes = v_outcome.late_minutes,
      early_leave_minutes = v_outcome.early_leave_minutes,
      overtime_minutes = v_outcome.overtime_minutes,
      worked_minutes = v_outcome.worked_minutes
  where id = v_record.id
  returning * into v_record;

  perform private.record_clock_event(v_context, v_record.id, 'check_out', null);

  return jsonb_build_object(
    'ok', true,
    'record_id', v_record.id,
    'staff_name', v_context.staff_name,
    'status', v_record.status,
    'checked_in_at', v_record.check_in_at,
    'checked_out_at', v_record.check_out_at,
    'worked_minutes', v_record.worked_minutes,
    'overtime_minutes', v_record.overtime_minutes,
    'early_leave_minutes', v_record.early_leave_minutes,
    'is_overtime', v_record.is_overtime,
    'is_early_leave', v_record.is_early_leave,
    'location_name', v_context.location_name,
    'flags', to_jsonb(v_record.flags)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Terminal management
-- -----------------------------------------------------------------------------

/** Registers a computer at a location. The key is returned once and never stored. */
create function public.register_attendance_terminal(p_location_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.attendance_locations%rowtype;
  v_key      text;
  v_id       uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_location from public.attendance_locations where id = p_location_id;
  if not found or not coalesce(
    private.is_super_admin() or v_location.hospital_id = private.admin_hospital_id(),
    false
  ) then
    raise exception 'LOCATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not v_location.is_active then
    raise exception 'LOCATION_NOT_ACTIVE'
      using errcode = '22023', hint = 'Reactivate the location before registering a terminal.';
  end if;

  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'INVALID_TERMINAL_NAME' using errcode = '22023', hint = 'Use a name of 2 to 80 characters.';
  end if;

  -- base64url: '+' and '/' are replaced and the '=' padding is dropped.
  v_key := 't1.' || translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  perform set_config('app.audit_reason', 'Terminal registered', true);

  insert into public.attendance_terminals (hospital_id, location_id, name, key_hash, created_by)
  values (v_location.hospital_id, v_location.id, btrim(p_name), private.terminal_key_hash(v_key), auth.uid())
  returning id into v_id;

  return jsonb_build_object('terminal_id', v_id, 'key', v_key);
end;
$$;

create function public.revoke_attendance_terminal(p_terminal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terminal public.attendance_terminals%rowtype;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_terminal from public.attendance_terminals where id = p_terminal_id for update;
  if not found or not coalesce(
    private.is_super_admin() or v_terminal.hospital_id = private.admin_hospital_id(),
    false
  ) then
    raise exception 'TERMINAL_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_terminal.revoked_at is not null then
    return;
  end if;

  perform set_config('app.audit_reason', 'Terminal revoked', true);

  update public.attendance_terminals
  set revoked_at = now(), revoked_by = auth.uid()
  where id = p_terminal_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Called by the terminal page before anyone signs in, so these accept the anon role.
-- Both answer only for the key of an active terminal; a 256-bit key cannot be guessed.
-- -----------------------------------------------------------------------------

/** What the terminal screen shows, or null when the key is not an active terminal. */
create function public.terminal_context(p_terminal_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'terminal_id', t.id,
    'terminal_name', t.name,
    'location_name', l.name,
    'hospital_name', h.name,
    'timezone', h.timezone
  )
  from public.attendance_terminals t
  join public.attendance_locations l on l.id = t.location_id
  join public.hospitals h on h.id = t.hospital_id
  where t.key_hash = private.terminal_key_hash(p_terminal_key)
    and t.revoked_at is null
    and l.is_active
    and h.is_active;
$$;

/**
 * Staff may sign in at a terminal with their staff ID instead of their email. This
 * returns the sign-in email for an active staff member of the terminal's hospital, or
 * null. The password is still checked by Supabase Auth.
 */
create function public.terminal_sign_in_email(p_terminal_key text, p_employee_number text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_emails      text[];
begin
  select t.hospital_id into v_hospital_id
  from public.attendance_terminals t
  join public.attendance_locations l on l.id = t.location_id
  where t.key_hash = private.terminal_key_hash(p_terminal_key)
    and t.revoked_at is null
    and l.is_active;

  if not found then
    return null;
  end if;

  select array_agg(u.email::text) into v_emails
  from public.staff s
  join auth.users u on u.id = s.user_id
  where s.hospital_id = v_hospital_id
    and s.status = 'active'
    and lower(s.employee_number) = lower(btrim(p_employee_number));

  -- Staff IDs are matched without case, so refuse to guess between two that differ only in case.
  if coalesce(array_length(v_emails, 1), 0) <> 1 then
    return null;
  end if;
  return v_emails[1];
end;
$$;

-- -----------------------------------------------------------------------------
-- Overview for administrators, with when each terminal was last used.
-- -----------------------------------------------------------------------------
create view public.attendance_terminals_overview
with (security_invoker = true)
as
select
  t.id,
  t.hospital_id,
  t.location_id,
  l.name as location_name,
  t.name,
  t.created_at,
  creator.display_name as created_by_name,
  t.revoked_at,
  (
    select max(e.occurred_at)
    from public.attendance_events e
    where e.terminal_id = t.id and e.outcome = 'accepted'
  ) as last_used_at
from public.attendance_terminals t
join public.attendance_locations l on l.id = t.location_id
left join public.profiles creator on creator.id = t.created_by;

-- -----------------------------------------------------------------------------
-- Row Level Security & grants
-- -----------------------------------------------------------------------------

-- attendance_terminals: administrators read, never write directly, and never read the key hash.
alter table public.attendance_terminals enable row level security;
revoke all on public.attendance_terminals from anon, authenticated;
grant select (id, hospital_id, location_id, name, created_by, created_at, updated_at, revoked_at, revoked_by)
  on public.attendance_terminals to authenticated;

create policy attendance_terminals_select on public.attendance_terminals
  for select to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

revoke all on public.attendance_terminals_overview from anon, authenticated;
grant select on public.attendance_terminals_overview to authenticated;

revoke all on function public.check_in(text) from public, anon;
revoke all on function public.check_out(text) from public, anon;
revoke all on function public.register_attendance_terminal(uuid, text) from public, anon;
revoke all on function public.revoke_attendance_terminal(uuid) from public, anon;
revoke all on function public.terminal_context(text) from public;
revoke all on function public.terminal_sign_in_email(text, text) from public;

grant execute on function public.check_in(text) to authenticated;
grant execute on function public.check_out(text) to authenticated;
grant execute on function public.register_attendance_terminal(uuid, text) to authenticated;
grant execute on function public.revoke_attendance_terminal(uuid) to authenticated;
grant execute on function public.terminal_context(text) to anon, authenticated;
grant execute on function public.terminal_sign_in_email(text, text) to anon, authenticated;
