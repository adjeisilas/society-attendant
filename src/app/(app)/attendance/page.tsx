import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Panel } from "@/components/ui/panel";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { listDepartmentOptions } from "@/features/departments/queries";
import { ATTENDANCE_FLAG_LABELS, ATTENDANCE_STATUS, formatMinutes, NOT_CHECKED_IN } from "@/features/attendance/labels";
import { listAttendanceForDay } from "@/features/attendance/queries";
import { formatIsoDate, formatTimestamp, isIsoDate, todayInTimeZone } from "@/lib/dates";
import { requireHospitalScope } from "@/lib/hospital-context";
import { firstSearchParam, type SearchParams } from "@/lib/search-params";
import styles from "./attendance.module.css";

export const metadata: Metadata = { title: "Attendance records" };

export default async function AttendancePage({ searchParams }: { searchParams: SearchParams }) {
  const { user, hospital } = await requireHospitalScope(["attendance.viewHospital", "attendance.viewDepartment"]);
  if (!hospital) return <NoHospitalState />;

  const params = await searchParams;
  const timeZone = hospital.timezone;
  const requestedDate = firstSearchParam(params.date);
  const workDate = isIsoDate(requestedDate) ? requestedDate : todayInTimeZone(timeZone);
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

  const rows = await listAttendanceForDay(hospital.id, { workDate, departmentId });
  const counts = {
    present: rows.filter((row) => row.record?.status === "present").length,
    late: rows.filter((row) => row.record?.status === "late").length,
    absent: rows.filter((row) => row.record?.status === "absent").length,
    open: rows.filter((row) => row.record?.isOpen).length,
    pending: rows.filter((row) => row.record === null).length,
  };

  const time = (value: string | null) => (value ? formatTimestamp(value, timeZone).split(", ")[1] : "—");

  return (
    <>
      <PageHeader
        title="Attendance records"
        description={`${formatIsoDate(workDate, "EEEE d MMMM yyyy")} · ${hospital.name}`}
      />

      <Panel flush>
        <FilterBar submitLabel="Show" resetHref="/attendance">
          <TextField name="date" type="date" label="Date" defaultValue={workDate} />
          <SelectField
            name="department"
            label="Department"
            placeholder={canViewHospital ? "All departments" : undefined}
            options={departments.map((department) => ({ value: department.id, label: department.name }))}
            defaultValue={departmentId ?? ""}
          />
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck size={20} />}
            title="Nothing rostered or recorded"
            description="No shifts were rostered and no attendance was recorded for this day."
          />
        ) : (
          <>
            <dl className={styles.summary}>
              <div>
                <dt>Present</dt>
                <dd>{counts.present}</dd>
              </div>
              <div>
                <dt>Late</dt>
                <dd>{counts.late}</dd>
              </div>
              <div>
                <dt>Absent</dt>
                <dd>{counts.absent}</dd>
              </div>
              <div>
                <dt>On duty now</dt>
                <dd>{counts.open}</dd>
              </div>
              <div>
                <dt>Not checked in</dt>
                <dd>{counts.pending}</dd>
              </div>
            </dl>

            <DataTable caption={`Attendance on ${workDate}`}>
              <thead>
                <tr>
                  <th scope="col">Staff</th>
                  <th scope="col">Department</th>
                  <th scope="col">Shift</th>
                  <th scope="col">In</th>
                  <th scope="col">Out</th>
                  <th scope="col" data-align="end">
                    Worked
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const status = row.record ? ATTENDANCE_STATUS[row.record.status] : NOT_CHECKED_IN;
                  return (
                    <tr key={row.key}>
                      <td>
                        {row.staffName}
                        <div className="text-muted text-sm">{row.employeeNumber}</div>
                      </td>
                      <td>{row.departmentName}</td>
                      <td>
                        {row.shiftLabel ?? "Unscheduled"}
                        {row.scheduledStart && row.scheduledEnd && (
                          <div className="text-muted text-sm tabular-nums">
                            {time(row.scheduledStart)}–{time(row.scheduledEnd)}
                          </div>
                        )}
                      </td>
                      <td className="tabular-nums">
                        {time(row.record?.checkInAt ?? null)}
                        {row.record?.isLate && (
                          <div className="text-sm">{formatMinutes(row.record.lateMinutes)} late</div>
                        )}
                      </td>
                      <td className="tabular-nums">
                        {row.record?.isOpen ? <Badge tone="info">On duty</Badge> : time(row.record?.checkOutAt ?? null)}
                      </td>
                      <td data-align="end">{formatMinutes(row.record?.workedMinutes)}</td>
                      <td>
                        <div className={styles.badges}>
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {(row.record?.flags ?? []).map((flag) => (
                            <Badge key={flag} tone="warning">
                              {ATTENDANCE_FLAG_LABELS[flag]}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </>
        )}
      </Panel>
    </>
  );
}
