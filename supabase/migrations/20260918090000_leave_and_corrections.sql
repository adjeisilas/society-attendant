-- =============================================================================
-- Leave management, attendance corrections and notifications.
-- Design reference: docs/01-database-and-authorization-design.md §5.12–5.15, §6.6–6.7
--
-- Requests are state machines: no client role writes these tables directly. Every
-- transition runs through an RPC that re-checks authority, records a reason and
-- recomputes attendance with the shared calculation, so a status is never set by hand.
--
-- Attachments (leave documents, correction evidence) arrive with the Storage work;
-- the columns are added then, together with the upload flow that fills them.
-- =============================================================================

create type public.request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.half_day_period as enum ('first_half', 'second_half');
create type public.notification_type as enum (
  'leave_submitted', 'leave_reviewed', 'correction_submitted', 'correction_reviewed'
);

-- -----------------------------------------------------------------------------
-- leave_types
-- -----------------------------------------------------------------------------
create table public.leave_types (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references public.hospitals (id),
  name               text not null,
  code               text not null,
  is_paid            boolean not null default true,
  allows_half_day    boolean not null default false,
  max_days_per_year  numeric(5, 1),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint leave_types_hospital_id_id_key unique (hospital_id, id),
  constraint leave_types_hospital_code_key unique (hospital_id, code),
  constraint leave_types_name_check check (char_length(name) between 2 and 80 and name = btrim(name)),
  constraint leave_types_code_check check (code ~ '^[A-Z0-9-]{1,20}$'),
  constraint leave_types_max_days_check check (max_days_per_year is null or (max_days_per_year > 0 and max_days_per_year <= 366))
);

create unique index leave_types_hospital_name_key on public.leave_types (hospital_id, lower(name));

create trigger leave_types_set_updated_at
  before update on public.leave_types
  for each row execute function private.set_updated_at();

create trigger leave_types_audit
  after insert or update or delete on public.leave_types
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- leave_requests
-- -----------------------------------------------------------------------------
create table public.leave_requests (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null references public.hospitals (id),
  staff_id         uuid not null,
  -- Snapshot, so a reviewer's scope does not change when staff transfer.
  department_id    uuid not null,
  leave_type_id    uuid not null,
  start_date       date not null,
  end_date         date not null,
  half_day_period  public.half_day_period,
  days             numeric(4, 1) generated always as (
    case when half_day_period is not null then 0.5 else (end_date - start_date + 1)::numeric end
  ) stored,
  reason           text not null,
  status           public.request_status not null default 'pending',
  requested_by     uuid not null references public.profiles (id),
  reviewed_by      uuid references public.profiles (id),
  reviewed_at      timestamptz,
  review_note      text,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint leave_requests_hospital_id_id_key unique (hospital_id, id),
  constraint leave_requests_staff_fk foreign key (hospital_id, staff_id)
    references public.staff (hospital_id, id),
  constraint leave_requests_department_fk foreign key (hospital_id, department_id)
    references public.departments (hospital_id, id),
  constraint leave_requests_type_fk foreign key (hospital_id, leave_type_id)
    references public.leave_types (hospital_id, id),
  constraint leave_requests_range_check check (end_date >= start_date),
  constraint leave_requests_half_day_check check (half_day_period is null or start_date = end_date),
  constraint leave_requests_reason_check check (char_length(reason) between 5 and 1000),
  constraint leave_requests_review_note_check check (char_length(review_note) <= 1000),
  -- A decided request records its reviewer. Cancelling later keeps that history.
  constraint leave_requests_review_check check (status not in ('approved', 'rejected') or reviewed_by is not null),
  constraint leave_requests_reviewed_at_check check ((reviewed_by is null) = (reviewed_at is null)),
  constraint leave_requests_cancelled_check check ((status = 'cancelled') = (cancelled_at is not null)),
  -- One live request per person per day.
  constraint leave_requests_no_overlap exclude using gist (
    staff_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('pending', 'approved'))
);

create index leave_requests_hospital_status_idx on public.leave_requests (hospital_id, status, start_date desc);
create index leave_requests_staff_idx on public.leave_requests (staff_id, start_date desc);
create index leave_requests_department_idx on public.leave_requests (department_id, status);

create trigger leave_requests_set_updated_at
  before update on public.leave_requests
  for each row execute function private.set_updated_at();

create trigger leave_requests_audit
  after insert or update or delete on public.leave_requests
  for each row execute function private.audit_row_change();

-- Deferred from Phase 5: an absence excused by approved leave points at the request.
alter table public.attendance_records
  add column leave_request_id uuid references public.leave_requests (id),
  add constraint attendance_records_on_leave_check check (status <> 'on_leave' or leave_request_id is not null);

create index attendance_records_leave_request_idx on public.attendance_records (leave_request_id);

-- -----------------------------------------------------------------------------
-- attendance_corrections
-- A correction proposes times. Status is always recomputed, never chosen.
-- -----------------------------------------------------------------------------
create table public.attendance_corrections (
  id                      uuid primary key default gen_random_uuid(),
  hospital_id             uuid not null references public.hospitals (id),
  attendance_record_id    uuid not null,
  staff_id                uuid not null,
  department_id           uuid not null,
  requested_check_in_at   timestamptz,
  requested_check_out_at  timestamptz,
  reason                  text not null,
  status                  public.request_status not null default 'pending',
  requested_by            uuid not null references public.profiles (id),
  reviewed_by             uuid references public.profiles (id),
  reviewed_at             timestamptz,
  review_note             text,
  cancelled_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint attendance_corrections_hospital_id_id_key unique (hospital_id, id),
  constraint attendance_corrections_record_fk foreign key (hospital_id, attendance_record_id)
    references public.attendance_records (hospital_id, id),
  constraint attendance_corrections_staff_fk foreign key (hospital_id, staff_id)
    references public.staff (hospital_id, id),
  constraint attendance_corrections_department_fk foreign key (hospital_id, department_id)
    references public.departments (hospital_id, id),
  constraint attendance_corrections_times_check check (num_nonnulls(requested_check_in_at, requested_check_out_at) >= 1),
  constraint attendance_corrections_order_check check (
    requested_check_out_at is null or requested_check_in_at is null
    or requested_check_out_at > requested_check_in_at
  ),
  constraint attendance_corrections_reason_check check (char_length(reason) between 10 and 1000),
  constraint attendance_corrections_review_note_check check (char_length(review_note) <= 1000),
  constraint attendance_corrections_review_check check (status not in ('approved', 'rejected') or reviewed_by is not null),
  constraint attendance_corrections_reviewed_at_check check ((reviewed_by is null) = (reviewed_at is null)),
  constraint attendance_corrections_cancelled_check check ((status = 'cancelled') = (cancelled_at is not null))
);

-- One open request per attendance record.
create unique index attendance_corrections_pending_key on public.attendance_corrections (attendance_record_id)
  where status = 'pending';
create index attendance_corrections_hospital_status_idx on public.attendance_corrections (hospital_id, status, created_at desc);
create index attendance_corrections_staff_idx on public.attendance_corrections (staff_id, created_at desc);
create index attendance_corrections_department_idx on public.attendance_corrections (department_id, status);

create trigger attendance_corrections_set_updated_at
  before update on public.attendance_corrections
  for each row execute function private.set_updated_at();

create trigger attendance_corrections_audit
  after insert or update or delete on public.attendance_corrections
  for each row execute function private.audit_row_change();

alter table public.attendance_records
  add column last_correction_id uuid references public.attendance_corrections (id);

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create table public.notifications (
  id            bigint generated always as identity primary key,
  hospital_id   uuid references public.hospitals (id),
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  type          public.notification_type not null,
  title         text not null,
  body          text,
  link_path     text,
  entity_table  text,
  entity_id     text,
  read_at       timestamptz,
  created_at    timestamptz not null default now(),
  constraint notifications_title_check check (char_length(title) between 1 and 200),
  constraint notifications_body_check check (char_length(body) <= 1000),
  constraint notifications_link_check check (link_path is null or link_path ~ '^/[A-Za-z0-9/_?&=-]*$')
);

create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;

-- -----------------------------------------------------------------------------
-- Helpers: who may review, and who to notify
-- -----------------------------------------------------------------------------

/** Leave is reviewed by hospital admins, or by the head of the staff member's department. */
create function private.can_review_leave(p_hospital_id uuid, p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.is_super_admin()
    or p_hospital_id = private.admin_hospital_id()
    or p_department_id = any (private.headed_department_ids()),
    false
  );
$$;

/** Corrections change payroll-relevant times, so only hospital admins review them. */
create function private.can_review_correction(p_hospital_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_super_admin() or p_hospital_id = private.admin_hospital_id(), false);
$$;

create function private.notify(
  p_recipients   uuid[],
  p_hospital_id  uuid,
  p_type         public.notification_type,
  p_title        text,
  p_body         text,
  p_link_path    text,
  p_entity_table text,
  p_entity_id    text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (hospital_id, recipient_id, type, title, body, link_path, entity_table, entity_id)
  select p_hospital_id, recipient, p_type, p_title, p_body, p_link_path, p_entity_table, p_entity_id
  from (select distinct unnest(p_recipients) as recipient) recipients
  where recipient is not null;
$$;

/** Accounts that can act on a request: the hospital's admins and the department head. */
create function private.request_reviewer_ids(p_hospital_id uuid, p_department_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct account_id), '{}'::uuid[])
  from (
    select p.id as account_id
    from public.profiles p
    where p.hospital_id = p_hospital_id and p.role = 'hospital_admin' and p.is_active
    union
    select s.user_id
    from public.departments d
    join public.staff s on s.id = d.head_staff_id
    join public.profiles p on p.id = s.user_id
    where d.id = p_department_id and d.is_active and s.status = 'active' and p.is_active
  ) reviewers
  where account_id is not null;
$$;

-- -----------------------------------------------------------------------------
-- Leave workflow
-- -----------------------------------------------------------------------------
create function public.submit_leave_request(
  p_leave_type_id   uuid,
  p_start_date      date,
  p_end_date        date,
  p_reason          text,
  p_half_day_period public.half_day_period default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff      public.staff%rowtype;
  v_type       public.leave_types%rowtype;
  v_request_id uuid;
begin
  select * into v_staff from public.staff where id = private.user_staff_id();
  if not found then
    raise exception 'STAFF_RECORD_REQUIRED' using errcode = '42501';
  end if;

  select * into v_type
  from public.leave_types
  where id = p_leave_type_id and hospital_id = v_staff.hospital_id and is_active;
  if not found then
    raise exception 'LEAVE_TYPE_NOT_AVAILABLE' using errcode = '22023';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = '22023';
  end if;

  if p_end_date - p_start_date > 365 then
    raise exception 'RANGE_TOO_LONG' using errcode = '22023', hint = 'Request at most one year at a time.';
  end if;

  if p_half_day_period is not null then
    if not v_type.allows_half_day then
      raise exception 'HALF_DAY_NOT_ALLOWED' using errcode = '22023';
    end if;
    if p_start_date <> p_end_date then
      raise exception 'HALF_DAY_SINGLE_DATE' using errcode = '22023';
    end if;
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  begin
    insert into public.leave_requests (
      hospital_id, staff_id, department_id, leave_type_id, start_date, end_date, half_day_period, reason, requested_by
    )
    values (
      v_staff.hospital_id, v_staff.id, v_staff.department_id, p_leave_type_id,
      p_start_date, p_end_date, p_half_day_period, btrim(p_reason), auth.uid()
    )
    returning id into v_request_id;
  exception
    when exclusion_violation then
      raise exception 'OVERLAPPING_LEAVE'
        using errcode = '22023', hint = 'You already have leave requested or approved for those dates.';
  end;

  perform private.notify(
    private.request_reviewer_ids(v_staff.hospital_id, v_staff.department_id),
    v_staff.hospital_id,
    'leave_submitted',
    format('%s %s requested leave', v_staff.first_name, v_staff.last_name),
    format('%s to %s', to_char(p_start_date, 'DD Mon YYYY'), to_char(p_end_date, 'DD Mon YYYY')),
    '/leave-requests/' || v_request_id,
    'leave_requests',
    v_request_id::text
  );

  return v_request_id;
end;
$$;

create function public.review_leave_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.leave_requests%rowtype;
  v_excused integer := 0;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or not private.can_review_leave(v_request.hospital_id, v_request.department_id) then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_request.staff_id = private.user_staff_id() then
    raise exception 'CANNOT_REVIEW_OWN_REQUEST' using errcode = '42501';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '22023';
  end if;

  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'REVIEW_NOTE_REQUIRED'
      using errcode = '22023', hint = 'Explain why the request is refused.';
  end if;

  perform set_config('app.audit_reason', coalesce(nullif(btrim(p_note), ''), 'Leave reviewed'), true);

  update public.leave_requests
  set status = case when p_approve then 'approved'::public.request_status else 'rejected'::public.request_status end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(btrim(p_note), '')
  where id = p_request_id;

  if p_approve then
    -- Absences already recorded inside the approved range become excused leave.
    update public.attendance_records
    set status = 'on_leave', leave_request_id = v_request.id
    where staff_id = v_request.staff_id
      and work_date between v_request.start_date and v_request.end_date
      and status = 'absent';
    get diagnostics v_excused = row_count;
  end if;

  perform private.notify(
    array[v_request.requested_by],
    v_request.hospital_id,
    'leave_reviewed',
    case when p_approve then 'Your leave was approved' else 'Your leave was not approved' end,
    case
      when p_approve and v_excused > 0 then format('%s recorded absence(s) were updated to on leave.', v_excused)
      else nullif(btrim(p_note), '')
    end,
    '/my-leave',
    'leave_requests',
    v_request.id::text
  );
end;
$$;

create function public.cancel_leave_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.leave_requests%rowtype;
  v_today   date;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or not (
    v_request.staff_id = private.user_staff_id()
    or private.can_review_leave(v_request.hospital_id, v_request.department_id)
  ) then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_request.status not in ('pending', 'approved') then
    raise exception 'REQUEST_NOT_CANCELLABLE' using errcode = '22023';
  end if;

  select (now() at time zone h.timezone)::date into v_today
  from public.hospitals h where h.id = v_request.hospital_id;

  if v_request.status = 'approved' and v_request.start_date <= v_today then
    raise exception 'LEAVE_ALREADY_STARTED'
      using errcode = '22023', hint = 'Leave that has started can only be changed by a correction.';
  end if;

  perform set_config('app.audit_reason', 'Leave cancelled', true);

  update public.leave_requests
  set status = 'cancelled', cancelled_at = now()
  where id = p_request_id;

  -- Any absence excused by this leave goes back to being an absence.
  update public.attendance_records
  set status = 'absent', leave_request_id = null
  where leave_request_id = v_request.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Correction workflow
-- -----------------------------------------------------------------------------
create function public.request_attendance_correction(
  p_attendance_record_id uuid,
  p_reason               text,
  p_check_in_at          timestamptz default null,
  p_check_out_at         timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record        public.attendance_records%rowtype;
  v_correction_id uuid;
  v_is_own        boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_record from public.attendance_records where id = p_attendance_record_id;
  v_is_own := found and v_record.staff_id = private.user_staff_id();

  if not found or not (v_is_own or private.can_review_correction(v_record.hospital_id)) then
    raise exception 'RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if num_nonnulls(p_check_in_at, p_check_out_at) = 0 then
    raise exception 'TIMES_REQUIRED'
      using errcode = '22023', hint = 'Give the corrected check-in time, check-out time, or both.';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'REASON_REQUIRED'
      using errcode = '22023', hint = 'Explain what happened, in at least 10 characters.';
  end if;

  if greatest(coalesce(p_check_in_at, '-infinity'), coalesce(p_check_out_at, '-infinity')) > now() then
    raise exception 'TIME_IN_FUTURE' using errcode = '22023';
  end if;

  if coalesce(p_check_out_at, p_check_in_at) < coalesce(v_record.scheduled_start, v_record.check_in_at) - interval '1 day' then
    raise exception 'TIME_OUT_OF_RANGE'
      using errcode = '22023', hint = 'Corrected times must be close to the shift they belong to.';
  end if;

  begin
    insert into public.attendance_corrections (
      hospital_id, attendance_record_id, staff_id, department_id,
      requested_check_in_at, requested_check_out_at, reason, requested_by
    )
    values (
      v_record.hospital_id, v_record.id, v_record.staff_id, v_record.department_id,
      p_check_in_at, p_check_out_at, btrim(p_reason), auth.uid()
    )
    returning id into v_correction_id;
  exception
    when unique_violation then
      raise exception 'CORRECTION_ALREADY_PENDING'
        using errcode = '22023', hint = 'This record already has a correction awaiting review.';
  end;

  perform private.notify(
    private.request_reviewer_ids(v_record.hospital_id, v_record.department_id),
    v_record.hospital_id,
    'correction_submitted',
    'Attendance correction requested',
    format('For %s', to_char(v_record.work_date, 'DD Mon YYYY')),
    '/corrections/' || v_correction_id,
    'attendance_corrections',
    v_correction_id::text
  );

  return v_correction_id;
end;
$$;

create function public.cancel_attendance_correction(p_correction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correction public.attendance_corrections%rowtype;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_correction from public.attendance_corrections where id = p_correction_id for update;
  if not found or not (
    v_correction.requested_by = auth.uid() or private.can_review_correction(v_correction.hospital_id)
  ) then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_correction.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Correction withdrawn', true);

  update public.attendance_corrections
  set status = 'cancelled', cancelled_at = now()
  where id = p_correction_id;
end;
$$;

create function public.review_attendance_correction(p_correction_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correction public.attendance_corrections%rowtype;
  v_record     public.attendance_records%rowtype;
  v_check_in   timestamptz;
  v_check_out  timestamptz;
  v_outcome    private.attendance_outcome;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_correction from public.attendance_corrections where id = p_correction_id for update;
  if not found or not private.can_review_correction(v_correction.hospital_id) then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_correction.staff_id = private.user_staff_id() then
    raise exception 'CANNOT_REVIEW_OWN_REQUEST' using errcode = '42501';
  end if;

  if v_correction.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '22023';
  end if;

  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'REVIEW_NOTE_REQUIRED'
      using errcode = '22023', hint = 'Explain why the correction is refused.';
  end if;

  perform set_config(
    'app.audit_reason',
    coalesce(nullif(btrim(p_note), ''), 'Attendance correction: ' || v_correction.reason),
    true
  );

  update public.attendance_corrections
  set status = case when p_approve then 'approved'::public.request_status else 'rejected'::public.request_status end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(btrim(p_note), '')
  where id = p_correction_id;

  if p_approve then
    select * into v_record from public.attendance_records where id = v_correction.attendance_record_id for update;

    v_check_in := coalesce(v_correction.requested_check_in_at, v_record.check_in_at);
    v_check_out := coalesce(v_correction.requested_check_out_at, v_record.check_out_at);

    if v_check_in is null then
      raise exception 'CHECK_IN_REQUIRED'
        using errcode = '22023', hint = 'A corrected record needs a check-in time.';
    end if;

    v_outcome := private.compute_attendance_outcome(
      v_record.scheduled_start, v_record.scheduled_end, v_check_in, v_check_out,
      v_record.break_minutes, v_record.late_grace_minutes, v_record.half_day_threshold_percent
    );

    update public.attendance_records
    set check_in_at = v_check_in,
        check_out_at = v_check_out,
        status = v_outcome.status,
        late_minutes = v_outcome.late_minutes,
        early_leave_minutes = v_outcome.early_leave_minutes,
        overtime_minutes = v_outcome.overtime_minutes,
        worked_minutes = v_outcome.worked_minutes,
        leave_request_id = null,
        last_correction_id = v_correction.id,
        closed_at = case when v_check_out is not null then coalesce(closed_at, now()) else closed_at end,
        -- The record is no longer missing a check-out once one is recorded.
        flags = case
          when v_check_out is null then flags
          else (select coalesce(array_agg(flag), '{}'::public.attendance_flag[])
                from unnest(flags) as flag
                where flag <> 'missed_check_out')
        end
    where id = v_record.id;
  end if;

  perform private.notify(
    array[v_correction.requested_by],
    v_correction.hospital_id,
    'correction_reviewed',
    case when p_approve then 'Attendance correction applied' else 'Attendance correction refused' end,
    nullif(btrim(p_note), ''),
    '/my-attendance',
    'attendance_corrections',
    v_correction.id::text
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- The scheduled job now excuses absences covered by approved leave.
-- -----------------------------------------------------------------------------
create or replace function private.finalize_elapsed_shifts()
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
           hs.half_day_threshold_percent,
           (
             select lr.id
             from public.leave_requests lr
             where lr.staff_id = sa.staff_id
               and lr.status = 'approved'
               and sa.work_date between lr.start_date and lr.end_date
             limit 1
           ) as leave_request_id
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
    overtime_threshold_minutes, half_day_threshold_percent, status, leave_request_id, closed_at
  )
  select hospital_id, staff_id, department_id, id, work_date,
         starts_at, ends_at, break_minutes, late_grace_minutes, early_leave_grace_minutes,
         overtime_threshold_minutes, half_day_threshold_percent,
         case
           when leave_request_id is null then 'absent'::public.attendance_status
           else 'on_leave'::public.attendance_status
         end,
         leave_request_id,
         now()
  from elapsed;
  get diagnostics v_absent = row_count;

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

-- -----------------------------------------------------------------------------
-- Overview views
-- -----------------------------------------------------------------------------
create view public.leave_requests_overview
with (security_invoker = true)
as
select
  lr.id,
  lr.hospital_id,
  lr.staff_id,
  s.first_name || ' ' || s.last_name as staff_name,
  s.employee_number,
  lr.department_id,
  d.name as department_name,
  lr.leave_type_id,
  lt.name as leave_type_name,
  lt.is_paid,
  lr.start_date,
  lr.end_date,
  lr.half_day_period,
  lr.days,
  lr.reason,
  lr.status,
  lr.requested_by,
  lr.reviewed_by,
  reviewer.display_name as reviewed_by_name,
  lr.reviewed_at,
  lr.review_note,
  lr.created_at
from public.leave_requests lr
join public.staff s on s.id = lr.staff_id
join public.departments d on d.id = lr.department_id
join public.leave_types lt on lt.id = lr.leave_type_id
left join public.profiles reviewer on reviewer.id = lr.reviewed_by;

create view public.attendance_corrections_overview
with (security_invoker = true)
as
select
  c.id,
  c.hospital_id,
  c.staff_id,
  s.first_name || ' ' || s.last_name as staff_name,
  s.employee_number,
  c.department_id,
  d.name as department_name,
  c.attendance_record_id,
  r.work_date,
  r.status as record_status,
  r.check_in_at as current_check_in_at,
  r.check_out_at as current_check_out_at,
  c.requested_check_in_at,
  c.requested_check_out_at,
  c.reason,
  c.status,
  c.requested_by,
  c.reviewed_by,
  reviewer.display_name as reviewed_by_name,
  c.reviewed_at,
  c.review_note,
  c.created_at
from public.attendance_corrections c
join public.staff s on s.id = c.staff_id
join public.departments d on d.id = c.department_id
join public.attendance_records r on r.id = c.attendance_record_id
left join public.profiles reviewer on reviewer.id = c.reviewed_by;

-- -----------------------------------------------------------------------------
-- Row Level Security & grants
-- -----------------------------------------------------------------------------

-- leave_types: members read; admins write.
alter table public.leave_types enable row level security;
revoke all on public.leave_types from anon, authenticated;
grant select on public.leave_types to authenticated;
grant insert (hospital_id, name, code, is_paid, allows_half_day, max_days_per_year, is_active)
  on public.leave_types to authenticated;
grant update (name, code, is_paid, allows_half_day, max_days_per_year, is_active)
  on public.leave_types to authenticated;

create policy leave_types_select on public.leave_types
  for select to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.user_hospital_id()));

create policy leave_types_insert on public.leave_types
  for insert to authenticated
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

create policy leave_types_update on public.leave_types
  for update to authenticated
  using ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()))
  with check ((select private.is_super_admin()) or hospital_id = (select private.admin_hospital_id()));

-- leave_requests and attendance_corrections: read-only for clients; RPCs do the writing.
alter table public.leave_requests enable row level security;
revoke all on public.leave_requests from anon, authenticated;
grant select on public.leave_requests to authenticated;

create policy leave_requests_select on public.leave_requests
  for select to authenticated
  using (
    (select private.is_super_admin())
    or hospital_id = (select private.admin_hospital_id())
    or department_id = any ((select private.headed_department_ids())::uuid[])
    or staff_id = (select private.user_staff_id())
  );

alter table public.attendance_corrections enable row level security;
revoke all on public.attendance_corrections from anon, authenticated;
grant select on public.attendance_corrections to authenticated;

create policy attendance_corrections_select on public.attendance_corrections
  for select to authenticated
  using (
    (select private.is_super_admin())
    or hospital_id = (select private.admin_hospital_id())
    or department_id = any ((select private.headed_department_ids())::uuid[])
    or staff_id = (select private.user_staff_id())
  );

-- notifications: recipients read their own and mark them read.
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));

create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

revoke all on public.leave_requests_overview from anon, authenticated;
revoke all on public.attendance_corrections_overview from anon, authenticated;
grant select on public.leave_requests_overview to authenticated;
grant select on public.attendance_corrections_overview to authenticated;

revoke all on function public.submit_leave_request(uuid, date, date, text, public.half_day_period) from public, anon;
revoke all on function public.review_leave_request(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_leave_request(uuid) from public, anon;
revoke all on function public.request_attendance_correction(uuid, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.cancel_attendance_correction(uuid) from public, anon;
revoke all on function public.review_attendance_correction(uuid, boolean, text) from public, anon;

grant execute on function public.submit_leave_request(uuid, date, date, text, public.half_day_period) to authenticated;
grant execute on function public.review_leave_request(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_leave_request(uuid) to authenticated;
grant execute on function public.request_attendance_correction(uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.cancel_attendance_correction(uuid) to authenticated;
grant execute on function public.review_attendance_correction(uuid, boolean, text) to authenticated;
