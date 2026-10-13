import { z } from "zod";
import { attachmentPath } from "../../lib/validation.ts";

/**
 * Corrections propose times, never a status: the engine recomputes the outcome.
 * Times arrive as absolute instants; the form converts the local time the user typed
 * using the device's own time zone, which is the hospital's in normal use.
 */
export const correctionRequestSchema = z
  .object({
    checkInAt: z.union([z.literal(""), z.iso.datetime({ offset: true })]).transform((value) => value || null),
    checkOutAt: z.union([z.literal(""), z.iso.datetime({ offset: true })]).transform((value) => value || null),
    reason: z
      .string()
      .trim()
      .min(10, "Explain what happened, in at least 10 characters.")
      .max(1000, "Use 1,000 characters or fewer."),
    evidencePath: attachmentPath,
  })
  .superRefine((values, context) => {
    if (!values.checkInAt && !values.checkOutAt) {
      context.addIssue({
        code: "custom",
        path: ["checkInAt"],
        message: "Give the corrected check-in time, check-out time, or both.",
      });
      return;
    }
    if (values.checkInAt && values.checkOutAt && values.checkOutAt <= values.checkInAt) {
      context.addIssue({
        code: "custom",
        path: ["checkOutAt"],
        message: "The check-out time must be after the check-in time.",
      });
    }
  });

export type CorrectionRequestInput = z.input<typeof correctionRequestSchema>;

export const correctionFiltersSchema = z.object({
  status: z.enum(["all", "pending", "approved", "rejected", "cancelled"]).catch("pending"),
  department: z.union([z.uuid(), z.literal("")]).catch(""),
});

export type CorrectionFilters = z.output<typeof correctionFiltersSchema>;

/** Approve or refuse a correction. Refusing needs a note, which the database also enforces. */
export const reviewSchema = z
  .object({
    approve: z.boolean(),
    note: z.string().trim().max(1000, "Use 1,000 characters or fewer."),
  })
  .superRefine((values, context) => {
    if (!values.approve && values.note.length < 5) {
      context.addIssue({ code: "custom", path: ["note"], message: "Explain why the request is refused." });
    }
  });

export type ReviewFormInput = z.input<typeof reviewSchema>;
