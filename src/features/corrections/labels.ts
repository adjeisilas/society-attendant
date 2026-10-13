const CORRECTION_ERRORS: Record<string, string> = {
  RECORD_NOT_FOUND: "That attendance record no longer exists, or you cannot change it.",
  REQUEST_NOT_FOUND: "This correction no longer exists, or you cannot act on it.",
  REQUEST_NOT_PENDING: "This correction has already been decided.",
  TIMES_REQUIRED: "Give the corrected check-in time, check-out time, or both.",
  REASON_REQUIRED: "Explain what happened, in at least 10 characters.",
  TIME_IN_FUTURE: "Attendance times cannot be in the future.",
  TIME_OUT_OF_RANGE: "Corrected times must be close to the shift they belong to.",
  CORRECTION_ALREADY_PENDING: "This record already has a correction awaiting review.",
  CANNOT_REVIEW_OWN_REQUEST: "You cannot review a correction to your own attendance.",
  REVIEW_NOTE_REQUIRED: "Explain why the correction is refused.",
  CHECK_IN_REQUIRED: "A corrected record needs a check-in time.",
};

export function correctionErrorMessage(code: string | null): string {
  return (code && CORRECTION_ERRORS[code]) || "That could not be completed. Try again, or contact your administrator.";
}
