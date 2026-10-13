-- =============================================================================
-- Leave management is removed: the system records clock-in and clock-out only.
--
-- Every function that read or wrote leave is replaced first, then the leave tables,
-- views and types are dropped. Attendance corrections and their notifications stay.
-- Records already marked 'on_leave' keep that status as history; nothing new sets it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Corrections no longer clear a leave link.
-- -----------------------------------------------------------------------------
create or replace function public.review_attendance_correction(p_correction_id uuid, p_approve boolean, p_note text default null)
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
-- The scheduled job records every elapsed shift without a check-in as an absence.
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

-- -----------------------------------------------------------------------------
-- Reports no longer count leave.
-- -----------------------------------------------------------------------------
create or replace function public.report_attendance_summary(
  p_hospital_id   uuid,
  p_from          date,
  p_to            date,
  p_department_id uuid default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(summary) order by summary.staff_name), '[]'::jsonb)
  from (
    select
      r.staff_id,
      s.first_name || ' ' || s.last_name as staff_name,
      s.employee_number,
      r.department_id,
      d.name as department_name,
      count(*)::integer as recorded_days,
      count(*) filter (where r.status = 'present')::integer as present_count,
      count(*) filter (where r.status = 'late')::integer as late_count,
      count(*) filter (where r.status = 'absent')::integer as absent_count,
      count(*) filter (where r.status = 'half_day')::integer as half_day_count,
      coalesce(sum(r.worked_minutes), 0)::integer as worked_minutes,
      coalesce(sum(r.overtime_minutes), 0)::integer as overtime_minutes,
      coalesce(sum(r.late_minutes), 0)::integer as late_minutes,
      count(*) filter (where 'missed_check_out' = any (r.flags))::integer as missed_check_out_count
    from public.attendance_records r
    join public.staff s on s.id = r.staff_id
    join public.departments d on d.id = r.department_id
    where r.hospital_id = p_hospital_id
      and r.work_date between p_from and p_to
      and (p_department_id is null or r.department_id = p_department_id)
    group by r.staff_id, s.first_name, s.last_name, s.employee_number, r.department_id, d.name
  ) summary;
$$;

create or replace function public.report_attendance_by_day(
  p_hospital_id   uuid,
  p_from          date,
  p_to            date,
  p_department_id uuid default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(daily) order by daily.work_date), '[]'::jsonb)
  from (
    select
      r.work_date,
      count(*) filter (where r.status = 'present')::integer as present_count,
      count(*) filter (where r.status = 'late')::integer as late_count,
      count(*) filter (where r.status = 'absent')::integer as absent_count,
      count(*) filter (where r.status = 'half_day')::integer as half_day_count
    from public.attendance_records r
    where r.hospital_id = p_hospital_id
      and r.work_date between p_from and p_to
      and (p_department_id is null or r.department_id = p_department_id)
    group by r.work_date
  ) daily;
$$;

-- -----------------------------------------------------------------------------
-- Drop the leave workflow, its views and its tables.
-- -----------------------------------------------------------------------------
drop function public.submit_leave_request(uuid, date, date, text, public.half_day_period, text);
drop function public.review_leave_request(uuid, boolean, text);
drop function public.cancel_leave_request(uuid);
drop function private.can_review_leave(uuid, uuid);

drop view public.leave_requests_overview;

alter table public.attendance_records
  drop constraint attendance_records_on_leave_check,
  drop column leave_request_id;

drop table public.leave_requests;
drop table public.leave_types;
drop type public.half_day_period;

-- -----------------------------------------------------------------------------
-- Notifications: only corrections remain. The enum is rebuilt without the leave
-- values, so private.notify is recreated against the new type.
-- -----------------------------------------------------------------------------
delete from public.notifications where type in ('leave_submitted', 'leave_reviewed');

alter type public.notification_type rename to notification_type_old;
create type public.notification_type as enum ('correction_submitted', 'correction_reviewed');

alter table public.notifications
  alter column "type" type public.notification_type using "type"::text::public.notification_type;

drop function private.notify(uuid[], uuid, public.notification_type_old, text, text, text, text, text);
drop type public.notification_type_old;

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
