"use server";

import { refresh } from "next/cache";
import { requireCapability } from "@/lib/auth/session";
import { actionFailure, actionSuccess, validationFailure, type ActionResult } from "@/lib/forms/action-result";
import { dataError, raisedErrorCode } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRecordId } from "@/lib/validation";
import { correctionErrorMessage } from "./labels";
import { correctionRequestSchema, reviewSchema } from "./schemas";

export async function requestCorrection(attendanceRecordId: unknown, input: unknown): Promise<ActionResult<{ id: string }>> {
  await requireCapability(["corrections.request", "corrections.review"]);
  if (!isRecordId(attendanceRecordId)) return actionFailure(correctionErrorMessage("RECORD_NOT_FOUND"));

  const parsed = correctionRequestSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("request_attendance_correction", {
    p_attendance_record_id: attendanceRecordId,
    p_reason: parsed.data.reason,
    p_check_in_at: parsed.data.checkInAt ?? undefined,
    p_check_out_at: parsed.data.checkOutAt ?? undefined,
    p_evidence_path: parsed.data.evidencePath ?? undefined,
  });
  if (error) return correctionFailure(error, "request an attendance correction");

  refresh();
  return actionSuccess({ id: data });
}

export async function cancelCorrection(correctionId: unknown): Promise<ActionResult> {
  await requireCapability(["corrections.request", "corrections.review"]);
  if (!isRecordId(correctionId)) return actionFailure(correctionErrorMessage("REQUEST_NOT_FOUND"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_attendance_correction", { p_correction_id: correctionId });
  if (error) return correctionFailure(error, "withdraw the correction");

  refresh();
  return actionSuccess(null);
}

export async function reviewCorrection(correctionId: unknown, input: unknown): Promise<ActionResult> {
  await requireCapability("corrections.review");
  if (!isRecordId(correctionId)) return actionFailure(correctionErrorMessage("REQUEST_NOT_FOUND"));

  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("review_attendance_correction", {
    p_correction_id: correctionId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note || undefined,
  });
  if (error) return correctionFailure(error, "review the correction");

  refresh();
  return actionSuccess(null);
}

function correctionFailure(error: Parameters<typeof raisedErrorCode>[0], operation: string) {
  const code = raisedErrorCode(error);
  if (!code) throw dataError(operation, error);
  return actionFailure(correctionErrorMessage(code));
}
