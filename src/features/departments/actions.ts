"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  actionFailure,
  actionSuccess,
  CHECK_FIELDS_MESSAGE,
  NO_HOSPITAL_MESSAGE,
  validationFailure,
  type ActionFailure,
  type ActionResult,
} from "@/lib/forms/action-result";
import { requireHospitalScope } from "@/lib/hospital-context";
import { dataError, isUniqueViolation } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRecordId } from "@/lib/validation";
import { departmentSchema } from "./schemas";

const NOT_FOUND_MESSAGE = "This department no longer exists or you cannot edit it.";

export async function createDepartment(input: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("departments.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);

  const parsed = departmentSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { name, code, description, isActive } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("departments")
    .insert({ hospital_id: hospital.id, name, code, description, is_active: isActive })
    .select("id")
    .single();
  if (error) return saveFailure(error);

  redirect(`/departments/${data.id}`);
}

export async function updateDepartment(departmentId: unknown, input: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("departments.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(departmentId)) return actionFailure(NOT_FOUND_MESSAGE);

  const parsed = departmentSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { name, code, description, headStaffId, isActive } = parsed.data;

  const supabase = await createSupabaseServerClient();

  if (headStaffId) {
    const { data: head, error } = await supabase
      .from("staff")
      .select("id")
      .eq("id", headStaffId)
      .eq("hospital_id", hospital.id)
      .eq("department_id", departmentId)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw dataError("check department head", error);
    if (!head) {
      return actionFailure(CHECK_FIELDS_MESSAGE, { headStaffId: ["Choose an active member of this department."] });
    }
  }

  const { data, error } = await supabase
    .from("departments")
    .update({ name, code, description, head_staff_id: headStaffId, is_active: isActive })
    .eq("id", departmentId)
    .eq("hospital_id", hospital.id)
    .select("id")
    .maybeSingle();
  if (error) return saveFailure(error);
  if (!data) return actionFailure(NOT_FOUND_MESSAGE);

  refresh();
  return actionSuccess(null);
}

function saveFailure(error: PostgrestError): ActionFailure {
  if (isUniqueViolation(error, "departments_hospital_code_key")) {
    return actionFailure(CHECK_FIELDS_MESSAGE, { code: ["Another department already uses this code."] });
  }
  if (isUniqueViolation(error, "departments_hospital_name_key")) {
    return actionFailure(CHECK_FIELDS_MESSAGE, { name: ["Another department already has this name."] });
  }
  throw dataError("save department", error);
}
