"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clockErrorMessage, type AttendanceFlag, type AttendanceStatus } from "@/features/attendance/labels";
import { clockResponseSchema, type ClockAction } from "@/features/attendance/schemas";
import { routes } from "@/lib/auth/routes";
import {
  actionFailure,
  actionSuccess,
  NO_HOSPITAL_MESSAGE,
  validationFailure,
  type ActionFailure,
  type ActionResult,
} from "@/lib/forms/action-result";
import { requireHospitalScope } from "@/lib/hospital-context";
import { dataError, raisedErrorCode } from "@/lib/supabase/data";
import { createIsolatedSupabaseClient } from "@/lib/supabase/isolated";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRecordId } from "@/lib/validation";
import { TERMINAL_COOKIE, TERMINAL_COOKIE_MAX_AGE_SECONDS } from "./constants";
import { getCurrentTerminal, readTerminalKey } from "./queries";
import { isEmailIdentifier, registeredTerminalSchema, terminalClockSchema, terminalNameSchema } from "./schemas";

const LOCATION_NOT_FOUND_MESSAGE = "This location no longer exists or you cannot change it.";
const TERMINAL_NOT_FOUND_MESSAGE = "This terminal no longer exists or you cannot change it.";
// The same message for unknown staff IDs and wrong passwords, so accounts cannot be discovered.
const INVALID_CREDENTIALS_MESSAGE = "The staff ID, email or password is incorrect.";

/**
 * Registers the computer this browser runs on as a terminal at the location. The key is
 * stored only in an HTTP-only cookie here. A browser holds one key, so any terminal it
 * was registered as before is switched off rather than left with a working key.
 */
export async function registerTerminal(locationId: unknown, input: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("locations.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(locationId)) return actionFailure(LOCATION_NOT_FOUND_MESSAGE);

  const parsed = terminalNameSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const previous = await getCurrentTerminal();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_attendance_terminal", {
    p_location_id: locationId,
    p_name: parsed.data.name,
  });
  if (error) return terminalFailure(error);
  const registered = registeredTerminalSchema.parse(data);

  if (previous) {
    const { error: revokeError } = await supabase.rpc("revoke_attendance_terminal", { p_terminal_id: previous.id });
    if (revokeError && raisedErrorCode(revokeError) !== "TERMINAL_NOT_FOUND") {
      throw dataError("switch off the terminal this computer replaced", revokeError);
    }
  }

  (await cookies()).set(TERMINAL_COOKIE, registered.key, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: TERMINAL_COOKIE_MAX_AGE_SECONDS,
  });

  refresh();
  return actionSuccess(null);
}

export async function revokeTerminal(terminalId: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("locations.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(terminalId)) return actionFailure(TERMINAL_NOT_FOUND_MESSAGE);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_attendance_terminal", { p_terminal_id: terminalId });
  if (error) return terminalFailure(error);

  refresh();
  return actionSuccess(null);
}

/**
 * Signs the administrator out of this browser only, so the computer can be left
 * unattended as a terminal, and opens the clock-in screen.
 */
export async function startTerminalMode(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(routes.terminal);
}

export interface ClockOutcome {
  action: ClockAction;
  staffName: string;
  status: AttendanceStatus;
  /** When the clock-in or clock-out was recorded (ISO timestamp, server clock). */
  recordedAt: string;
  lateMinutes: number;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  earlyLeaveMinutes: number | null;
  shiftName: string | null;
  flags: AttendanceFlag[];
  /** The account still uses a password an administrator set. */
  mustChangePassword: boolean;
}

/**
 * Clocks a staff member in or out at this terminal.
 *
 * Their credentials sign them in on an isolated client that lives only for this request,
 * so the database identifies them from a real session exactly as it would anywhere else.
 * The terminal key proves where they are. The session is revoked straight afterwards.
 */
export async function clockAtTerminal(input: unknown): Promise<ActionResult<ClockOutcome>> {
  const parsed = terminalClockSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { action, identifier, password } = parsed.data;

  const key = await readTerminalKey();
  if (!key) return actionFailure(clockErrorMessage("TERMINAL_NOT_REGISTERED"));

  const supabase = createIsolatedSupabaseClient();

  let email = identifier;
  if (!isEmailIdentifier(identifier)) {
    const { data, error } = await supabase.rpc("terminal_sign_in_email", {
      p_terminal_key: key,
      p_employee_number: identifier,
    });
    if (error) throw dataError("look up the staff ID", error);
    if (!data) return actionFailure(INVALID_CREDENTIALS_MESSAGE);
    email = data;
  }

  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.user) return signInFailure(signInError?.code);

  try {
    const [clock, profile] = await Promise.all([
      supabase.rpc(action, { p_terminal_key: key }),
      supabase.from("profiles").select("must_change_password").eq("id", signIn.user.id).maybeSingle(),
    ]);
    if (clock.error) throw dataError(action === "check_in" ? "clock in" : "clock out", clock.error);

    const result = clockResponseSchema.parse(clock.data);
    if (!result.ok) return actionFailure(clockErrorMessage(result.code));

    return actionSuccess({
      action,
      staffName: result.staff_name,
      status: result.status,
      recordedAt: (action === "check_in" ? result.checked_in_at : result.checked_out_at) ?? new Date().toISOString(),
      lateMinutes: result.late_minutes ?? 0,
      workedMinutes: result.worked_minutes ?? null,
      overtimeMinutes: result.is_overtime ? (result.overtime_minutes ?? null) : null,
      earlyLeaveMinutes: result.is_early_leave ? (result.early_leave_minutes ?? null) : null,
      shiftName: result.shift_name ?? null,
      flags: result.flags ?? [],
      mustChangePassword: profile.data?.must_change_password ?? false,
    });
  } finally {
    // Revokes this sign-in's refresh token. It was never stored anywhere, so a failure here leaves nothing usable.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

function signInFailure(code: string | undefined): ActionFailure {
  switch (code) {
    case "over_request_rate_limit":
      return actionFailure("Too many sign-ins at this terminal just now. Wait a minute and try again.");
    case "user_banned":
      return actionFailure("This account is not active. Contact your HR office.");
    case "email_not_confirmed":
      return actionFailure("This account has not been activated yet. Accept the invitation email first.");
    default:
      return actionFailure(INVALID_CREDENTIALS_MESSAGE);
  }
}

function terminalFailure(error: PostgrestError): ActionFailure {
  switch (raisedErrorCode(error)) {
    case "LOCATION_NOT_FOUND":
      return actionFailure(LOCATION_NOT_FOUND_MESSAGE);
    case "TERMINAL_NOT_FOUND":
      return actionFailure(TERMINAL_NOT_FOUND_MESSAGE);
    case "LOCATION_NOT_ACTIVE":
      return actionFailure("Reactivate this location before registering a terminal.");
    case "INVALID_TERMINAL_NAME":
      return actionFailure("Use a terminal name of 2 to 80 characters.");
    default:
      throw dataError("manage terminal", error);
  }
}
