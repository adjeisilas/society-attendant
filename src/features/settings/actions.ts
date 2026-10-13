"use server";

import { refresh } from "next/cache";
import {
  actionFailure,
  actionSuccess,
  NO_HOSPITAL_MESSAGE,
  validationFailure,
  type ActionResult,
} from "@/lib/forms/action-result";
import { requireHospitalScope } from "@/lib/hospital-context";
import { dataError } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hospitalSettingsSchema } from "./schemas";

export async function updateHospitalSettings(input: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("settings.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);

  const parsed = hospitalSettingsSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("hospital_settings")
    .update({
      allow_unscheduled_check_in: parsed.data.allowUnscheduledCheckIn,
      min_session_minutes: parsed.data.minSessionMinutes,
      check_out_window_minutes: parsed.data.checkOutWindowMinutes,
      half_day_threshold_percent: parsed.data.halfDayThresholdPercent,
    })
    .eq("hospital_id", hospital.id)
    .select("hospital_id")
    .maybeSingle();
  if (error) throw dataError("save hospital settings", error);
  if (!data) return actionFailure("These settings could not be saved. Try again.");

  refresh();
  return actionSuccess(null);
}
