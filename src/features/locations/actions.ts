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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRecordId } from "@/lib/validation";
import { attendanceLocationSchema } from "./schemas";

const NOT_FOUND_MESSAGE = "This location no longer exists or you cannot change it.";

export async function createAttendanceLocation(input: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("locations.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);

  const parsed = attendanceLocationSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_locations")
    .insert({ hospital_id: hospital.id, ...toColumns(parsed.data) })
    .select("id")
    .single();
  if (error) return saveFailure(error);

  redirect(`/locations/${data.id}`);
}

export async function updateAttendanceLocation(locationId: unknown, input: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("locations.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(locationId)) return actionFailure(NOT_FOUND_MESSAGE);

  const parsed = attendanceLocationSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_locations")
    .update(toColumns(parsed.data))
    .eq("id", locationId)
    .eq("hospital_id", hospital.id)
    .select("id")
    .maybeSingle();
  if (error) return saveFailure(error);
  if (!data) return actionFailure(NOT_FOUND_MESSAGE);

  refresh();
  return actionSuccess(null);
}

function toColumns(values: z.output<typeof attendanceLocationSchema>) {
  return { name: values.name, description: values.description, is_active: values.isActive };
}

function saveFailure(error: PostgrestError): ActionFailure {
  if (isUniqueViolation(error, "attendance_locations_hospital_name_key")) {
    return actionFailure(CHECK_FIELDS_MESSAGE, { name: ["Another location already has this name."] });
  }
  throw dataError("save attendance location", error);
}
