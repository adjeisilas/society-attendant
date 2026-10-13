import "server-only";
import { dataError } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface HospitalSettings {
  allowUnscheduledCheckIn: boolean;
  minSessionMinutes: number;
  checkOutWindowMinutes: number;
  halfDayThresholdPercent: number;
}

export async function getHospitalSettings(hospitalId: string): Promise<HospitalSettings | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("hospital_settings")
    .select("allow_unscheduled_check_in, min_session_minutes, check_out_window_minutes, half_day_threshold_percent")
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  if (error) throw dataError("load hospital settings", error);
  if (!data) return null;

  return {
    allowUnscheduledCheckIn: data.allow_unscheduled_check_in,
    minSessionMinutes: data.min_session_minutes,
    checkOutWindowMinutes: data.check_out_window_minutes,
    halfDayThresholdPercent: data.half_day_threshold_percent,
  };
}
