import "server-only";
import { listShifts } from "@/features/shifts/queries";
import { formatShiftTimes } from "@/features/shifts/time";
import { dataError, isRangeNotSatisfiable, required } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { AttendanceFlag, AttendanceStatus } from "./labels";
import { MY_ATTENDANCE_PAGE_SIZE } from "./schemas";

export interface AttendanceRecordView {
  id: string;
  staffId: string;
  staffName: string;
  employeeNumber: string;
  departmentName: string;
  workDate: string;
  shiftCode: string | null;
  shiftName: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInLocationName: string | null;
  checkOutLocationName: string | null;
  status: AttendanceStatus;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number | null;
  isLate: boolean;
  isEarlyLeave: boolean;
  isOvertime: boolean;
  flags: AttendanceFlag[];
  isOpen: boolean;
}

const OVERVIEW_COLUMNS =
  "id, staff_id, staff_name, employee_number, department_name, work_date, shift_assignment_id, shift_code, shift_name, scheduled_start, scheduled_end, check_in_at, check_out_at, check_in_location_name, check_out_location_name, status, late_minutes, early_leave_minutes, overtime_minutes, worked_minutes, is_late, is_early_leave, is_overtime, flags, closed_at";

type OverviewRow = Pick<
  Database["public"]["Views"]["attendance_overview"]["Row"],
  | "id"
  | "staff_id"
  | "staff_name"
  | "employee_number"
  | "department_name"
  | "work_date"
  | "shift_assignment_id"
  | "shift_code"
  | "shift_name"
  | "scheduled_start"
  | "scheduled_end"
  | "check_in_at"
  | "check_out_at"
  | "check_in_location_name"
  | "check_out_location_name"
  | "status"
  | "late_minutes"
  | "early_leave_minutes"
  | "overtime_minutes"
  | "worked_minutes"
  | "is_late"
  | "is_early_leave"
  | "is_overtime"
  | "flags"
  | "closed_at"
>;

function toRecordView(row: OverviewRow): AttendanceRecordView {
  return {
    id: required(row.id, "id"),
    staffId: required(row.staff_id, "staff_id"),
    staffName: required(row.staff_name, "staff_name"),
    employeeNumber: required(row.employee_number, "employee_number"),
    departmentName: required(row.department_name, "department_name"),
    workDate: required(row.work_date, "work_date"),
    shiftCode: row.shift_code,
    shiftName: row.shift_name,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    checkInLocationName: row.check_in_location_name,
    checkOutLocationName: row.check_out_location_name,
    status: required(row.status, "status"),
    lateMinutes: row.late_minutes ?? 0,
    earlyLeaveMinutes: row.early_leave_minutes ?? 0,
    overtimeMinutes: row.overtime_minutes ?? 0,
    workedMinutes: row.worked_minutes,
    isLate: row.is_late ?? false,
    isEarlyLeave: row.is_early_leave ?? false,
    isOvertime: row.is_overtime ?? false,
    flags: row.flags ?? [],
    isOpen: row.closed_at === null,
  };
}

/** The signed-in staff member's open session, if they are currently checked in. */
export async function getOpenSession(staffId: string): Promise<AttendanceRecordView | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_overview")
    .select(OVERVIEW_COLUMNS)
    .eq("staff_id", staffId)
    .is("closed_at", null)
    .maybeSingle();
  if (error) throw dataError("load your open session", error);
  return data && toRecordView(data);
}

/** One attendance record. RLS decides whether the caller may see it. */
export async function getAttendanceRecord(recordId: string): Promise<AttendanceRecordView | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_overview")
    .select(OVERVIEW_COLUMNS)
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw dataError("load attendance record", error);
  return data && toRecordView(data);
}

export interface RosteredShift {
  assignmentId: string;
  workDate: string;
  startsAt: string;
  endsAt: string;
  shiftLabel: string;
  times: string;
  hasRecord: boolean;
}

/** The staff member's shifts for a date, with whether attendance has been recorded. */
export async function listMyShiftsOn(hospitalId: string, staffId: string, workDate: string): Promise<RosteredShift[]> {
  const supabase = await createSupabaseServerClient();
  const [assignments, shifts, records] = await Promise.all([
    supabase
      .from("shift_assignments")
      .select("id, shift_id, work_date, starts_at, ends_at")
      .eq("staff_id", staffId)
      .eq("work_date", workDate)
      .eq("status", "scheduled")
      .order("starts_at"),
    listShifts(hospitalId),
    supabase.from("attendance_records").select("shift_assignment_id").eq("staff_id", staffId).eq("work_date", workDate),
  ]);
  if (assignments.error) throw dataError("load your roster", assignments.error);
  if (records.error) throw dataError("load your attendance", records.error);

  const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]));
  const recorded = new Set(records.data.map((row) => row.shift_assignment_id));

  return assignments.data.map((row) => {
    const shift = shiftsById.get(row.shift_id);
    return {
      assignmentId: row.id,
      workDate: row.work_date,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      shiftLabel: shift ? `${shift.code} · ${shift.name}` : "Shift",
      times: shift ? formatShiftTimes(shift.startTime, shift.durationMinutes) : "",
      hasRecord: recorded.has(row.id),
    };
  });
}

export async function listMyAttendance(
  staffId: string,
  page: number,
): Promise<{ records: AttendanceRecordView[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const from = (page - 1) * MY_ATTENDANCE_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("attendance_overview")
    .select(OVERVIEW_COLUMNS, { count: "exact" })
    .eq("staff_id", staffId)
    .order("work_date", { ascending: false })
    .order("scheduled_start", { ascending: false, nullsFirst: false })
    .range(from, from + MY_ATTENDANCE_PAGE_SIZE - 1);

  if (error && isRangeNotSatisfiable(error)) return { records: [], total: 0 };
  if (error) throw dataError("load your attendance history", error);
  return { records: data.map(toRecordView), total: count ?? data.length };
}

export interface AttendanceDayRow {
  key: string;
  staffId: string;
  staffName: string;
  employeeNumber: string;
  departmentName: string;
  shiftLabel: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** null when the shift is rostered but has no attendance record yet. */
  record: AttendanceRecordView | null;
}

/**
 * One day of attendance for the hospital (or one department), including rostered staff
 * who have not checked in yet. Those have no record until the scheduled job runs.
 */
export async function listAttendanceForDay(
  hospitalId: string,
  options: { workDate: string; departmentId?: string },
): Promise<AttendanceDayRow[]> {
  const supabase = await createSupabaseServerClient();
  const { workDate, departmentId } = options;

  let recordsQuery = supabase
    .from("attendance_overview")
    .select(OVERVIEW_COLUMNS)
    .eq("hospital_id", hospitalId)
    .eq("work_date", workDate);
  if (departmentId) recordsQuery = recordsQuery.eq("department_id", departmentId);

  const [records, assignments, shifts] = await Promise.all([
    recordsQuery.order("staff_name"),
    supabase
      .from("shift_assignments")
      .select("id, staff_id, shift_id, starts_at, ends_at")
      .eq("hospital_id", hospitalId)
      .eq("work_date", workDate)
      .eq("status", "scheduled"),
    listShifts(hospitalId),
  ]);
  if (records.error) throw dataError("load attendance", records.error);
  if (assignments.error) throw dataError("load the roster", assignments.error);

  const rows: AttendanceDayRow[] = records.data.map((row) => {
    const record = toRecordView(row);
    return {
      key: record.id,
      staffId: record.staffId,
      staffName: record.staffName,
      employeeNumber: record.employeeNumber,
      departmentName: record.departmentName,
      shiftLabel: record.shiftCode ? `${record.shiftCode} · ${record.shiftName}` : null,
      scheduledStart: record.scheduledStart,
      scheduledEnd: record.scheduledEnd,
      record,
    };
  });

  const assignmentsWithoutRecord = assignments.data.filter(
    (assignment) => !records.data.some((row) => row.shift_assignment_id === assignment.id),
  );

  if (assignmentsWithoutRecord.length > 0) {
    const { data: staff, error: staffError } = await supabase
      .from("staff_directory")
      .select("id, full_name, employee_number, department_id, department_name")
      .eq("hospital_id", hospitalId)
      .in("id", [...new Set(assignmentsWithoutRecord.map((assignment) => assignment.staff_id))]);
    if (staffError) throw dataError("load staff", staffError);

    const staffById = new Map(staff.map((member) => [member.id, member]));
    const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]));

    for (const assignment of assignmentsWithoutRecord) {
      const member = staffById.get(assignment.staff_id);
      if (!member || (departmentId && member.department_id !== departmentId)) continue;
      const shift = shiftsById.get(assignment.shift_id);
      rows.push({
        key: assignment.id,
        staffId: assignment.staff_id,
        staffName: required(member.full_name, "full_name"),
        employeeNumber: required(member.employee_number, "employee_number"),
        departmentName: required(member.department_name, "department_name"),
        shiftLabel: shift ? `${shift.code} · ${shift.name}` : null,
        scheduledStart: assignment.starts_at,
        scheduledEnd: assignment.ends_at,
        record: null,
      });
    }
  }

  return rows.sort((a, b) => a.staffName.localeCompare(b.staffName) || (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? ""));
}
