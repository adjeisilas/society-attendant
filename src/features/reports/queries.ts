import "server-only";
import { dataError } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reportDailySchema, reportSummarySchema } from "./schemas";

export interface AttendanceSummaryRow {
  staffId: string;
  staffName: string;
  employeeNumber: string;
  departmentName: string;
  recordedDays: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  halfDayCount: number;
  workedMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  missedCheckOutCount: number;
}

export interface AttendanceDailyRow {
  workDate: string;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  halfDayCount: number;
}

export interface ReportRange {
  from: string;
  to: string;
  departmentId?: string;
}

/**
 * Both reports run as the caller, so Row Level Security decides what they cover:
 * a hospital admin sees the hospital, a department head their departments.
 */
export async function getAttendanceSummary(hospitalId: string, range: ReportRange): Promise<AttendanceSummaryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("report_attendance_summary", {
    p_hospital_id: hospitalId,
    p_from: range.from,
    p_to: range.to,
    p_department_id: range.departmentId ?? undefined,
  });
  if (error) throw dataError("build the attendance report", error);

  return reportSummarySchema.parse(data).map((row) => ({
    staffId: row.staff_id,
    staffName: row.staff_name,
    employeeNumber: row.employee_number,
    departmentName: row.department_name,
    recordedDays: row.recorded_days,
    presentCount: row.present_count,
    lateCount: row.late_count,
    absentCount: row.absent_count,
    halfDayCount: row.half_day_count,
    workedMinutes: row.worked_minutes,
    overtimeMinutes: row.overtime_minutes,
    lateMinutes: row.late_minutes,
    missedCheckOutCount: row.missed_check_out_count,
  }));
}

export async function getAttendanceByDay(hospitalId: string, range: ReportRange): Promise<AttendanceDailyRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("report_attendance_by_day", {
    p_hospital_id: hospitalId,
    p_from: range.from,
    p_to: range.to,
    p_department_id: range.departmentId ?? undefined,
  });
  if (error) throw dataError("build the attendance chart", error);

  return reportDailySchema.parse(data).map((row) => ({
    workDate: row.work_date,
    presentCount: row.present_count,
    lateCount: row.late_count,
    absentCount: row.absent_count,
    halfDayCount: row.half_day_count,
  }));
}
