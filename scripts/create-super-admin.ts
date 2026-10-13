/**
 * Creates the first super admin with the Auth admin API. Run it yourself in a terminal:
 *
 *   npm run admin:create -- admin@example.org "Platform Administrator"
 *
 * The password is prompted for and never echoed. Needs NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SECRET_KEY in .env.local.
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { promptNewPassword } from "./prompt-password.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env")) process.loadEnvFile(".env");

const [email, ...nameParts] = process.argv.slice(2);
// Accept the name with or without quotes.
const displayName = nameParts.join(" ").trim() || "Platform Administrator";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run admin:create -- <email> ["Display name"]');
  process.exit(1);
}
if (!url || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");
  process.exit(1);
}
const password = await promptNewPassword();

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Supabase Auth writes app_metadata only after inserting the user, so the database
// cannot use it to provision the account. Authorize the signup first instead.
const { error: grantError } = await supabase.rpc("authorize_super_admin_signup", {
  p_email: email,
  p_display_name: displayName,
});

const { data, error } = grantError
  ? { data: null, error: grantError }
  : await supabase.auth.admin.createUser({ email, password, email_confirm: true });

// Set the exit code instead of calling process.exit(): exiting right after raw-mode
// input trips a libuv assertion on Windows.
if (error) {
  console.error(`Could not create the account: ${error.message}`);
  process.exitCode = 1;
} else {
  console.log(`Super admin created: ${data.user?.email}. Sign in at /login.`);
}
