import { z } from "zod";
import { optionalRecordId } from "../../lib/validation.ts";
import { durationBetween } from "./time.ts";

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MIN_SHIFT_MINUTES = 30;

function timeOfDay(label: string) {
  return z.string().regex(TIME_OF_DAY, `Enter the ${label} as HH:MM.`);
}

function wholeMinutes(max: number) {
  return z.coerce
    .number("Enter a number of minutes.")
    .int("Use whole minutes.")
    .min(0, "Use 0 or more minutes.")
    .max(max, `Use ${max} minutes or fewer.`);
}

export const shiftSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a name of at least 2 characters.").max(80, "Use 80 characters or fewer."),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{1,20}$/, "Use up to 20 letters, numbers or hyphens."),
    departmentId: optionalRecordId,
    startTime: timeOfDay("start time"),
    endTime: timeOfDay("end time"),
    breakMinutes: wholeMinutes(240),
    lateGraceMinutes: wholeMinutes(120),
    earlyLeaveGraceMinutes: wholeMinutes(120),
    overtimeThresholdMinutes: wholeMinutes(240),
    checkInOpensMinutes: wholeMinutes(240),
    isActive: z.boolean(),
  })
  .superRefine((values, context) => {
    if (!TIME_OF_DAY.test(values.startTime) || !TIME_OF_DAY.test(values.endTime)) return;
    const duration = durationBetween(values.startTime, values.endTime);
    if (duration < MIN_SHIFT_MINUTES) {
      context.addIssue({ code: "custom", path: ["endTime"], message: "A shift must last at least 30 minutes." });
    } else if (values.breakMinutes >= duration) {
      context.addIssue({ code: "custom", path: ["breakMinutes"], message: "The break must be shorter than the shift." });
    }
  })
  .transform((values) => ({ ...values, durationMinutes: durationBetween(values.startTime, values.endTime) }));

export type ShiftFormInput = z.input<typeof shiftSchema>;
