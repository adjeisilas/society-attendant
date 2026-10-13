-- =============================================================================
-- Scheduling: shift templates and the dated roster.
-- Design reference: docs/01-database-and-authorization-design.md §1 (D8–D9), §5.6–5.7
--
-- Rule: an assignment's starts_at/ends_at are always derived from its shift and
-- the hospital time zone. Assignments that have not started follow the current
-- shift template; assignments that have started keep the schedule they were
-- worked against.
-- =============================================================================

create type public.assignment_status as enum ('scheduled', 'cancelled');

-- -----------------------------------------------------------------------------
-- shifts (templates)
-- -----------------------------------------------------------------------------
create table public.shifts (
  id                          uuid primary key default gen_random_uuid(),
  hospital_id                 uuid not null references public.hospitals (id),
  department_id               uuid,
  name                        text not null,
  code                        text not null,
  start_time                  time not null,
  duration_minutes            integer not null,
  break_minutes               integer not null default 0,
  late_grace_minutes          integer not null default 10,
  early_leave_grace_minutes   integer not null default 10,
  overtime_threshold_minutes  integer not null default 30,
  check_in_opens_minutes      integer not null default 60,
  crosses_midnight            boolean generated always as (
    extract(hour from start_time) * 60 + extract(minute from start_time) + duration_minutes > 1440
  ) stored,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint shifts_hospital_id_id_key unique (hospital_id, id),
  constraint shifts_hospital_code_key unique (hospital_id, code),
  -- Null department_id means the shift is available hospital-wide.
  constraint shifts_department_fk foreign key (hospital_id, department_id)
    references public.departments (hospital_id, id),
  constraint shifts_name_check check (char_length(name) between 2 and 80 and name = btrim(name)),
  constraint shifts_code_check check (code ~ '^[A-Z0-9-]{1,20}$'),
  constraint shifts_start_time_check check (extract(second from start_time) = 0),
  constraint shifts_duration_check check (duration_minutes between 30 and 1440),
  constraint shifts_break_check check (break_minutes >= 0 and break_minutes < duration_minutes),
  constraint shifts_late_grace_check check (late_grace_minutes between 0 and 120),
  constraint shifts_early_leave_grace_check check (early_leave_grace_minutes between 0 and 120),
  constraint shifts_overtime_threshold_check check (overtime_threshold_minutes between 0 and 240),
  constraint shifts_check_in_opens_check check (check_in_opens_minutes between 0 and 240)
);

create index shifts_department_id_idx on public.shifts (department_id);

create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function private.set_updated_at();

create trigger shifts_audit
  after insert or update or delete on public.shifts
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- shift_assignments (roster)
-- -----------------------------------------------------------------------------
create table public.shift_assignments (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals (id),
  staff_id     uuid not null,
  shift_id     uuid not null,
  work_date    date not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       public.assignment_status not null default 'scheduled',
  notes        text,
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint shift_assignments_hospital_id_id_key unique (hospital_id, id),
  constraint shift_assignments_staff_fk foreign key (hospital_id, staff_id)
    references public.staff (hospital_id, id),
  constraint shift_assignments_shift_fk foreign key (hospital_id, shift_id)
    references public.shifts (hospital_id, id),
  constraint shift_assignments_time_order_check check (ends_at > starts_at),
  constraint shift_assignments_notes_check check (char_length(notes) <= 1000),
  -- Double and back-to-back shifts are allowed; overlapping ones are not.
  constraint shift_assignments_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'scheduled')
);

create index shift_assignments_hospital_work_date_idx on public.shift_assignments (hospital_id, work_date);
create index shift_assignments_staff_starts_at_idx on public.shift_assignments (staff_id, starts_at);
create index shift_assignments_shift_starts_at_idx on public.shift_assignments (shift_id, starts_at);

-- Derives schedule times, stamps created_by and validates staff and shift state.
-- Runs as the invoking user, so lookups respect that user's RLS visibility.
create function private.prepare_shift_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_insert      boolean := tg_op = 'INSERT';
  v_staff_changed  boolean := true;
  v_shift_changed  boolean := true;
  v_start_time     time;
  v_duration       integer;
  v_timezone       text;
begin
  if v_is_insert then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    v_staff_changed := new.staff_id is distinct from old.staff_id;
    v_shift_changed := new.shift_id is distinct from old.shift_id;
  end if;

  if v_staff_changed and not exists (
    select 1 from public.staff s where s.id = new.staff_id and s.status = 'active'
  ) then
    raise exception 'STAFF_NOT_ACTIVE'
      using errcode = '22023',
            hint = 'Only active staff can be assigned to shifts.';
  end if;

  -- Started assignments keep their schedule unless the shift or date is explicitly changed.
  if not v_is_insert
     and not v_shift_changed
     and new.work_date = old.work_date
     and old.starts_at <= now() then
    new.starts_at := old.starts_at;
    new.ends_at := old.ends_at;
    return new;
  end if;

  select sh.start_time, sh.duration_minutes, h.timezone
    into v_start_time, v_duration, v_timezone
  from public.shifts sh
  join public.hospitals h on h.id = sh.hospital_id
  where sh.id = new.shift_id
    and (sh.is_active or not v_shift_changed);

  if not found then
    raise exception 'SHIFT_NOT_ACTIVE'
      using errcode = '22023',
            hint = 'The shift does not exist or is not active.';
  end if;

  -- Wall-clock semantics in the hospital's time zone (handles overnight and DST).
  new.starts_at := (new.work_date + v_start_time) at time zone v_timezone;
  new.ends_at := (new.work_date + v_start_time + make_interval(mins => v_duration)) at time zone v_timezone;
  return new;
end;
$$;

create trigger shift_assignments_prepare
  before insert or update on public.shift_assignments
  for each row execute function private.prepare_shift_assignment();

create trigger shift_assignments_set_updated_at
  before update on public.shift_assignments
  for each row execute function private.set_updated_at();

create trigger shift_assignments_audit
  after insert or update or delete on public.shift_assignments
  for each row execute function private.audit_row_change();

-- When a template's timing changes, future scheduled assignments follow it.
create function private.reschedule_future_assignments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.audit_reason', true), '') = '' then
    perform set_config('app.audit_reason', 'Shift template timing changed', true);
  end if;

  update public.shift_assignments
  set work_date = work_date
  where shift_id = new.id
    and status = 'scheduled'
    and starts_at > now();

  return null;
end;
$$;

create trigger shifts_reschedule_future_assignments
  after update of start_time, duration_minutes on public.shifts
  for each row
  when (old.start_time is distinct from new.start_time or old.duration_minutes is distinct from new.duration_minutes)
  execute function private.reschedule_future_assignments();

-- Changing a hospital's time zone would invalidate every materialised schedule time.
create function private.prevent_timezone_change_with_roster()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.shift_assignments sa where sa.hospital_id = new.id) then
    raise exception 'TIMEZONE_LOCKED'
      using errcode = '22023',
            hint = 'The time zone cannot change once shifts have been rostered.';
  end if;
  return new;
end;
$$;

create trigger hospitals_lock_timezone
  before update of timezone on public.hospitals
  for each row
  when (old.timezone is distinct from new.timezone)
  execute function private.prevent_timezone_change_with_roster();

-- -----------------------------------------------------------------------------
-- Row Level Security & grants
-- -----------------------------------------------------------------------------

-- shifts: every member of the hospital can read; admins write.
alter table public.shifts enable row level security;
revoke all on public.shifts from anon, authenticated;
grant select, insert, update on public.shifts to authenticated;

create policy shifts_select on public.shifts
  for select to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.user_hospital_id()));

create policy shifts_insert on public.shifts
  for insert to authenticated
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

create policy shifts_update on public.shifts
  for update to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()))
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

-- shift_assignments: admins manage; department heads view their departments; staff view their own.
alter table public.shift_assignments enable row level security;
revoke all on public.shift_assignments from anon, authenticated;
grant select, insert, update (staff_id, shift_id, work_date, status, notes, hospital_id)
  on public.shift_assignments to authenticated;

create policy shift_assignments_select on public.shift_assignments
  for select to authenticated
  using (
    (select private.is_super_admin())
    or hospital_id = (select private.admin_hospital_id())
    or staff_id = (select private.user_staff_id())
    or exists (
      select 1
      from public.staff s
      where s.id = shift_assignments.staff_id
        and s.department_id = any ((select private.headed_department_ids())::uuid[])
    )
  );

create policy shift_assignments_insert on public.shift_assignments
  for insert to authenticated
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

create policy shift_assignments_update on public.shift_assignments
  for update to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()))
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));
