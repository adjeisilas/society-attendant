import { z } from "zod";
// Relative import with extension: pure modules must also load in Node's test runner.
import { emailAddress } from "../../lib/validation.ts";

export const PASSWORD_MIN_LENGTH = 12;
/** Supabase Auth (bcrypt) ignores characters beyond 72 bytes. */
export const PASSWORD_MAX_LENGTH = 72;

export const signInSchema = z.object({
  email: emailAddress,
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX_LENGTH, "The email or password is incorrect."),
});

export const forgotPasswordSchema = z.object({
  email: emailAddress,
});

export const setPasswordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
      .max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`),
    confirmPassword: z.string().min(1, "Re-enter your new password."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords do not match.",
  });

export const emailLinkSchema = z.object({
  tokenHash: z.string().min(1).max(256),
  type: z.enum(["invite", "recovery"]),
});

export type EmailLinkType = z.infer<typeof emailLinkSchema>["type"];
