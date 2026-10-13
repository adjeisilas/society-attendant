import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * A Supabase client that never reads or writes the browser's cookies. Its session, if
 * it signs someone in, lives only in memory for the current request.
 *
 * Attendance terminals use it so a staff member's sign-in is used for one clock-in and
 * then discarded, and never replaces whatever session the terminal's browser holds.
 */
export function createIsolatedSupabaseClient() {
  const env = getPublicEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
