import type { NextRequest } from "next/server";
import { getAttendanceSummary } from "@/features/reports/queries";
import { MAX_REPORT_DAYS } from "@/features/reports/schemas";
import { requireCapability } from "@/lib/auth/session";
import { addDaysToIsoDate, daysInRange, isIsoDate, todayInTimeZone } from "@/lib/dates";
import { getWorkingHospital } from "@/lib/hospital-context";
import { isRecordId } from "@/lib/validation";

const COLUMNS = [
  "Staff",
  "Employee number",
  "Department",
  "Recorded days",
  "Present",
  "Late",
  "Absent",
  "Half day",
  "Worked minutes",
  "Overtime minutes",
  "Late minutes",
  "Missing check-outs",
];

/** CSV of the same report shown on the page. Access is checked here, not assumed. */
export async function GET(request: NextRequest) {
  const user = await requireCapability("reports.view");
  const hospital = await getWorkingHospital(user);
  if (!hospital) {
    return new Response("No hospital available.", { status: 404 });
  }

  const params = request.nextUrl.searchParams;
  const today = todayInTimeZone(hospital.timezone);
  const requestedTo = params.get("to");
  const requestedFrom = params.get("from");
  const to = isIsoDate(requestedTo) ? requestedTo : today;
  const candidate = isIsoDate(requestedFrom) ? requestedFrom : addDaysToIsoDate(to, -29);
  const from =
    daysInRange(candidate, to) < 1 || daysInRange(candidate, to) > MAX_REPORT_DAYS
      ? addDaysToIsoDate(to, -29)
      : candidate;
  const department = params.get("department");

  const summary = await getAttendanceSummary(hospital.id, {
    from,
    to,
    departmentId: isRecordId(department) ? department : undefined,
  });

  const rows = summary.map((row) => [
    row.staffName,
    row.employeeNumber,
    row.departmentName,
    row.recordedDays,
    row.presentCount,
    row.lateCount,
    row.absentCount,
    row.halfDayCount,
    row.workedMinutes,
    row.overtimeMinutes,
    row.lateMinutes,
    row.missedCheckOutCount,
  ]);

  const csv = [COLUMNS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const fileName = `attendance-${hospital.code.toLowerCase()}-${from}-to-${to}.csv`;

  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

function csvCell(value: string | number): string {
  const text = String(value);
  // Quote anything a spreadsheet could misread, and neutralise formula injection.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
