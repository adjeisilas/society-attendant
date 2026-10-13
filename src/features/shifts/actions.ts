"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
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
import { createSupabaseServerClient, type SupabaseServerClient } from "@/lib/supabase/server";
import { isRecordId } from "@/lib/validation";
import { shiftSchema } from "./schemas";

const NOT_FOUND_MESSAGE = "This shift no longer exists or you cannot edit it.";

export async function createShift(input: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("shifts.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);

  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const departmentProblem = await checkDepartment(supabase, hospital.id, parsed.data.departmentId, null);
  if (departmentProblem) return departmentProblem;

  const { data, error } = await supabase
    .from("shifts")
    .insert({ hospital_id: hospital.id, ...toShiftColumns(parsed.data) })
    .select("id")
    .single();
  if (error) return saveFailure(error);

  redirect(`/shifts/${data.id}`);
}

export async function updateShift(shiftId: unknown, input: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("shifts.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(shiftId)) return actionFailure(NOT_FOUND_MESSAGE);

  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data: current, error: currentError } = await supabase
    .from("shifts")
    .select("department_id")
    .eq("id", shiftId)
    .eq("hospital_id", hospital.id)
    .maybeSingle();
  if (currentError) throw dataError("load shift", currentError);
  if (!current) return actionFailure(NOT_FOUND_MESSAGE);

  const departmentProblem = await checkDepartment(supabase, hospital.id, parsed.data.departmentId, current.department_id);
  if (departmentProblem) return departmentProblem;

  const { data, error } = await supabase
    .from("shifts")
    .update(toShiftColumns(parsed.data))
    .eq("id", shiftId)
    .eq("hospital_id", hospital.id)
    .select("id")
    .maybeSingle();
  if (error) return saveFailure(error);
  if (!data) return actionFailure(NOT_FOUND_MESSAGE);

  refresh();
  return actionSuccess(null);
}

function toShiftColumns(values: z.output<typeof shiftSchema>) {
  return {
    name: values.name,
    code: values.code,
    department_id: values.departmentId,
    start_time: values.startTime,
    duration_minutes: values.durationMinutes,
    break_minutes: values.breakMinutes,
    late_grace_minutes: values.lateGraceMinutes,
    early_leave_grace_minutes: values.earlyLeaveGraceMinutes,
    overtime_threshold_minutes: values.overtimeThresholdMinutes,
    check_in_opens_minutes: values.checkInOpensMinutes,
    is_active: values.isActive,
  };
}

async function checkDepartment(
  supabase: SupabaseServerClient,
  hospitalId: string,
  departmentId: string | null,
  currentDepartmentId: string | null,
): Promise<ActionFailure | null> {
  if (!departmentId) return null;
  const { data, error } = await supabase
    .from("departments")
    .select("is_active")
    .eq("id", departmentId)
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  if (error) throw dataError("check department", error);
  if (data && (data.is_active || departmentId === currentDepartmentId)) return null;
  return actionFailure(CHECK_FIELDS_MESSAGE, { departmentId: ["Select an active department, or all departments."] });
}

function saveFailure(error: PostgrestError): ActionFailure {
  if (isUniqueViolation(error, "shifts_hospital_code_key")) {
    return actionFailure(CHECK_FIELDS_MESSAGE, { code: ["Another shift already uses this code."] });
  }
  if (error.code === "23P01") {
    return actionFailure(
      "These times would make rostered shifts overlap for some staff. Adjust the roster first, or create a new shift template.",
      { endTime: ["Overlaps with other rostered shifts."] },
    );
  }
  throw dataError("save shift", error);
}
