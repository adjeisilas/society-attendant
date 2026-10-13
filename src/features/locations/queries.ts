import "server-only";
import { dataError } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AttendanceLocationSummary {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

const LOCATION_COLUMNS = "id, name, description, is_active";

function toSummary(row: { id: string; name: string; description: string | null; is_active: boolean }): AttendanceLocationSummary {
  return { id: row.id, name: row.name, description: row.description, isActive: row.is_active };
}

export async function listAttendanceLocations(hospitalId: string): Promise<AttendanceLocationSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_locations")
    .select(LOCATION_COLUMNS)
    .eq("hospital_id", hospitalId)
    .order("name");
  if (error) throw dataError("list attendance locations", error);
  return data.map(toSummary);
}

export async function getAttendanceLocation(
  hospitalId: string,
  locationId: string,
): Promise<AttendanceLocationSummary | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_locations")
    .select(LOCATION_COLUMNS)
    .eq("hospital_id", hospitalId)
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw dataError("load attendance location", error);
  return data && toSummary(data);
}
