import { z } from "zod";

export const hospitalSettingsSchema = z.object({
  allowUnscheduledCheckIn: z.boolean(),
  minSessionMinutes: z.coerce
    .number("Enter a number of minutes.")
    .int("Use whole minutes.")
    .min(0, "Use 0 or more minutes.")
    .max(120, "Use 120 minutes or fewer."),
  checkOutWindowMinutes: z.coerce
    .number("Enter a number of minutes.")
    .int("Use whole minutes.")
    .min(60, "Allow at least 60 minutes.")
    .max(1440, "Use 1,440 minutes (24 hours) or fewer."),
  halfDayThresholdPercent: z.coerce
    .number("Enter a percentage.")
    .int("Use a whole percentage.")
    .min(1, "Use 1% or more.")
    .max(99, "Use 99% or less."),
});

export type HospitalSettingsFormInput = z.input<typeof hospitalSettingsSchema>;
