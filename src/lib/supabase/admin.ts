import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";

/**
 * Supabase Auth admin API, authenticated with the secret key.
 *
 * Only the Auth admin API is exposed: database access with the secret key would
 * bypass Row Level Security. Call it only after the database has authorized the
 * action for the signed-in user (for example through prepare_account_invitation).
 */
export function supabaseAuthAdmin() {
  const client = createClient(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, getServerEnv().SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client.auth.admin;
}
