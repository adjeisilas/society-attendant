import { z } from "zod";
import { daysInRange, isIsoDate } from "../../lib/dates.ts";
import { recordId } from "../../lib/validation.ts";

export const MAX_ROSTER_DAYS = 62;
export const MAX_ROSTER_STAFF = 200;

export const assignShiftsSchema = z
  .object({
    shiftId: recordId("Select a shift."),
    staffIds: z
      .array(z.uuid())
      .min(1, "Select at least one staff member.")
      .max(MAX_ROSTER_STAFF, `Select at most ${MAX_ROSTER_STAFF} staff members.`),
    startDate: z.iso.date("Enter a start date."),
    endDate: z.iso.date("Enter an end date."),
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Select at least one day of the week."),
  })
  .superRefine((values, context) => {
    if (!isIsoDate(values.startDate) || !isIsoDate(values.endDate)) return;
    const days = daysInRange(values.startDate, values.endDate);
    if (days < 1) {
      context.addIssue({ code: "custom", path: ["endDate"], message: "The end date must be on or after the start date." });
    } else if (days > MAX_ROSTER_DAYS) {
      context.addIssue({ code: "custom", path: ["endDate"], message: `Roster at most ${MAX_ROSTER_DAYS} days at a time.` });
    }
  });

export type AssignShiftsInput = z.input<typeof assignShiftsSchema>;

/** Result returned by public.create_shift_assignments. */
export const assignmentOutcomeSchema = z.object({
  created: z.number().int(),
  skipped: z.array(
    z.object({
      staff_id: z.uuid(),
      work_date: z.iso.date(),
      reason: z.enum(["overlap", "staff_not_active"]),
    }),
  ),
});

export type SkipReason = "overlap" | "staff_not_active";

export interface SkippedAssignment {
  staffId: string;
  workDate: string;
  reason: SkipReason;
}

export interface AssignShiftsOutcome {
  created: number;
  skipped: SkippedAssignment[];
}
