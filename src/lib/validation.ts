import { z } from "zod";

// Shared form fields. Server actions parse the raw form input with the same schemas
// the forms use, so validation rules live in one place.

export const emailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter an email address.")
  .pipe(z.email("Enter a valid email address."));

/** An optional email address; an empty input becomes null. */
export const optionalEmailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.union([z.literal(""), z.email("Enter a valid email address.")]))
  .transform((value) => value || null);

/** Optional free text; an empty input becomes null. */
export function optionalText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength, `Use ${maxLength.toLocaleString("en")} characters or fewer.`)
    .transform((value) => value || null);
}

export function recordId(message: string) {
  return z.uuid(message);
}

/** Validates an id taken from a URL before it reaches a query. */
export function isRecordId(value: unknown): value is string {
  return z.uuid().safeParse(value).success;
}

/** An optional reference chosen in a select; the empty choice becomes null. */
export const optionalRecordId = z
  .union([z.literal(""), z.uuid("Select a valid option.")])
  .transform((value) => value || null);

export function isoDate(message: string) {
  return z.iso.date(message);
}

/**
 * A stored attachment path: {hospital_id}/{staff_id}/{file}.
 * Omitted, or empty, means no attachment.
 */
export const attachmentPath = z
  .union([z.literal(""), z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/, "That attachment is not valid.")])
  .optional()
  .transform((value) => value || null);
