import { z } from "zod";
import { optionalText } from "../../lib/validation.ts";

export const attendanceLocationSchema = z.object({
  name: z.string().trim().min(2, "Enter a name of at least 2 characters.").max(120, "Use 120 characters or fewer."),
  description: optionalText(500),
  isActive: z.boolean(),
});

export type AttendanceLocationFormInput = z.input<typeof attendanceLocationSchema>;
