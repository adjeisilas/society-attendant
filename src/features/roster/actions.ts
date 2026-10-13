"use server";

import { refresh } from "next/cache";
import {
  actionFailure,
  actionSuccess,
  CHECK_FIELDS_MESSAGE,
  NO_HOSPITAL_MESSAGE,
  validationFailure,
  type ActionResult,
} from "@/lib/forms/action-result";
import { datesOnWeekdays } from "@/lib/dates";
import { requireHospitalScope } from "@/lib/hospital-context";
import { dataError, isForeignKeyViolation, raisedErrorCode } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRecordId } from "@/lib/validation";
import { assignmentOutcomeSchema, assignShiftsSchema, type AssignShiftsOutcome } from "./schemas";

export async function assignShifts(input: unknown): Promise<ActionResult<AssignShiftsOutcome>> {
  const { hospital } = await requireHospitalScope("shifts.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);

  const parsed = assignShiftsSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { shiftId, staffIds, startDate, endDate, weekdays } = parsed.data;

  const workDates = datesOnWeekdays(startDate, endDate, weekdays);
  if (workDates.length === 0) {
    return actionFailure(CHECK_FIELDS_MESSAGE, {
      weekdays: ["None of the selected days fall between the start and end dates."],
    });
  }

  const supabase = await createSupabaseServerClient();
  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .select("id")
    .eq("id", shiftId)
    .eq("hospital_id", hospital.id)
    .eq("is_active", true)
    .maybeSingle();
  if (shiftError) throw dataError("load shift", shiftError);
  if (!shift) return actionFailure(CHECK_FIELDS_MESSAGE, { shiftId: ["Select an active shift of this hospital."] });

  const { data, error } = await supabase.rpc("create_shift_assignments", {
    p_shift_id: shiftId,
    p_staff_ids: staffIds,
    p_work_dates: workDates,
  });

  if (error) {
    if (isForeignKeyViolation(error)) {
      return actionFailure("Some of the selected staff do not belong to this hospital.");
    }
    switch (raisedErrorCode(error)) {
      case "TOO_MANY_ASSIGNMENTS":
        return actionFailure("That is too many shifts at once. Choose fewer staff or a shorter date range.");
      case "SHIFT_NOT_ACTIVE":
        return actionFailure(CHECK_FIELDS_MESSAGE, { shiftId: ["Select an active shift."] });
      case "NOTHING_TO_ASSIGN":
        return actionFailure(CHECK_FIELDS_MESSAGE, { staffIds: ["Select at least one staff member."] });
      default:
        throw dataError("assign shifts", error);
    }
  }

  const outcome = assignmentOutcomeSchema.parse(data);
  refresh();
  return actionSuccess({
    created: outcome.created,
    skipped: outcome.skipped.map((entry) => ({
      staffId: entry.staff_id,
      workDate: entry.work_date,
      reason: entry.reason,
    })),
  });
}

export async function cancelAssignment(assignmentId: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("shifts.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(assignmentId)) return actionFailure("This rostered shift no longer exists.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("shift_assignments")
    .update({ status: "cancelled" })
    .eq("id", assignmentId)
    .eq("hospital_id", hospital.id)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (error) throw dataError("cancel rostered shift", error);
  if (!data) return actionFailure("This rostered shift has already been cancelled or no longer exists.");

  refresh();
  return actionSuccess(null);
}
