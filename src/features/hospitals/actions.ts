"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { routes } from "@/lib/auth/routes";
import { requireCapability } from "@/lib/auth/session";
import {
  actionFailure,
  actionSuccess,
  CHECK_FIELDS_MESSAGE,
  validationFailure,
  type ActionFailure,
  type ActionResult,
} from "@/lib/forms/action-result";
import { dataError, isUniqueViolation, raisedErrorCode } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRecordId } from "@/lib/validation";
import { hospitalSchema } from "./schemas";

const NOT_FOUND_MESSAGE = "The hospital could not be found, or you cannot edit it.";

/** Creates the hospital. The database allows this only while no hospital exists. */
export async function setUpHospital(input: unknown): Promise<ActionResult> {
  await requireCapability("hospitals.manage");

  const parsed = hospitalSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("hospitals").insert(parsed.data);
  if (error?.code === "42501") {
    return actionFailure("The hospital has already been set up. Edit its details in Settings.");
  }
  if (error) return saveFailure(error);

  redirect(routes.home);
}

export async function updateHospitalDetails(hospitalId: unknown, input: unknown): Promise<ActionResult> {
  await requireCapability("hospitals.manage");
  if (!isRecordId(hospitalId)) return actionFailure(NOT_FOUND_MESSAGE);

  const parsed = hospitalSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("hospitals")
    .update(parsed.data)
    .eq("id", hospitalId)
    .select("id")
    .maybeSingle();
  if (error) return saveFailure(error);
  if (!data) return actionFailure(NOT_FOUND_MESSAGE);

  refresh();
  return actionSuccess(null);
}

function saveFailure(error: PostgrestError): ActionFailure {
  if (isUniqueViolation(error, "hospitals_code_key")) {
    return actionFailure(CHECK_FIELDS_MESSAGE, { code: ["This code is already in use."] });
  }
  if (raisedErrorCode(error) === "INVALID_TIMEZONE") {
    return actionFailure(CHECK_FIELDS_MESSAGE, { timezone: ["Choose a time zone from the list."] });
  }
  throw dataError("save hospital", error);
}
