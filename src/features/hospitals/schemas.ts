import { z } from "zod";
import { optionalEmailAddress, optionalText } from "../../lib/validation.ts";

export const hospitalSchema = z.object({
  name: z.string().trim().min(2, "Enter a name of at least 2 characters.").max(200, "Use 200 characters or fewer."),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "Use 2–20 letters, numbers or hyphens."),
  // The database checks the zone against its own list; this only catches an empty choice.
  timezone: z.string().trim().min(1, "Choose the hospital's time zone."),
  address: optionalText(500),
  phone: optionalText(30),
  email: optionalEmailAddress.refine((value) => value === null || value.length <= 320, "Use 320 characters or fewer."),
});

export type HospitalFormInput = z.input<typeof hospitalSchema>;
