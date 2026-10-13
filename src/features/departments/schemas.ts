import { z } from "zod";
import { optionalRecordId, optionalText } from "../../lib/validation.ts";

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "Enter a name of at least 2 characters.").max(120, "Use 120 characters or fewer."),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "Use 2–20 letters, numbers or hyphens."),
  description: optionalText(1000),
  headStaffId: optionalRecordId,
  isActive: z.boolean(),
});

export type DepartmentFormInput = z.input<typeof departmentSchema>;
