import "server-only";
import { dataError, required } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export interface DepartmentSummary {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  headStaffId: string | null;
  headName: string | null;
  activeStaffCount: number;
}

export interface DepartmentOption {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

export interface StaffOption {
  id: string;
  label: string;
}

const DIRECTORY_COLUMNS = "id, name, code, description, is_active, head_staff_id, head_name, active_staff_count";

type DirectoryRow = Pick<
  Database["public"]["Views"]["department_directory"]["Row"],
  "id" | "name" | "code" | "description" | "is_active" | "head_staff_id" | "head_name" | "active_staff_count"
>;

function toDepartmentSummary(row: DirectoryRow): DepartmentSummary {
  return {
    id: required(row.id, "id"),
    name: required(row.name, "name"),
    code: required(row.code, "code"),
    description: row.description,
    isActive: required(row.is_active, "is_active"),
    headStaffId: row.head_staff_id,
    headName: row.head_name,
    activeStaffCount: row.active_staff_count ?? 0,
  };
}

export async function listDepartments(hospitalId: string): Promise<DepartmentSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("department_directory")
    .select(DIRECTORY_COLUMNS)
    .eq("hospital_id", hospitalId)
    .order("name");
  if (error) throw dataError("list departments", error);
  return data.map(toDepartmentSummary);
}

export async function getDepartment(hospitalId: string, departmentId: string): Promise<DepartmentSummary | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("department_directory")
    .select(DIRECTORY_COLUMNS)
    .eq("hospital_id", hospitalId)
    .eq("id", departmentId)
    .maybeSingle();
  if (error) throw dataError("load department", error);
  return data && toDepartmentSummary(data);
}

export async function listDepartmentOptions(hospitalId: string): Promise<DepartmentOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("departments")
    .select("id, name, code, is_active")
    .eq("hospital_id", hospitalId)
    .order("name");
  if (error) throw dataError("list departments", error);
  return data.map((row) => ({ id: row.id, name: row.name, code: row.code, isActive: row.is_active }));
}

/** Active members of the department, who may be appointed as its head. */
export async function listHeadCandidates(hospitalId: string, departmentId: string): Promise<StaffOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, first_name, last_name, employee_number")
    .eq("hospital_id", hospitalId)
    .eq("department_id", departmentId)
    .eq("status", "active")
    .order("last_name")
    .order("first_name");
  if (error) throw dataError("list department members", error);
  return data.map((row) => ({ id: row.id, label: `${row.first_name} ${row.last_name} · ${row.employee_number}` }));
}
