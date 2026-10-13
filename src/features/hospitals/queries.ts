import "server-only";
import { dataError } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface HospitalDetails {
  id: string;
  name: string;
  code: string;
  timezone: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
}

const COLUMNS = "id, name, code, timezone, address, phone, email, is_active";

export async function getHospital(hospitalId: string): Promise<HospitalDetails | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("hospitals").select(COLUMNS).eq("id", hospitalId).maybeSingle();
  if (error) throw dataError("load hospital", error);
  return (
    data && {
      id: data.id,
      name: data.name,
      code: data.code,
      timezone: data.timezone,
      address: data.address,
      phone: data.phone,
      email: data.email,
      isActive: data.is_active,
    }
  );
}

/** Whether a hospital record exists at all, active or not. RLS shows super admins every hospital. */
export async function hospitalRecordExists(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase.from("hospitals").select("id", { count: "exact", head: true });
  if (error) throw dataError("check for the hospital", error);
  return (count ?? 0) > 0;
}

/** IANA time zones for the time zone picker, keeping a saved zone the runtime does not list. */
export function timeZoneOptions(current?: string): { value: string; label: string }[] {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  zones.add("UTC");
  if (current) zones.add(current);
  return [...zones].sort().map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }));
}
