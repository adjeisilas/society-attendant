export const MINUTES_PER_DAY = 1440;

const TIME_OF_DAY = /^(\d{2}):(\d{2})(?::\d{2})?$/;

/** "07:00" or "07:00:00" → minutes after midnight. */
export function timeToMinutes(time: string): number {
  const match = TIME_OF_DAY.exec(time);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 23 || minutes > 59) {
    throw new Error(`Invalid time of day: ${time}`);
  }
  return hours * 60 + minutes;
}

/** Minutes after midnight (wrapping past 24 hours) → "HH:MM". */
export function minutesToTime(totalMinutes: number): string {
  const minutes = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Length of a shift from its start and end times. An end at or before the start is on
 * the following day, so 23:00 → 07:00 is 8 hours and 08:00 → 08:00 is 24 hours.
 */
export function durationBetween(startTime: string, endTime: string): number {
  const difference = timeToMinutes(endTime) - timeToMinutes(startTime);
  return difference > 0 ? difference : difference + MINUTES_PER_DAY;
}

export interface ShiftTiming {
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
}

export function shiftTiming(startTime: string, durationMinutes: number): ShiftTiming {
  const start = timeToMinutes(startTime);
  return {
    startTime: minutesToTime(start),
    endTime: minutesToTime(start + durationMinutes),
    endsNextDay: start + durationMinutes > MINUTES_PER_DAY,
  };
}

/** "23:00–07:00 (next day)" */
export function formatShiftTimes(startTime: string, durationMinutes: number): string {
  const timing = shiftTiming(startTime, durationMinutes);
  return `${timing.startTime}–${timing.endTime}${timing.endsNextDay ? " (next day)" : ""}`;
}

/** 510 → "8 h 30 min" */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} min`;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}
