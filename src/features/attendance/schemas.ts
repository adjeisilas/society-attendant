import { z } from "zod";
import { Constants } from "../../types/database.ts";

/** Which way a staff member is clocking; the names match the database functions. */
export const clockActionSchema = z.enum(["check_in", "check_out"]);

export type ClockAction = z.infer<typeof clockActionSchema>;

/** What check_in and check_out return. Checked here before the app relies on it. */
const clockSuccessSchema = z.object({
  ok: z.literal(true),
  record_id: z.uuid(),
  staff_name: z.string(),
  status: z.enum(Constants.public.Enums.attendance_status),
  late_minutes: z.number().int().optional(),
  worked_minutes: z.number().int().nullable().optional(),
  overtime_minutes: z.number().int().optional(),
  early_leave_minutes: z.number().int().optional(),
  is_overtime: z.boolean().optional(),
  is_early_leave: z.boolean().optional(),
  checked_in_at: z.string().optional(),
  checked_out_at: z.string().optional(),
  scheduled_start: z.string().nullable().optional(),
  scheduled_end: z.string().nullable().optional(),
  shift_name: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  flags: z.array(z.enum(Constants.public.Enums.attendance_flag)).optional(),
});

const clockFailureSchema = z.object({ ok: z.literal(false), code: z.string() });

export const clockResponseSchema = z.union([clockSuccessSchema, clockFailureSchema]);

export type ClockSuccess = z.infer<typeof clockSuccessSchema>;

export const MY_ATTENDANCE_PAGE_SIZE = 20;
