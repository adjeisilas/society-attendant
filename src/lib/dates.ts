import { addDays, differenceInCalendarDays, format, getDay, isValid, parse, startOfWeek } from "date-fns";

// Calendar dates are passed around as ISO strings (YYYY-MM-DD), never as Date objects,
// so a server or browser time zone can never shift a work date.

const ISO_DATE_FORMAT = "yyyy-MM-dd";
const REFERENCE_DATE = new Date(2000, 0, 1);

function toLocalDate(isoDate: string): Date {
  return parse(isoDate, ISO_DATE_FORMAT, REFERENCE_DATE);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = toLocalDate(value);
  return isValid(date) && format(date, ISO_DATE_FORMAT) === value;
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  return format(addDays(toLocalDate(isoDate), days), ISO_DATE_FORMAT);
}

/** The Monday of the week containing the date. */
export function startOfIsoWeek(isoDate: string): string {
  return format(startOfWeek(toLocalDate(isoDate), { weekStartsOn: 1 }), ISO_DATE_FORMAT);
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysToIsoDate(weekStart, index));
}

/** Number of calendar days from `from` to `to`, inclusive (0 or less when reversed). */
export function daysInRange(from: string, to: string): number {
  return differenceInCalendarDays(toLocalDate(to), toLocalDate(from)) + 1;
}

/** Day of the week for an ISO date: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(isoDate: string): number {
  return getDay(toLocalDate(isoDate));
}

/** Dates from `from` to `to` inclusive that fall on one of the weekdays (0 = Sunday). */
export function datesOnWeekdays(from: string, to: string, weekdays: readonly number[]): string[] {
  const selected = new Set(weekdays);
  const count = Math.max(daysInRange(from, to), 0);
  return Array.from({ length: count }, (_, index) => addDaysToIsoDate(from, index)).filter((date) =>
    selected.has(weekdayOf(date)),
  );
}

export function formatIsoDate(isoDate: string, pattern = "d MMM yyyy"): string {
  return format(toLocalDate(isoDate), pattern);
}

/** Today's calendar date in an IANA time zone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** A timestamp in the hospital's time zone, for example "15 Sept 2026, 14:05". */
export function formatTimestamp(timestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestamp));
}

/** Weekdays in hospital rota order (Monday first). `value` matches `weekdayOf`. */
export const WEEKDAYS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
] as const;

/** The time of day in the hospital's time zone, for example "14:05". */
export function formatTimeOfDay(timestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestamp));
}
