import "server-only";
import type { AppRole } from "@/lib/auth/permissions";
import { dataError, escapeLikePattern, isRangeNotSatisfiable, required } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { accountStateOf, type AccountState, type EmploymentType, type StaffStatus } from "./labels";
import { STAFF_PAGE_SIZE, type StaffFilters } from "./schemas";

export interface StaffMember {
  id: string;
  departmentId: string;
  departmentName: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string;
  employmentType: EmploymentType;
  status: StaffStatus;
  hireDate: string;
  terminationDate: string | null;
  accountState: AccountState;
  accountRole: AppRole | null;
  accountActivatedAt: string | null;
}

const STAFF_COLUMNS =
  "id, department_id, department_name, employee_number, first_name, last_name, full_name, email, phone, job_title, employment_type, status, hire_date, termination_date, user_id, account_role, account_is_active, account_activated_at";

type StaffDirectoryRow = Pick<
  Database["public"]["Views"]["staff_directory"]["Row"],
  | "id"
  | "department_id"
  | "department_name"
  | "employee_number"
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "job_title"
  | "employment_type"
  | "status"
  | "hire_date"
  | "termination_date"
  | "user_id"
  | "account_role"
  | "account_is_active"
  | "account_activated_at"
>;

function toStaffMember(row: StaffDirectoryRow): StaffMember {
  return {
    id: required(row.id, "id"),
    departmentId: required(row.department_id, "department_id"),
    departmentName: required(row.department_name, "department_name"),
    employeeNumber: required(row.employee_number, "employee_number"),
    firstName: required(row.first_name, "first_name"),
    lastName: required(row.last_name, "last_name"),
    fullName: required(row.full_name, "full_name"),
    email: row.email,
    phone: row.phone,
    jobTitle: required(row.job_title, "job_title"),
    employmentType: required(row.employment_type, "employment_type"),
    status: required(row.status, "status"),
    hireDate: required(row.hire_date, "hire_date"),
    terminationDate: row.termination_date,
    accountState: accountStateOf({
      userId: row.user_id,
      accountIsActive: row.account_is_active,
      accountActivatedAt: row.account_activated_at,
    }),
    accountRole: row.account_role,
    accountActivatedAt: row.account_activated_at,
  };
}

/** One page of staff visible to the user (RLS limits department heads to their departments). */
export async function listStaff(
  hospitalId: string,
  filters: StaffFilters,
): Promise<{ members: StaffMember[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("staff_directory").select(STAFF_COLUMNS, { count: "exact" }).eq("hospital_id", hospitalId);

  if (filters.department) query = query.eq("department_id", filters.department);
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.q) query = query.ilike("search_text", `%${escapeLikePattern(filters.q.toLowerCase())}%`);

  const from = (filters.page - 1) * STAFF_PAGE_SIZE;
  const { data, error, count } = await query
    .order("last_name")
    .order("first_name")
    .range(from, from + STAFF_PAGE_SIZE - 1);

  if (error && isRangeNotSatisfiable(error)) return { members: [], total: 0 };
  if (error) throw dataError("list staff", error);
  return { members: data.map(toStaffMember), total: count ?? data.length };
}

export async function getStaffMember(hospitalId: string, staffId: string): Promise<StaffMember | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("staff_directory")
    .select(STAFF_COLUMNS)
    .eq("hospital_id", hospitalId)
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw dataError("load staff member", error);
  return data && toStaffMember(data);
}
