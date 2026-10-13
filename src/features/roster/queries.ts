import "server-only";
import { listShifts } from "@/features/shifts/queries";
import { weekDates } from "@/lib/dates";
import { dataError } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface RosterStaff {
  id: string;
  fullName: string;
  jobTitle: string;
  employeeNumber: string;
}

export interface RosterAssignment {
  id: string;
  staffId: string;
  workDate: string;
  shiftCode: string;
  shiftName: string;
  timesLabel: string;
}

export interface RosterWeek {
  days: string[];
  staff: RosterStaff[];
  /** Assignments keyed by rosterCellKey(staffId, workDate). */
  assignmentsByCell: Record<string, RosterAssignment[]>;
}

export function rosterCellKey(staffId: string, workDate: string): string {
  return `${staffId}|${workDate}`;
}

export async function listRosterStaff(hospitalId: string, departmentId: string): Promise<RosterStaff[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, first_name, last_name, job_title, employee_number")
    .eq("hospital_id", hospitalId)
    .eq("department_id", departmentId)
    .eq("status", "active")
    .order("last_name")
    .order("first_name");
  if (error) throw dataError("list department staff", error);
  return data.map((row) => ({
    id: row.id,
    fullName: `${row.first_name} ${row.last_name}`,
    jobTitle: row.job_title,
    employeeNumber: row.employee_number,
  }));
}

export async function getRosterWeek(hospitalId: string, departmentId: string, weekStart: string): Promise<RosterWeek> {
  const days = weekDates(weekStart);
  const supabase = await createSupabaseServerClient();

  const [staff, shifts, assignments] = await Promise.all([
    listRosterStaff(hospitalId, departmentId),
    listShifts(hospitalId),
    supabase
      .from("shift_assignments")
      .select("id, staff_id, shift_id, work_date")
      .eq("hospital_id", hospitalId)
      .eq("status", "scheduled")
      .gte("work_date", days[0])
      .lte("work_date", days[days.length - 1])
      .order("starts_at"),
  ]);
  if (assignments.error) throw dataError("list roster", assignments.error);

  const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]));
  const staffIds = new Set(staff.map((member) => member.id));
  const assignmentsByCell: Record<string, RosterAssignment[]> = {};

  for (const row of assignments.data) {
    // The query covers the whole hospital; keep the rows for this department's staff.
    if (!staffIds.has(row.staff_id)) continue;
    const shift = shiftsById.get(row.shift_id);
    if (!shift) continue;
    const key = rosterCellKey(row.staff_id, row.work_date);
    (assignmentsByCell[key] ??= []).push({
      id: row.id,
      staffId: row.staff_id,
      workDate: row.work_date,
      shiftCode: shift.code,
      shiftName: shift.name,
      timesLabel: shift.timesLabel,
    });
  }

  return { days, staff, assignmentsByCell };
}
