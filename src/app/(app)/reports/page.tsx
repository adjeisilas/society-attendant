import { ChartColumn, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { buttonClassName } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Panel } from "@/components/ui/panel";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { formatMinutes } from "@/features/attendance/labels";
import { listDepartmentOptions } from "@/features/departments/queries";
import { AttendanceChart } from "@/features/reports/components/attendance-chart";
import { getAttendanceByDay, getAttendanceSummary } from "@/features/reports/queries";
import { addDaysToIsoDate, daysInRange, formatIsoDate, isIsoDate, todayInTimeZone } from "@/lib/dates";
import { requireHospitalScope } from "@/lib/hospital-context";
import { firstSearchParam, toQueryString, type SearchParams } from "@/lib/search-params";
import { MAX_REPORT_DAYS } from "@/features/reports/schemas";
import styles from "./reports.module.css";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, hospital } = await requireHospitalScope("reports.view");
  if (!hospital) return <NoHospitalState />;

  const params = await searchParams;
  const today = todayInTimeZone(hospital.timezone);
  const requestedFrom = firstSearchParam(params.from);
  const requestedTo = firstSearchParam(params.to);
  const to = isIsoDate(requestedTo) ? requestedTo : today;
  const fromCandidate = isIsoDate(requestedFrom) ? requestedFrom : addDaysToIsoDate(to, -29);
  // Keep the range sane: never reversed, never longer than a year.
  const from =
    daysInRange(fromCandidate, to) < 1 || daysInRange(fromCandidate, to) > MAX_REPORT_DAYS
      ? addDaysToIsoDate(to, -29)
      : fromCandidate;

  const canViewHospital = user.capabilities.has("attendance.viewHospital");
  const departments = (await listDepartmentOptions(hospital.id)).filter(
    (department) => canViewHospital || user.headedDepartments.some((headed) => headed.id === department.id),
  );
  const requestedDepartment = firstSearchParam(params.department);
  const departmentId = departments.some((department) => department.id === requestedDepartment)
    ? requestedDepartment
    : canViewHospital
      ? undefined
      : departments[0]?.id;

  const range = { from, to, departmentId };
  const [summary, daily] = await Promise.all([
    getAttendanceSummary(hospital.id, range),
    getAttendanceByDay(hospital.id, range),
  ]);

  const totals = summary.reduce(
    (accumulator, row) => ({
      present: accumulator.present + row.presentCount,
      late: accumulator.late + row.lateCount,
      absent: accumulator.absent + row.absentCount,
      worked: accumulator.worked + row.workedMinutes,
      overtime: accumulator.overtime + row.overtimeMinutes,
    }),
    { present: 0, late: 0, absent: 0, worked: 0, overtime: 0 },
  );

  const exportHref = `/reports/export${toQueryString({ from, to, department: departmentId })}`;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Attendance from ${formatIsoDate(from)} to ${formatIsoDate(to)} · ${hospital.name}`}
        actions={
          summary.length > 0 && (
            <Link href={exportHref} className={buttonClassName({ variant: "secondary" })} prefetch={false}>
              <Download size={16} aria-hidden="true" />
              Export CSV
            </Link>
          )
        }
      />

      <Panel flush>
        <FilterBar submitLabel="Show" resetHref="/reports">
          <TextField name="from" type="date" label="From" defaultValue={from} />
          <TextField name="to" type="date" label="To" defaultValue={to} />
          <SelectField
            name="department"
            label="Department"
            placeholder={canViewHospital ? "All departments" : undefined}
            options={departments.map((department) => ({ value: department.id, label: department.name }))}
            defaultValue={departmentId ?? ""}
          />
        </FilterBar>

        {summary.length === 0 ? (
          <EmptyState
            icon={<ChartColumn size={20} />}
            title="No attendance in this period"
            description="Choose a different date range, or check that shifts were rostered."
          />
        ) : (
          <>
            <dl className={styles.totals}>
              <div>
                <dt>Present</dt>
                <dd>{totals.present}</dd>
              </div>
              <div>
                <dt>Late</dt>
                <dd>{totals.late}</dd>
              </div>
              <div>
                <dt>Absent</dt>
                <dd>{totals.absent}</dd>
              </div>
              <div>
                <dt>Time worked</dt>
                <dd>{formatMinutes(totals.worked)}</dd>
              </div>
              <div>
                <dt>Overtime</dt>
                <dd>{formatMinutes(totals.overtime)}</dd>
              </div>
            </dl>

            {daily.length > 1 && <AttendanceChart data={daily} />}

            <DataTable caption={`Attendance by staff member from ${from} to ${to}`}>
              <thead>
                <tr>
                  <th scope="col">Staff</th>
                  <th scope="col">Department</th>
                  <th scope="col" data-align="end">
                    Present
                  </th>
                  <th scope="col" data-align="end">
                    Late
                  </th>
                  <th scope="col" data-align="end">
                    Absent
                  </th>
                  <th scope="col" data-align="end">
                    Worked
                  </th>
                  <th scope="col" data-align="end">
                    Overtime
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.staffId}>
                    <td>
                      {row.staffName}
                      <div className="text-muted text-sm">{row.employeeNumber}</div>
                    </td>
                    <td>{row.departmentName}</td>
                    <td data-align="end">{row.presentCount}</td>
                    <td data-align="end">{row.lateCount}</td>
                    <td data-align="end">{row.absentCount}</td>
                    <td data-align="end">{formatMinutes(row.workedMinutes)}</td>
                    <td data-align="end">{formatMinutes(row.overtimeMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
      </Panel>
    </>
  );
}
