import { z } from "zod";

/**
 * The reporting functions return JSON, so the shape is checked here before the app
 * relies on it.
 */
export const reportSummaryRowSchema = z.object({
  staff_id: z.uuid(),
  staff_name: z.string(),
  employee_number: z.string(),
  department_id: z.uuid(),
  department_name: z.string(),
  recorded_days: z.number().int(),
  present_count: z.number().int(),
  late_count: z.number().int(),
  absent_count: z.number().int(),
  half_day_count: z.number().int(),
  worked_minutes: z.number().int(),
  overtime_minutes: z.number().int(),
  late_minutes: z.number().int(),
  missed_check_out_count: z.number().int(),
});

export const reportSummarySchema = z.array(reportSummaryRowSchema);

export const reportDailyRowSchema = z.object({
  work_date: z.iso.date(),
  present_count: z.number().int(),
  late_count: z.number().int(),
  absent_count: z.number().int(),
  half_day_count: z.number().int(),
});

export const reportDailySchema = z.array(reportDailyRowSchema);

export const MAX_REPORT_DAYS = 366;
