-- =============================================================================
-- Reporting, the audit log viewer and request attachments.
-- Design reference: docs/01-database-and-authorization-design.md §5.12, §5.14, §9, §11
--
-- Attachments live in a private Storage bucket under {hospital_id}/{staff_id}/{file}.
-- Uploads go through the server with the user's own session, so the storage policies
-- below apply as a second line of defence.
-- =============================================================================

alter table public.leave_requests
  add column attachment_path text,
  add constraint leave_requests_attachment_check check (
    attachment_path is null
    or attachment_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'
  );

alter table public.attendance_corrections
  add column evidence_path text,
  add constraint attendance_corrections_evidence_check check (
    evidence_path is null
    or evidence_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'
  );

-- The overview views were created before these columns existed, so they are replaced
-- to expose them (new columns may only be appended to an existing view).
create or replace view public.leave_requests_overview
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
  lr.created_at,
  lr.attachment_path
from public.leave_requests lr
join public.staff s on s.id = lr.staff_id
join public.departments d on d.id = lr.department_id
join public.leave_types lt on lt.id = lr.leave_type_id
left join public.profiles reviewer on reviewer.id = lr.reviewed_by;

create or replace view public.attendance_corrections_overview
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
  c.created_at,
  c.evidence_path
from public.attendance_corrections c
join public.staff s on s.id = c.staff_id
join public.departments d on d.id = c.department_id
join public.attendance_records r on r.id = c.attendance_record_id
left join public.profiles reviewer on reviewer.id = c.reviewed_by;

-- -----------------------------------------------------------------------------
-- The submit RPCs gain an attachment parameter. Postgres would treat the new
-- parameter list as an overload, so the previous signatures are dropped first.
-- -----------------------------------------------------------------------------
drop function public.submit_leave_request(uuid, date, date, text, public.half_day_period);

create function public.submit_leave_request(
  p_leave_type_id   uuid,
  p_start_date      date,
  p_end_date        date,
  p_reason          text,
  p_half_day_period public.half_day_period default null,
  p_attachment_path text default null
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

  -- An attachment must live under this staff member's own folder.
  if p_attachment_path is not null
     and p_attachment_path not like v_staff.hospital_id::text || '/' || v_staff.id::text || '/%' then
    raise exception 'ATTACHMENT_NOT_ALLOWED' using errcode = '42501';
  end if;

  begin
    insert into public.leave_requests (
      hospital_id, staff_id, department_id, leave_type_id, start_date, end_date,
      half_day_period, reason, requested_by, attachment_path
    )
    values (
      v_staff.hospital_id, v_staff.id, v_staff.department_id, p_leave_type_id,
      p_start_date, p_end_date, p_half_day_period, btrim(p_reason), auth.uid(), p_attachment_path
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

drop function public.request_attendance_correction(uuid, text, timestamptz, timestamptz);

create function public.request_attendance_correction(
  p_attendance_record_id uuid,
  p_reason               text,
  p_check_in_at          timestamptz default null,
  p_check_out_at         timestamptz default null,
  p_evidence_path        text default null
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

  if p_evidence_path is not null
     and p_evidence_path not like v_record.hospital_id::text || '/' || v_record.staff_id::text || '/%' then
    raise exception 'ATTACHMENT_NOT_ALLOWED' using errcode = '42501';
  end if;

  begin
    insert into public.attendance_corrections (
      hospital_id, attendance_record_id, staff_id, department_id,
      requested_check_in_at, requested_check_out_at, reason, requested_by, evidence_path
    )
    values (
      v_record.hospital_id, v_record.id, v_record.staff_id, v_record.department_id,
      p_check_in_at, p_check_out_at, btrim(p_reason), auth.uid(), p_evidence_path
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

revoke all on function public.submit_leave_request(uuid, date, date, text, public.half_day_period, text) from public, anon;
revoke all on function public.request_attendance_correction(uuid, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.submit_leave_request(uuid, date, date, text, public.half_day_period, text) to authenticated;
grant execute on function public.request_attendance_correction(uuid, text, timestamptz, timestamptz, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Attendance summary for reports. No SECURITY DEFINER: it runs as the caller, so a
-- staff member summarising sees only their own attendance and a department head
-- only their departments. Returns JSON, validated against a schema in the app.
-- -----------------------------------------------------------------------------
create function public.report_attendance_summary(
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
      count(*) filter (where r.status = 'on_leave')::integer as on_leave_count,
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

/** Daily totals for the same range, for the report chart. */
create function public.report_attendance_by_day(
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
      count(*) filter (where r.status = 'on_leave')::integer as on_leave_count,
      count(*) filter (where r.status = 'half_day')::integer as half_day_count
    from public.attendance_records r
    where r.hospital_id = p_hospital_id
      and r.work_date between p_from and p_to
      and (p_department_id is null or r.department_id = p_department_id)
    group by r.work_date
  ) daily;
$$;

revoke all on function public.report_attendance_summary(uuid, date, date, uuid) from public, anon;
revoke all on function public.report_attendance_by_day(uuid, date, date, uuid) from public, anon;
grant execute on function public.report_attendance_summary(uuid, date, date, uuid) to authenticated;
grant execute on function public.report_attendance_by_day(uuid, date, date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Audit log viewer: the same rows, with the actor's name resolved for display.
-- -----------------------------------------------------------------------------
create view public.audit_log_entries
with (security_invoker = true)
as
select
  a.id,
  a.hospital_id,
  a.actor_id,
  actor.display_name as actor_name,
  a.actor_role,
  a.action,
  a.entity_table,
  a.entity_id,
  a.old_data,
  a.new_data,
  a.reason,
  a.context,
  a.created_at
from public.audit_logs a
left join public.profiles actor on actor.id = a.actor_id;

revoke all on public.audit_log_entries from anon, authenticated;
grant select on public.audit_log_entries to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: the private bucket for leave documents and correction evidence.
-- Skipped where the storage schema does not exist (for example in the test harness).
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Storage schema not present: skipping the request-attachments bucket and its policies.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'request-attachments', 'request-attachments', false, 6291456,
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  )
  on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

  -- Staff upload only into their own folder: {hospital_id}/{staff_id}/{file}
  execute $policy$
    create policy request_attachments_insert on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'request-attachments'
      and (storage.foldername(name))[1] = (select private.user_hospital_id())::text
      and (storage.foldername(name))[2] = (select private.user_staff_id())::text
    )
  $policy$;

  -- Readable by the owner, their hospital's admins, and the head of their department.
  execute $policy$
    create policy request_attachments_select on storage.objects
    for select to authenticated
    using (
      bucket_id = 'request-attachments'
      and (
        (select private.is_super_admin())
        or (storage.foldername(name))[1] = (select private.admin_hospital_id())::text
        or (storage.foldername(name))[2] = (select private.user_staff_id())::text
        or exists (
          select 1
          from public.staff s
          where s.id::text = (storage.foldername(name))[2]
            and s.department_id = any ((select private.headed_department_ids())::uuid[])
        )
      )
    )
  $policy$;
end;
$do$;
