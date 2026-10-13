"use server";

import { redirect } from "next/navigation";
import { routes, safeRedirectPath } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";
import { actionFailure, actionSuccess, validationFailure, type ActionResult } from "@/lib/forms/action-result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emailLinkSchema, forgotPasswordSchema, setPasswordSchema, signInSchema } from "./schemas";

const RATE_LIMITED = "Too many attempts. Wait a few minutes and try again.";

export async function signIn(input: unknown, next: unknown): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    switch (error.code) {
      case "over_request_rate_limit":
        return actionFailure(RATE_LIMITED);
      case "user_banned":
        return actionFailure("This account is not active. Contact your hospital administrator.");
      default:
        // Same message for unknown emails and wrong passwords, so accounts cannot be discovered.
        return actionFailure("The email or password is incorrect.");
    }
  }

  redirect(safeRedirectPath(next));
}

export async function requestPasswordReset(input: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);

  if (error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") {
    return actionFailure(RATE_LIMITED);
  }
  if (error) {
    return actionFailure("The reset email could not be sent right now. Try again later.");
  }
  // Identical response whether or not the account exists.
  return actionSuccess(null);
}

export async function verifyEmailLink(input: unknown): Promise<ActionResult> {
  const parsed = emailLinkSchema.safeParse(input);
  if (!parsed.success) return actionFailure("This link is not valid.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: parsed.data.tokenHash, type: parsed.data.type });

  if (error) {
    return actionFailure(
      parsed.data.type === "invite"
        ? "This invitation has expired or has already been used. Ask your hospital administrator to send a new one."
        : "This reset link has expired or has already been used. Request a new one.",
    );
  }

  redirect(routes.setPassword);
}

export async function setPassword(input: unknown): Promise<ActionResult> {
  await requireUser();

  const parsed = setPasswordSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    switch (error.code) {
      case "same_password":
        return actionFailure("Choose a password that is different from your current one.");
      case "weak_password":
        return actionFailure("This password is too weak or has appeared in a data breach. Choose a different one.");
      case "reauthentication_needed":
        return actionFailure("For your security, sign in again before changing your password.");
      default:
        return actionFailure("Your password could not be updated. Try again.");
    }
  }

  // Clears the administrator-set password flag; the account chose its own password.
  await supabase.rpc("complete_password_change");

  redirect(routes.home);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect(routes.signIn);
}
