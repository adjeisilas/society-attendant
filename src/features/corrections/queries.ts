import "server-only";
import type { AttendanceStatus } from "@/features/attendance/labels";
import type { RequestStatus } from "@/lib/request-status";
import { dataError, required } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { CorrectionFilters } from "./schemas";

export interface CorrectionView {
  id: string;
  staffId: string;
  staffName: string;
  employeeNumber: string;
  departmentId: string;
  departmentName: string;
  attendanceRecordId: string;
  workDate: string;
  recordStatus: AttendanceStatus;
  currentCheckInAt: string | null;
  currentCheckOutAt: string | null;
  requestedCheckInAt: string | null;
  requestedCheckOutAt: string | null;
  reason: string;
  status: RequestStatus;
  requestedBy: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  evidencePath: string | null;
  createdAt: string;
}

const COLUMNS =
  "id, staff_id, staff_name, employee_number, department_id, department_name, attendance_record_id, work_date, record_status, current_check_in_at, current_check_out_at, requested_check_in_at, requested_check_out_at, reason, status, requested_by, reviewed_by_name, reviewed_at, review_note, evidence_path, created_at";

type OverviewRow = Pick<
  Database["public"]["Views"]["attendance_corrections_overview"]["Row"],
  | "id"
  | "staff_id"
  | "staff_name"
  | "employee_number"
  | "department_id"
  | "department_name"
  | "attendance_record_id"
  | "work_date"
  | "record_status"
  | "current_check_in_at"
  | "current_check_out_at"
  | "requested_check_in_at"
  | "requested_check_out_at"
  | "reason"
  | "status"
  | "requested_by"
  | "reviewed_by_name"
  | "reviewed_at"
  | "review_note"
  | "evidence_path"
  | "created_at"
>;

function toCorrection(row: OverviewRow): CorrectionView {
  return {
    id: required(row.id, "id"),
    staffId: required(row.staff_id, "staff_id"),
    staffName: required(row.staff_name, "staff_name"),
    employeeNumber: required(row.employee_number, "employee_number"),
    departmentId: required(row.department_id, "department_id"),
    departmentName: required(row.department_name, "department_name"),
    attendanceRecordId: required(row.attendance_record_id, "attendance_record_id"),
    workDate: required(row.work_date, "work_date"),
    recordStatus: required(row.record_status, "record_status"),
    currentCheckInAt: row.current_check_in_at,
    currentCheckOutAt: row.current_check_out_at,
    requestedCheckInAt: row.requested_check_in_at,
    requestedCheckOutAt: row.requested_check_out_at,
    reason: required(row.reason, "reason"),
    status: required(row.status, "status"),
    requestedBy: required(row.requested_by, "requested_by"),
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    evidencePath: row.evidence_path,
    createdAt: required(row.created_at, "created_at"),
  };
}

export async function listCorrections(hospitalId: string, filters: CorrectionFilters): Promise<CorrectionView[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("attendance_corrections_overview").select(COLUMNS).eq("hospital_id", hospitalId);
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.department) query = query.eq("department_id", filters.department);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw dataError("list attendance corrections", error);
  return data.map(toCorrection);
}

export async function getCorrection(hospitalId: string, correctionId: string): Promise<CorrectionView | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_corrections_overview")
    .select(COLUMNS)
    .eq("hospital_id", hospitalId)
    .eq("id", correctionId)
    .maybeSingle();
  if (error) throw dataError("load attendance correction", error);
  return data && toCorrection(data);
}

/** Corrections raised against one attendance record, newest first. */
export async function listCorrectionsForRecord(attendanceRecordId: string): Promise<CorrectionView[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_corrections_overview")
    .select(COLUMNS)
    .eq("attendance_record_id", attendanceRecordId)
    .order("created_at", { ascending: false });
  if (error) throw dataError("load corrections", error);
  return data.map(toCorrection);
}
