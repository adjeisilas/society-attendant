import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { dataError, required } from "@/lib/supabase/data";
import { createIsolatedSupabaseClient } from "@/lib/supabase/isolated";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TERMINAL_COOKIE, TERMINAL_KEY_PATTERN } from "./constants";
import { terminalContextSchema } from "./schemas";

export interface TerminalContext {
  id: string;
  name: string;
  locationName: string;
  hospitalName: string;
  timeZone: string;
}

export interface TerminalSummary {
  id: string;
  locationId: string;
  locationName: string;
  name: string;
  createdAt: string;
  createdByName: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** The terminal key this browser holds, if it is shaped like one. */
export async function readTerminalKey(): Promise<string | null> {
  const value = (await cookies()).get(TERMINAL_COOKIE)?.value;
  return value && TERMINAL_KEY_PATTERN.test(value) ? value : null;
}

/** Looks up an active terminal by its key. Works without a signed-in user. */
export async function resolveTerminal(key: string): Promise<TerminalContext | null> {
  const supabase = createIsolatedSupabaseClient();
  const { data, error } = await supabase.rpc("terminal_context", { p_terminal_key: key });
  if (error) throw dataError("identify this terminal", error);
  if (data === null) return null;

  const terminal = terminalContextSchema.parse(data);
  return {
    id: terminal.terminal_id,
    name: terminal.terminal_name,
    locationName: terminal.location_name,
    hospitalName: terminal.hospital_name,
    timeZone: terminal.timezone,
  };
}

/** The active terminal this browser is registered as, or null. */
export const getCurrentTerminal = cache(async (): Promise<TerminalContext | null> => {
  const key = await readTerminalKey();
  return key ? resolveTerminal(key) : null;
});

/** Terminals for the hospital, or one location, newest first. Readable by administrators only (RLS). */
export async function listTerminals(hospitalId: string, locationId?: string): Promise<TerminalSummary[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("attendance_terminals_overview")
    .select("id, location_id, location_name, name, created_at, created_by_name, revoked_at, last_used_at")
    .eq("hospital_id", hospitalId);
  if (locationId) query = query.eq("location_id", locationId);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw dataError("list terminals", error);

  return data.map((row) => ({
    id: required(row.id, "id"),
    locationId: required(row.location_id, "location_id"),
    locationName: required(row.location_name, "location_name"),
    name: required(row.name, "name"),
    createdAt: required(row.created_at, "created_at"),
    createdByName: row.created_by_name,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  }));
}
