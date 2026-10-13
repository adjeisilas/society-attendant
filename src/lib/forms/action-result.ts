import { z } from "zod";

export interface ActionFailure {
  ok: false;
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export type ActionResult<T = null> = { ok: true; data: T } | ActionFailure;

export const CHECK_FIELDS_MESSAGE = "Check the highlighted fields and try again.";

/** Shown when an action targets a hospital-scoped record but no hospital is available. */
export const NO_HOSPITAL_MESSAGE = "There is no active hospital to work with.";

export function actionSuccess<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function actionFailure(message: string, fieldErrors?: ActionFailure["fieldErrors"]): ActionFailure {
  return { ok: false, message, fieldErrors };
}

export function validationFailure(error: z.ZodError): ActionFailure {
  const { fieldErrors } = z.flattenError(error) as { fieldErrors: Record<string, string[] | undefined> };
  return actionFailure(CHECK_FIELDS_MESSAGE, fieldErrors);
}
