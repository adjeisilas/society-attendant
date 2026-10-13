import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import type { ActionFailure } from "./action-result";

/** Shows a server action failure in a React Hook Form: field messages plus a form-level message. */
export function applyActionFailure<T extends FieldValues>(setError: UseFormSetError<T>, failure: ActionFailure): void {
  for (const [field, messages] of Object.entries(failure.fieldErrors ?? {})) {
    const message = messages?.[0];
    if (message) setError(field as Path<T>, { type: "server", message });
  }
  setError("root.server", { type: "server", message: failure.message });
}
