/**
 * Sets the password of an existing account with the Auth admin API. Run it yourself
 * in a terminal, for example after forgetting the super admin password:
 *
 *   npm run admin:password -- admin@example.org
 *
 * The password is prompted for and never echoed. Needs NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SECRET_KEY in .env.local.
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { promptNewPassword } from "./prompt-password.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env")) process.loadEnvFile(".env");

// Exiting while the Supabase client holds open handles trips a libuv assertion on
// Windows, so the script reports a failure by returning instead of calling exit.
async function main(): Promise<number> {
  const [email] = process.argv.slice(2);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Usage: npm run admin:password -- <email>");
    return 1;
  }
  if (!url || !secretKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");
    return 1;
  }

  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // listUsers is the only lookup the admin API offers for an email address.
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    console.error(`Could not look up the account: ${listError.message}`);
    return 1;
  }

  const account = list.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (!account) {
    console.error(`No account found for ${email}.`);
    return 1;
  }

  const password = await promptNewPassword();
  const { error } = await supabase.auth.admin.updateUserById(account.id, { password });
  if (error) {
    console.error(`Could not set the password: ${error.message}`);
    return 1;
  }

  console.log(`Password updated for ${account.email}. Sign in at /login.`);
  return 0;
}

process.exitCode = await main();
