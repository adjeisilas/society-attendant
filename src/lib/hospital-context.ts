import "server-only";
import { cache } from "react";
import type { Capability } from "@/lib/auth/permissions";
import { requireCapability, type HospitalSummary, type SessionUser } from "@/lib/auth/session";
import { dataError } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The hospital, as seen by a super admin, whose account is not tied to it. The system
 * serves a single hospital; an installation that still has several uses the oldest.
 */
const getHospitalForSuperAdmin = cache(async (): Promise<HospitalSummary | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("hospitals")
    .select("id, name, code, timezone")
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw dataError("load the hospital", error);
  return data;
});

/**
 * The hospital whose records the user works with. Null only for a super admin before
 * the hospital has been set up.
 */
export async function getWorkingHospital(user: SessionUser): Promise<HospitalSummary | null> {
  return user.role === "super_admin" ? getHospitalForSuperAdmin() : user.hospital;
}

/** Guard for pages and server actions that work with the hospital's records. */
export async function requireHospitalScope(capability: Capability | readonly Capability[]) {
  const user = await requireCapability(capability);
  return { user, hospital: await getWorkingHospital(user) };
}
