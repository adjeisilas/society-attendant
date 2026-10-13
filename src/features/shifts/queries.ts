import "server-only";
import { listDepartmentOptions } from "@/features/departments/queries";
import { dataError } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";
import { formatShiftTimes, shiftTiming } from "./time";

export interface ShiftSummary {
  id: string;
  name: string;
  code: string;
  departmentId: string | null;
  departmentName: string | null;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  timesLabel: string;
  durationMinutes: number;
  breakMinutes: number;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  overtimeThresholdMinutes: number;
  checkInOpensMinutes: number;
  isActive: boolean;
}

const SHIFT_COLUMNS =
  "id, name, code, department_id, start_time, duration_minutes, break_minutes, late_grace_minutes, early_leave_grace_minutes, overtime_threshold_minutes, check_in_opens_minutes, is_active";

type ShiftRow = Pick<
  Tables<"shifts">,
  | "id"
  | "name"
  | "code"
  | "department_id"
  | "start_time"
  | "duration_minutes"
  | "break_minutes"
  | "late_grace_minutes"
  | "early_leave_grace_minutes"
  | "overtime_threshold_minutes"
  | "check_in_opens_minutes"
  | "is_active"
>;

function toShiftSummary(row: ShiftRow, departmentNames: ReadonlyMap<string, string>): ShiftSummary {
  const timing = shiftTiming(row.start_time, row.duration_minutes);
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    departmentId: row.department_id,
    departmentName: row.department_id ? (departmentNames.get(row.department_id) ?? null) : null,
    startTime: timing.startTime,
    endTime: timing.endTime,
    endsNextDay: timing.endsNextDay,
    timesLabel: formatShiftTimes(row.start_time, row.duration_minutes),
    durationMinutes: row.duration_minutes,
    breakMinutes: row.break_minutes,
    lateGraceMinutes: row.late_grace_minutes,
    earlyLeaveGraceMinutes: row.early_leave_grace_minutes,
    overtimeThresholdMinutes: row.overtime_threshold_minutes,
    checkInOpensMinutes: row.check_in_opens_minutes,
    isActive: row.is_active,
  };
}

async function departmentNameMap(hospitalId: string): Promise<Map<string, string>> {
  const departments = await listDepartmentOptions(hospitalId);
  return new Map(departments.map((department) => [department.id, department.name]));
}

export async function listShifts(hospitalId: string): Promise<ShiftSummary[]> {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, departmentNames] = await Promise.all([
    supabase.from("shifts").select(SHIFT_COLUMNS).eq("hospital_id", hospitalId).order("start_time").order("name"),
    departmentNameMap(hospitalId),
  ]);
  if (error) throw dataError("list shifts", error);
  return data.map((row) => toShiftSummary(row, departmentNames));
}

export async function getShift(hospitalId: string, shiftId: string): Promise<ShiftSummary | null> {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, departmentNames] = await Promise.all([
    supabase.from("shifts").select(SHIFT_COLUMNS).eq("hospital_id", hospitalId).eq("id", shiftId).maybeSingle(),
    departmentNameMap(hospitalId),
  ]);
  if (error) throw dataError("load shift", error);
  return data && toShiftSummary(data, departmentNames);
}
