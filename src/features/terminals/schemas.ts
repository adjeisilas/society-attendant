import { z } from "zod";
import { clockActionSchema } from "../attendance/schemas.ts";

export const terminalNameSchema = z.object({
  name: z.string().trim().min(2, "Enter a name of at least 2 characters.").max(80, "Use 80 characters or fewer."),
});

export type TerminalNameInput = z.input<typeof terminalNameSchema>;

/** What a staff member enters at a terminal: their staff ID or email, and their password. */
export const terminalCredentialsSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your staff ID or email.").max(320, "That is too long."),
  password: z.string().min(1, "Enter your password.").max(200, "That is too long."),
});

export type TerminalCredentialsInput = z.input<typeof terminalCredentialsSchema>;

export const terminalClockSchema = terminalCredentialsSchema.extend({ action: clockActionSchema });

/** An identifier with an @ is a sign-in email; anything else is a staff ID. */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

export const terminalContextSchema = z.object({
  terminal_id: z.uuid(),
  terminal_name: z.string(),
  location_name: z.string(),
  hospital_name: z.string(),
  timezone: z.string(),
});

export const registeredTerminalSchema = z.object({
  terminal_id: z.uuid(),
  key: z.string().regex(/^t1\.[A-Za-z0-9_-]{43}$/),
});
