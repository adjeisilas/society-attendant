-- =============================================================================
-- Attendance: locations, QR codes, the attendance engine and its scheduled job.
-- Design reference: docs/01-database-and-authorization-design.md §5.8–5.11, §6, §7
--
-- The browser never supplies a time, a staff id or a location id: it sends only the
-- scanned payload. Identity comes from the session, the clock from the server, and
-- the location from resolving the QR token here.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create type public.attendance_status as enum ('present', 'late', 'absent', 'on_leave', 'off_day', 'half_day');
create type public.attendance_flag as enum ('unscheduled', 'missed_check_out', 'leave_conflict', 'outside_geofence');
create type public.scan_type as enum ('check_in', 'check_out');
create type public.scan_outcome as enum ('accepted', 'rejected');
create type public.qr_kind as enum ('static');

-- -----------------------------------------------------------------------------
-- attendance_locations
-- -----------------------------------------------------------------------------
create table public.attendance_locations (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references public.hospitals (id),
  name               text not null,
  description        text,
  latitude           numeric(9, 6),
  longitude          numeric(9, 6),
  geofence_radius_m  integer,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint attendance_locations_hospital_id_id_key unique (hospital_id, id),
  constraint attendance_locations_name_check check (char_length(name) between 2 and 120 and name = btrim(name)),
  constraint attendance_locations_description_check check (char_length(description) <= 500),
  constraint attendance_locations_latitude_check check (latitude between -90 and 90),
  constraint attendance_locations_longitude_check check (longitude between -180 and 180),
  constraint attendance_locations_radius_check check (geofence_radius_m between 10 and 5000),
  -- A geofence is either fully defined or not defined at all.
  constraint attendance_locations_geofence_check check (num_nulls(latitude, longitude, geofence_radius_m) in (0, 3))
);

create unique index attendance_locations_hospital_name_key on public.attendance_locations (hospital_id, lower(name));

create trigger attendance_locations_set_updated_at
  before update on public.attendance_locations
  for each row execute function private.set_updated_at();

create trigger attendance_locations_audit
  after insert or update or delete on public.attendance_locations
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- attendance_qr_codes
-- A QR code identifies a location, never a staff member. The token is opaque and
-- versioned, so rotating codes ("v2.…") can be added without changing the scan API.
-- -----------------------------------------------------------------------------
create table public.attendance_qr_codes (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals (id),
  location_id  uuid not null,
  kind         public.qr_kind not null default 'static',
  token        text not null,
  valid_from   timestamptz not null default now(),
  valid_until  timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles (id),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  constraint attendance_qr_codes_token_key unique (token),
  constraint attendance_qr_codes_location_fk foreign key (hospital_id, location_id)
    references public.attendance_locations (hospital_id, id),
  constraint attendance_qr_codes_token_check check (token ~ '^v1\.[A-Za-z0-9_-]{43}$'),
  constraint attendance_qr_codes_validity_check check (valid_until is null or valid_until > valid_from)
);

-- One usable code per location; regenerating revokes the previous one.
create unique index attendance_qr_codes_active_location_key on public.attendance_qr_codes (location_id) where revoked_at is null;
create index attendance_qr_codes_location_idx on public.attendance_qr_codes (location_id, created_at desc);

create trigger attendance_qr_codes_audit
  after insert or update or delete on public.attendance_qr_codes
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- attendance_records: one row per attendance session.
-- Each record snapshots the schedule and the policy values it was judged by, so a
-- later change to a shift template never rewrites history.
-- -----------------------------------------------------------------------------
create table public.attendance_records (
  id                          uuid primary key default gen_random_uuid(),
  hospital_id                 uuid not null references public.hospitals (id),
  staff_id                    uuid not null,
  department_id               uuid not null,
  shift_assignment_id         uuid,
  work_date                   date not null,
  scheduled_start             timestamptz,
  scheduled_end               timestamptz,
  break_minutes               integer not null default 0,
  late_grace_minutes          integer not null default 0,
  early_leave_grace_minutes   integer not null default 0,
  overtime_threshold_minutes  integer not null default 0,
  half_day_threshold_percent  integer not null default 50,
  check_in_at                 timestamptz,
  check_out_at                timestamptz,
  check_in_location_id        uuid,
  check_out_location_id       uuid,
  status                      public.attendance_status not null,
  late_minutes                integer not null default 0,
  early_leave_minutes         integer not null default 0,
  overtime_minutes            integer not null default 0,
  worked_minutes              integer,
  is_late                     boolean generated always as (late_minutes > late_grace_minutes) stored,
  is_early_leave              boolean generated always as (early_leave_minutes > early_leave_grace_minutes) stored,
  is_overtime                 boolean generated always as (overtime_minutes > 0 and overtime_minutes >= overtime_threshold_minutes) stored,
  flags                       public.attendance_flag[] not null default '{}',
  closed_at                   timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint attendance_records_hospital_id_id_key unique (hospital_id, id),
  constraint attendance_records_assignment_key unique (shift_assignment_id),
  constraint attendance_records_staff_fk foreign key (hospital_id, staff_id)
    references public.staff (hospital_id, id),
  constraint attendance_records_department_fk foreign key (hospital_id, department_id)
    references public.departments (hospital_id, id),
  constraint attendance_records_assignment_fk foreign key (hospital_id, shift_assignment_id)
    references public.shift_assignments (hospital_id, id),
  constraint attendance_records_check_in_location_fk foreign key (hospital_id, check_in_location_id)
    references public.attendance_locations (hospital_id, id),
  constraint attendance_records_check_out_location_fk foreign key (hospital_id, check_out_location_id)
    references public.attendance_locations (hospital_id, id),
  -- off_day is produced by reports for staff with no assignment; it is never stored.
  constraint attendance_records_status_check check (status <> 'off_day'),
  constraint attendance_records_absence_check check ((check_in_at is null) = (status in ('absent', 'on_leave'))),
  constraint attendance_records_order_check check (check_out_at is null or (check_in_at is not null and check_out_at > check_in_at)),
  constraint attendance_records_schedule_check check ((scheduled_start is null) = (scheduled_end is null)),
  constraint attendance_records_unscheduled_check check (shift_assignment_id is not null or 'unscheduled' = any (flags)),
  constraint attendance_records_minutes_check check (
    late_minutes >= 0 and early_leave_minutes >= 0 and overtime_minutes >= 0
    and (worked_minutes is null or worked_minutes >= 0)
  )
);

-- At most one open session per staff member: the last defence against double check-in.
create unique index attendance_records_open_session_key on public.attendance_records (staff_id) where closed_at is null;
create index attendance_records_hospital_work_date_idx on public.attendance_records (hospital_id, work_date, status);
create index attendance_records_department_work_date_idx on public.attendance_records (department_id, work_date);
create index attendance_records_staff_work_date_idx on public.attendance_records (staff_id, work_date desc);
create index attendance_records_flagged_idx on public.attendance_records (hospital_id, work_date) where flags <> '{}';

create trigger attendance_records_set_updated_at
  before update on public.attendance_records
  for each row execute function private.set_updated_at();

create trigger attendance_records_audit
  after insert or update or delete on public.attendance_records
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- attendance_events: append-only log of every scan, accepted or rejected.
-- Geolocation is reported by the browser and is evidence only, never a decision.
-- -----------------------------------------------------------------------------
create table public.attendance_events (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null,
  hospital_id           uuid,
  staff_id              uuid,
  attendance_record_id  uuid references public.attendance_records (id),
  scan_type             public.scan_type not null,
  outcome               public.scan_outcome not null,
  rejection_code        text,
  qr_code_id            uuid references public.attendance_qr_codes (id),
  location_id           uuid references public.attendance_locations (id),
  occurred_at           timestamptz not null default now(),
  ip_address            inet,
  user_agent            text,
  latitude              numeric(9, 6),
  longitude             numeric(9, 6),
  accuracy_m            numeric(8, 1),
  constraint attendance_events_rejection_check check ((outcome = 'rejected') = (rejection_code is not null)),
  constraint attendance_events_rejection_code_check check (char_length(rejection_code) <= 60),
  constraint attendance_events_user_agent_check check (char_length(user_agent) <= 400)
);

create index attendance_events_record_idx on public.attendance_events (attendance_record_id);
create index attendance_events_hospital_occurred_idx on public.attendance_events (hospital_id, occurred_at desc);
create index attendance_events_staff_occurred_idx on public.attendance_events (staff_id, occurred_at desc);
create index attendance_events_rejected_idx on public.attendance_events (hospital_id, occurred_at desc) where outcome = 'rejected';

create trigger attendance_events_prevent_modification
  before update or delete on public.attendance_events
  for each row execute function private.prevent_modification();

create trigger attendance_events_prevent_truncate
  before truncate on public.attendance_events
  for each statement execute function private.prevent_modification();

-- -----------------------------------------------------------------------------
-- Scan helpers
-- -----------------------------------------------------------------------------

/** Accepts the raw token or the scan URL that carries it. */
create function private.extract_qr_token(p_payload text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_token text;
begin
  if p_payload is null then
    return null;
  end if;

  v_token := btrim(p_payload);
  if v_token ~ '^https?://' then
    v_token := (regexp_match(v_token, '[?&]c=([^&#]+)'))[1];
  end if;

  if v_token ~ '^v1\.[A-Za-z0-9_-]{43}$' then
    return v_token;
  end if;
  return null;
end;
$$;

create function private.request_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_ip text := btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1));
begin
  if v_ip = '' then
    return null;
  end if;
  return v_ip::inet;
exception
  when others then
    return null;
end;
$$;

create function private.request_user_agent()
returns text
language sql
stable
set search_path = ''
as $$
  select left(nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent', 400);
$$;

create function private.client_number(p_client jsonb, p_key text)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
begin
  return (p_client ->> p_key)::numeric;
exception
  when others then
    return null;
end;
$$;

/** Great-circle distance in metres. */
create function private.distance_metres(p_lat1 numeric, p_lon1 numeric, p_lat2 numeric, p_lon2 numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (
    6371000 * 2 * asin(sqrt(
      power(sin(radians((p_lat2 - p_lat1)::double precision) / 2), 2)
      + cos(radians(p_lat1::double precision)) * cos(radians(p_lat2::double precision))
        * power(sin(radians((p_lon2 - p_lon1)::double precision) / 2), 2)
    ))
  )::numeric;
$$;

create function private.record_scan_event(
  p_user_id     uuid,
  p_hospital_id uuid,
  p_staff_id    uuid,
  p_record_id   uuid,
  p_scan_type   public.scan_type,
  p_outcome     public.scan_outcome,
  p_code        text,
  p_qr_code_id  uuid,
  p_location_id uuid,
  p_client      jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attendance_events (
    user_id, hospital_id, staff_id, attendance_record_id, scan_type, outcome, rejection_code,
    qr_code_id, location_id, ip_address, user_agent, latitude, longitude, accuracy_m
  )
  values (
    p_user_id, p_hospital_id, p_staff_id, p_record_id, p_scan_type, p_outcome, p_code,
    p_qr_code_id, p_location_id, private.request_ip(), private.request_user_agent(),
    private.client_number(p_client, 'latitude'),
    private.client_number(p_client, 'longitude'),
    private.client_number(p_client, 'accuracy')
  );
end;
$$;

-- Everything a scan needs, or the reason it cannot proceed.
create type private.scan_context as (
  user_id                     uuid,
  staff_id                    uuid,
  hospital_id                 uuid,
  department_id               uuid,
  timezone                    text,
  qr_code_id                  uuid,
  location_id                 uuid,
  location_name               text,
  flags                       public.attendance_flag[],
  allow_unscheduled_check_in  boolean,
  min_session_minutes         integer,
  check_out_window_minutes    integer,
  half_day_threshold_percent  integer,
  rejection_code              text
);

/** Authenticates the scanner, resolves the QR token and applies the geofence policy. */
create function private.resolve_scan(p_payload text, p_client jsonb)
returns private.scan_context
language plpgsql
security definer
set search_path = ''
as $$
declare
  v private.scan_context;
  v_staff     public.staff%rowtype;
  v_hospital  public.hospitals%rowtype;
  v_settings  public.hospital_settings%rowtype;
  v_qr        public.attendance_qr_codes%rowtype;
  v_location  public.attendance_locations%rowtype;
  v_token     text;
  v_latitude  numeric;
  v_longitude numeric;
  v_distance  numeric;
begin
  v.flags := '{}';
  v.user_id := auth.uid();
  if v.user_id is null then
    v.rejection_code := 'NOT_AUTHENTICATED';
    return v;
  end if;

  -- Locking the staff row serialises concurrent scans by the same person.
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

  v_token := private.extract_qr_token(p_payload);
  if v_token is null then
    v.rejection_code := 'QR_INVALID';
    return v;
  end if;

  select * into v_qr from public.attendance_qr_codes where token = v_token;
  if not found then
    v.rejection_code := 'QR_INVALID';
    return v;
  end if;
  v.qr_code_id := v_qr.id;

  if v_qr.revoked_at is not null then
    v.rejection_code := 'QR_REVOKED';
    return v;
  end if;

  if now() < v_qr.valid_from or (v_qr.valid_until is not null and now() >= v_qr.valid_until) then
    v.rejection_code := 'QR_EXPIRED';
    return v;
  end if;

  select * into v_location from public.attendance_locations where id = v_qr.location_id;
  v.location_id := v_location.id;
  v.location_name := v_location.name;

  if v_location.hospital_id <> v_staff.hospital_id then
    v.rejection_code := 'WRONG_HOSPITAL';
    return v;
  end if;

  if not v_location.is_active then
    v.rejection_code := 'LOCATION_NOT_ACTIVE';
    return v;
  end if;

  -- Reported position is spoofable, so it is evidence by default and only blocks
  -- a scan when the hospital has chosen to enforce it.
  if v_location.latitude is not null and v_settings.geolocation_mode <> 'off' then
    v_latitude := private.client_number(p_client, 'latitude');
    v_longitude := private.client_number(p_client, 'longitude');

    if v_latitude is null or v_longitude is null then
      if v_settings.geolocation_mode = 'enforce' then
        v.rejection_code := 'LOCATION_REQUIRED';
        return v;
      end if;
    else
      v_distance := private.distance_metres(v_location.latitude, v_location.longitude, v_latitude, v_longitude);
      if v_distance > v_location.geofence_radius_m then
        if v_settings.geolocation_mode = 'enforce' then
          v.rejection_code := 'OUTSIDE_GEOFENCE';
          return v;
        end if;
        v.flags := array_append(v.flags, 'outside_geofence'::public.attendance_flag);
      end if;
    end if;
  end if;

  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- The shared outcome calculation. Check-out, the scheduled job and (from Phase 6)
-- attendance corrections all derive status and minutes here.
-- -----------------------------------------------------------------------------
create type private.attendance_outcome as (
  status               public.attendance_status,
  late_minutes         integer,
  early_leave_minutes  integer,
  overtime_minutes     integer,
  worked_minutes       integer
);

create function private.compute_attendance_outcome(
  p_scheduled_start            timestamptz,
  p_scheduled_end              timestamptz,
  p_check_in_at                timestamptz,
  p_check_out_at               timestamptz,
  p_break_minutes              integer,
  p_late_grace_minutes         integer,
  p_half_day_threshold_percent integer
)
returns private.attendance_outcome
language plpgsql
immutable
set search_path = ''
as $$
declare
  v private.attendance_outcome;
  v_net_scheduled integer;
begin
  v.late_minutes := 0;
  v.early_leave_minutes := 0;
  v.overtime_minutes := 0;

  if p_check_in_at is null then
    v.status := 'absent';
    return v;
  end if;

  if p_scheduled_start is not null then
    v.late_minutes := greatest(0, floor(extract(epoch from (p_check_in_at - p_scheduled_start)) / 60)::integer);
  end if;

  if p_check_out_at is not null then
    v.worked_minutes := greatest(
      0,
      floor(extract(epoch from (p_check_out_at - p_check_in_at)) / 60)::integer - coalesce(p_break_minutes, 0)
    );
    if p_scheduled_end is not null then
      v.early_leave_minutes := greatest(0, floor(extract(epoch from (p_scheduled_end - p_check_out_at)) / 60)::integer);
      v.overtime_minutes := greatest(0, floor(extract(epoch from (p_check_out_at - p_scheduled_end)) / 60)::integer);
    end if;
  end if;

  v.status := case when v.late_minutes > coalesce(p_late_grace_minutes, 0) then 'late' else 'present' end;

  -- A session much shorter than the scheduled time is recorded as a half day.
  if p_scheduled_start is not null and p_scheduled_end is not null and v.worked_minutes is not null then
    v_net_scheduled := greatest(
      0,
      floor(extract(epoch from (p_scheduled_end - p_scheduled_start)) / 60)::integer - coalesce(p_break_minutes, 0)
    );
    if v_net_scheduled > 0 and v.worked_minutes * 100 < v_net_scheduled * coalesce(p_half_day_threshold_percent, 50) then
      v.status := 'half_day';
    end if;
  end if;

  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- public.check_in
-- -----------------------------------------------------------------------------
create function public.check_in(p_payload text, p_client jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan       private.scan_context;
  v_now        timestamptz := now();
  v_assignment public.shift_assignments%rowtype;
  v_shift      public.shifts%rowtype;
  v_outcome    private.attendance_outcome;
  v_record     public.attendance_records%rowtype;
  v_work_date  date;
begin
  v_scan := private.resolve_scan(p_payload, p_client);
  if v_scan.rejection_code is not null then
    perform private.record_scan_event(v_scan.user_id, v_scan.hospital_id, v_scan.staff_id, null, 'check_in', 'rejected',
      v_scan.rejection_code, v_scan.qr_code_id, v_scan.location_id, p_client);
    return jsonb_build_object('ok', false, 'code', v_scan.rejection_code);
  end if;

  if exists (select 1 from public.attendance_records r where r.staff_id = v_scan.staff_id and r.closed_at is null) then
    perform private.record_scan_event(v_scan.user_id, v_scan.hospital_id, v_scan.staff_id, null, 'check_in', 'rejected',
      'ALREADY_CHECKED_IN', v_scan.qr_code_id, v_scan.location_id, p_client);
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CHECKED_IN');
  end if;

  -- The shift whose check-in window is open now; with back-to-back shifts, the nearest start.
  select sa.* into v_assignment
  from public.shift_assignments sa
  join public.shifts sh on sh.id = sa.shift_id
  where sa.staff_id = v_scan.staff_id
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
    if not coalesce(v_scan.allow_unscheduled_check_in, false) then
      perform private.record_scan_event(v_scan.user_id, v_scan.hospital_id, v_scan.staff_id, null, 'check_in', 'rejected',
        'NO_SHIFT', v_scan.qr_code_id, v_scan.location_id, p_client);
      return jsonb_build_object('ok', false, 'code', 'NO_SHIFT');
    end if;
    v_scan.flags := array_append(v_scan.flags, 'unscheduled'::public.attendance_flag);
    v_work_date := (v_now at time zone v_scan.timezone)::date;
  end if;

  v_outcome := private.compute_attendance_outcome(
    v_assignment.starts_at, v_assignment.ends_at, v_now, null,
    coalesce(v_shift.break_minutes, 0), coalesce(v_shift.late_grace_minutes, 0), v_scan.half_day_threshold_percent
  );

  insert into public.attendance_records (
    hospital_id, staff_id, department_id, shift_assignment_id, work_date,
    scheduled_start, scheduled_end, break_minutes, late_grace_minutes, early_leave_grace_minutes,
    overtime_threshold_minutes, half_day_threshold_percent,
    check_in_at, check_in_location_id, status, late_minutes, flags
  )
  values (
    v_scan.hospital_id, v_scan.staff_id, v_scan.department_id, v_assignment.id, v_work_date,
    v_assignment.starts_at, v_assignment.ends_at,
    coalesce(v_shift.break_minutes, 0), coalesce(v_shift.late_grace_minutes, 0),
    coalesce(v_shift.early_leave_grace_minutes, 0), coalesce(v_shift.overtime_threshold_minutes, 0),
    v_scan.half_day_threshold_percent,
    v_now, v_scan.location_id, v_outcome.status, v_outcome.late_minutes, v_scan.flags
  )
  returning * into v_record;

  perform private.record_scan_event(v_scan.user_id, v_scan.hospital_id, v_scan.staff_id, v_record.id, 'check_in',
    'accepted', null, v_scan.qr_code_id, v_scan.location_id, p_client);

  return jsonb_build_object(
    'ok', true,
    'record_id', v_record.id,
    'status', v_record.status,
    'late_minutes', v_record.late_minutes,
    'checked_in_at', v_record.check_in_at,
    'scheduled_start', v_record.scheduled_start,
    'scheduled_end', v_record.scheduled_end,
    'location_name', v_scan.location_name,
    'flags', to_jsonb(v_record.flags)
  );
exception
  when unique_violation then
    -- Two scans at once: the partial unique index is the final guard.
    perform private.record_scan_event(v_scan.user_id, v_scan.hospital_id, v_scan.staff_id, null, 'check_in', 'rejected',
      'ALREADY_CHECKED_IN', v_scan.qr_code_id, v_scan.location_id, p_client);
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CHECKED_IN');
end;
$$;

-- -----------------------------------------------------------------------------
-- public.check_out
-- -----------------------------------------------------------------------------
create function public.check_out(p_payload text, p_client jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan     private.scan_context;
  v_now      timestamptz := now();
  v_record   public.attendance_records%rowtype;
  v_outcome  private.attendance_outcome;
  v_deadline timestamptz;
begin
  v_scan := private.resolve_scan(p_payload, p_client);
  if v_scan.rejection_code is not null then
    perform private.record_scan_event(v_scan.user_id, v_scan.hospital_id, v_scan.staff_id, null, 'check_out', 'rejected',
      v_scan.rejection_code, v_scan.qr_code_id, v_scan.location_id, p_client);
    return jsonb_build_object('ok', false, 'code', v_scan.rejection_code);
  end if;

  select * into v_record
  from public.attendance_records
  where staff_id = v_scan.staff_id and closed_at is null
  for update;

  if not found then
    perform private.record_scan_event(v_scan.user_id, v_scan.hospital_id, v_scan.staff_id, null, 'check_out', 'rejected',
      'NO_OPEN_SESSION', v_scan.qr_code_id, v_scan.location_id, p_client);
    return jsonb_build_object('ok', false, 'code', 'NO_OPEN_SESSION');
  end if;

  if v_now < v_record.check_in_at + make_interval(mins => coalesce(v_scan.min_session_minutes, 0)) then
    perform private.record_scan_event(v_scan.user_id, v_scan.hospital_id, v_scan.staff_id, v_record.id, 'check_out',
      'rejected', 'TOO_SOON', v_scan.qr_code_id, v_scan.location_id, p_client);
    return jsonb_build_object('ok', false, 'code', 'TOO_SOON');
  end if;

  v_deadline := coalesce(v_record.scheduled_end, v_record.check_in_at)
    + make_interval(mins => coalesce(v_scan.check_out_window_minutes, 480));
  if v_now > v_deadline then
    perform private.record_scan_event(v_scan.user_id, v_scan.hospital_id, v_scan.staff_id, v_record.id, 'check_out',
      'rejected', 'CHECK_OUT_WINDOW_CLOSED', v_scan.qr_code_id, v_scan.location_id, p_client);
    return jsonb_build_object('ok', false, 'code', 'CHECK_OUT_WINDOW_CLOSED');
  end if;

  v_outcome := private.compute_attendance_outcome(
    v_record.scheduled_start, v_record.scheduled_end, v_record.check_in_at, v_now,
    v_record.break_minutes, v_record.late_grace_minutes, v_record.half_day_threshold_percent
  );

  update public.attendance_records
  set check_out_at = v_now,
      check_out_location_id = v_scan.location_id,
      closed_at = v_now,
      status = v_outcome.status,
      late_minutes = v_outcome.late_minutes,
      early_leave_minutes = v_outcome.early_leave_minutes,
      overtime_minutes = v_outcome.overtime_minutes,
      worked_minutes = v_outcome.worked_minutes,
      flags = (select array(select distinct unnest(flags || v_scan.flags)))
  where id = v_record.id
  returning * into v_record;

  perform private.record_scan_event(v_scan.user_id, v_scan.hospital_id, v_scan.staff_id, v_record.id, 'check_out',
    'accepted', null, v_scan.qr_code_id, v_scan.location_id, p_client);

  return jsonb_build_object(
    'ok', true,
    'record_id', v_record.id,
    'status', v_record.status,
    'checked_out_at', v_record.check_out_at,
    'worked_minutes', v_record.worked_minutes,
    'overtime_minutes', v_record.overtime_minutes,
    'early_leave_minutes', v_record.early_leave_minutes,
    'is_overtime', v_record.is_overtime,
    'is_early_leave', v_record.is_early_leave,
    'location_name', v_scan.location_name
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- QR code management
-- -----------------------------------------------------------------------------
create function public.generate_location_qr_code(p_location_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.attendance_locations%rowtype;
  v_token    text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_location from public.attendance_locations where id = p_location_id for update;
  if not found or not coalesce(
    private.is_super_admin() or v_location.hospital_id = private.admin_hospital_id(),
    false
  ) then
    raise exception 'LOCATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not v_location.is_active then
    raise exception 'LOCATION_NOT_ACTIVE'
      using errcode = '22023', hint = 'Reactivate the location before issuing a QR code.';
  end if;

  perform set_config('app.audit_reason', 'QR code issued', true);

  update public.attendance_qr_codes
  set revoked_at = now(), revoked_by = auth.uid()
  where location_id = p_location_id and revoked_at is null;

  -- base64url: '+' and '/' are replaced and the '=' padding is dropped.
  v_token := 'v1.' || translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  insert into public.attendance_qr_codes (hospital_id, location_id, token, created_by)
  values (v_location.hospital_id, p_location_id, v_token, auth.uid());

  return v_token;
end;
$$;

create function public.revoke_location_qr_code(p_location_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.attendance_locations%rowtype;
  v_revoked  integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_location from public.attendance_locations where id = p_location_id for update;
  if not found or not coalesce(
    private.is_super_admin() or v_location.hospital_id = private.admin_hospital_id(),
    false
  ) then
    raise exception 'LOCATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform set_config('app.audit_reason', 'QR code revoked', true);

  update public.attendance_qr_codes
  set revoked_at = now(), revoked_by = auth.uid()
  where location_id = p_location_id and revoked_at is null;
  get diagnostics v_revoked = row_count;

  return v_revoked;
end;
$$;

-- -----------------------------------------------------------------------------
-- Scheduled finalisation: absences and forgotten check-outs.
-- Idempotent, so re-running it is harmless.
-- -----------------------------------------------------------------------------
create function private.finalize_elapsed_shifts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_absent integer := 0;
  v_closed integer := 0;
begin
  perform set_config('app.audit_source', 'attendance_job', true);

  with elapsed as (
    select sa.id, sa.hospital_id, sa.staff_id, sa.work_date, sa.starts_at, sa.ends_at,
           s.department_id,
           sh.break_minutes, sh.late_grace_minutes, sh.early_leave_grace_minutes, sh.overtime_threshold_minutes,
           hs.half_day_threshold_percent
    from public.shift_assignments sa
    join public.shifts sh on sh.id = sa.shift_id
    join public.staff s on s.id = sa.staff_id
    join public.hospital_settings hs on hs.hospital_id = sa.hospital_id
    where sa.status = 'scheduled'
      and sa.ends_at < now()
      and not exists (select 1 from public.attendance_records r where r.shift_assignment_id = sa.id)
  )
  insert into public.attendance_records (
    hospital_id, staff_id, department_id, shift_assignment_id, work_date,
    scheduled_start, scheduled_end, break_minutes, late_grace_minutes, early_leave_grace_minutes,
    overtime_threshold_minutes, half_day_threshold_percent, status, closed_at
  )
  select hospital_id, staff_id, department_id, id, work_date,
         starts_at, ends_at, break_minutes, late_grace_minutes, early_leave_grace_minutes,
         overtime_threshold_minutes, half_day_threshold_percent, 'absent', now()
  from elapsed;
  get diagnostics v_absent = row_count;

  -- Sessions past their check-out window are closed and flagged. No check-out time is
  -- invented: the staff member must request a correction.
  update public.attendance_records r
  set flags = (select array(select distinct unnest(r.flags || array['missed_check_out']::public.attendance_flag[]))),
      closed_at = now()
  from public.hospital_settings hs
  where hs.hospital_id = r.hospital_id
    and r.closed_at is null
    and r.check_out_at is null
    and now() > coalesce(r.scheduled_end, r.check_in_at) + make_interval(mins => hs.check_out_window_minutes);
  get diagnostics v_closed = row_count;

  return jsonb_build_object('absent_created', v_absent, 'sessions_closed', v_closed);
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('finalize-attendance', '*/10 * * * *', $job$select private.finalize_elapsed_shifts()$job$);
  else
    raise notice 'pg_cron is not installed: schedule private.finalize_elapsed_shifts() every 10 minutes (see README).';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reporting view
-- -----------------------------------------------------------------------------
create view public.attendance_overview
with (security_invoker = true)
as
select
  r.id,
  r.hospital_id,
  r.staff_id,
  s.first_name || ' ' || s.last_name as staff_name,
  s.employee_number,
  s.job_title,
  r.department_id,
  d.name as department_name,
  r.work_date,
  r.shift_assignment_id,
  sh.code as shift_code,
  sh.name as shift_name,
  r.scheduled_start,
  r.scheduled_end,
  r.check_in_at,
  r.check_out_at,
  li.name as check_in_location_name,
  lo.name as check_out_location_name,
  r.status,
  r.late_minutes,
  r.early_leave_minutes,
  r.overtime_minutes,
  r.worked_minutes,
  r.is_late,
  r.is_early_leave,
  r.is_overtime,
  r.flags,
  r.closed_at
from public.attendance_records r
join public.staff s on s.id = r.staff_id
join public.departments d on d.id = r.department_id
left join public.shift_assignments sa on sa.id = r.shift_assignment_id
left join public.shifts sh on sh.id = sa.shift_id
left join public.attendance_locations li on li.id = r.check_in_location_id
left join public.attendance_locations lo on lo.id = r.check_out_location_id;

-- -----------------------------------------------------------------------------
-- Row Level Security & grants
-- -----------------------------------------------------------------------------

-- attendance_locations: members read (their history names locations); admins write.
alter table public.attendance_locations enable row level security;
revoke all on public.attendance_locations from anon, authenticated;
grant select on public.attendance_locations to authenticated;
grant insert (hospital_id, name, description, latitude, longitude, geofence_radius_m, is_active)
  on public.attendance_locations to authenticated;
grant update (name, description, latitude, longitude, geofence_radius_m, is_active)
  on public.attendance_locations to authenticated;

create policy attendance_locations_select on public.attendance_locations
  for select to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.user_hospital_id()));

create policy attendance_locations_insert on public.attendance_locations
  for insert to authenticated
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

create policy attendance_locations_update on public.attendance_locations
  for update to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()))
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

-- attendance_qr_codes: administrators only, and never written directly.
alter table public.attendance_qr_codes enable row level security;
revoke all on public.attendance_qr_codes from anon, authenticated;
grant select on public.attendance_qr_codes to authenticated;

create policy attendance_qr_codes_select on public.attendance_qr_codes
  for select to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

-- attendance_records: read-only for every client role; written only by the engine.
alter table public.attendance_records enable row level security;
revoke all on public.attendance_records from anon, authenticated;
grant select on public.attendance_records to authenticated;

create policy attendance_records_select on public.attendance_records
  for select to authenticated
  using (
    (select private.is_super_admin())
    or hospital_id = (select private.admin_hospital_id())
    or department_id = any ((select private.headed_department_ids())::uuid[])
    or staff_id = (select private.user_staff_id())
  );

-- attendance_events: the scan log. Staff see their own scans; admins see the hospital's.
alter table public.attendance_events enable row level security;
revoke all on public.attendance_events from anon, authenticated, service_role;
grant select on public.attendance_events to authenticated, service_role;

create policy attendance_events_select on public.attendance_events
  for select to authenticated
  using (
    (select private.is_super_admin())
    or hospital_id = (select private.admin_hospital_id())
    or staff_id = (select private.user_staff_id())
  );

revoke all on public.attendance_overview from anon, authenticated;
grant select on public.attendance_overview to authenticated;

revoke all on function public.check_in(text, jsonb) from public, anon;
revoke all on function public.check_out(text, jsonb) from public, anon;
revoke all on function public.generate_location_qr_code(uuid) from public, anon;
revoke all on function public.revoke_location_qr_code(uuid) from public, anon;
grant execute on function public.check_in(text, jsonb) to authenticated;
grant execute on function public.check_out(text, jsonb) to authenticated;
grant execute on function public.generate_location_qr_code(uuid) to authenticated;
grant execute on function public.revoke_location_qr_code(uuid) to authenticated;
