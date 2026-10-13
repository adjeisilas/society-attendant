import type { BadgeTone } from "@/components/ui/badge";
import type { Enums } from "@/types/database";
import { formatDuration } from "../shifts/time.ts";

export type AttendanceStatus = Enums<"attendance_status">;
export type AttendanceFlag = Enums<"attendance_flag">;

export const ATTENDANCE_STATUS: Record<AttendanceStatus, { label: string; tone: BadgeTone }> = {
  present: { label: "Present", tone: "success" },
  late: { label: "Late", tone: "warning" },
  absent: { label: "Absent", tone: "danger" },
  // No longer recorded; kept so older records still display.
  on_leave: { label: "On leave", tone: "info" },
  off_day: { label: "Off day", tone: "neutral" },
  half_day: { label: "Half day", tone: "warning" },
};

/** Rostered, but the shift has not been clocked into yet. */
export const NOT_CHECKED_IN = { label: "Not clocked in", tone: "neutral" } as const;

export const ATTENDANCE_FLAG_LABELS: Record<AttendanceFlag, string> = {
  unscheduled: "Unscheduled",
  missed_check_out: "No clock-out",
  // The two below come from features that were removed; older records may carry them.
  leave_conflict: "On approved leave",
  outside_geofence: "Away from location",
};

const CLOCK_ERRORS: Record<string, string> = {
  NOT_AUTHENTICATED: "You could not be signed in. Try again.",
  STAFF_NOT_ACTIVE: "Your account has no active staff record, so it cannot clock in. Contact your HR office.",
  HOSPITAL_NOT_ACTIVE: "The hospital is not active in the system.",
  TERMINAL_NOT_REGISTERED: "This computer is not registered as a terminal. Ask an administrator to register it.",
  TERMINAL_REVOKED: "This terminal has been switched off by an administrator.",
  WRONG_HOSPITAL: "This terminal belongs to another hospital.",
  LOCATION_NOT_ACTIVE: "This terminal's location is not in use.",
  NO_SHIFT: "You have no shift open for clock-in right now. If you are working, ask your manager to add it to the roster.",
  ALREADY_CHECKED_IN: "You are already clocked in. Choose Clock out when your shift ends.",
  NO_OPEN_SESSION: "You are not clocked in, so there is nothing to clock out of.",
  TOO_SOON: "You have only just clocked in. Try again in a few minutes.",
  CHECK_OUT_WINDOW_CLOSED:
    "The time allowed for clocking out has passed. Ask your manager to correct this attendance record.",
};

export function clockErrorMessage(code: string): string {
  return CLOCK_ERRORS[code] ?? "That could not be recorded. Try again, or contact your manager.";
}

/** "7 h 45 min", or a dash when there is nothing to show. */
export function formatMinutes(minutes: number | null | undefined): string {
  return minutes === null || minutes === undefined ? "—" : formatDuration(minutes);
}
