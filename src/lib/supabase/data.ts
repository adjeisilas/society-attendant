import type { PostgrestError } from "@supabase/supabase-js";

/** An unexpected database failure; it surfaces through the nearest error boundary. */
export function dataError(operation: string, error: PostgrestError): Error {
  return new Error(`Could not ${operation}: ${error.message}`, { cause: error });
}

/** The code raised by one of our database functions (for example STAFF_NOT_FOUND), if any. */
export function raisedErrorCode(error: PostgrestError): string | null {
  return /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : null;
}

export function isUniqueViolation(error: PostgrestError, constraint: string): boolean {
  return error.code === "23505" && error.message.includes(constraint);
}

export function isForeignKeyViolation(error: PostgrestError): boolean {
  return error.code === "23503";
}

/** PostgREST reports a page beyond the last row as an error rather than an empty result. */
export function isRangeNotSatisfiable(error: PostgrestError): boolean {
  return error.code === "PGRST103";
}

/** Views expose every column as nullable; asserts a column the schema guarantees. */
export function required<T>(value: T | null, column: string): T {
  if (value === null) {
    throw new Error(`Expected ${column} to be present.`);
  }
  return value;
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
