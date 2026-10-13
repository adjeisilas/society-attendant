import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { StatusPanel } from "@/components/ui/status-panel";
import { ATTENDANCE_FLAG_LABELS, ATTENDANCE_STATUS, formatMinutes } from "@/features/attendance/labels";
import { listMyAttendance } from "@/features/attendance/queries";
import { MY_ATTENDANCE_PAGE_SIZE } from "@/features/attendance/schemas";
import { requireCapability } from "@/lib/auth/session";
import { formatIsoDate, formatTimestamp } from "@/lib/dates";
import { firstSearchParam, toQueryString, type SearchParams } from "@/lib/search-params";
import styles from "./my-attendance.module.css";

export const metadata: Metadata = { title: "My attendance" };

export default async function MyAttendancePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireCapability("attendance.viewOwn");
  if (!user.staff || !user.hospital) {
    return (
      <StatusPanel
        icon={<ClipboardCheck size={22} />}
        title="No staff record"
        description="Attendance is recorded against a staff record. Contact your HR office."
      />
    );
  }

  const timeZone = user.hospital.timezone;
  const page = Math.max(1, Number(firstSearchParam((await searchParams).page) ?? 1) || 1);
  const { records, total } = await listMyAttendance(user.staff.id, page);

  const time = (value: string | null) => (value ? formatTimestamp(value, timeZone).split(", ")[1] : "—");

  return (
    <>
      <PageHeader title="My attendance" description="Your recorded shifts, newest first." />
      <Panel flush>
        {records.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck size={20} />}
            title="No attendance recorded yet"
            description="Your attendance appears here once you check in at an attendance point."
          />
        ) : (
          <>
            <DataTable caption="My attendance">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Shift</th>
                  <th scope="col">Checked in</th>
                  <th scope="col">Checked out</th>
                  <th scope="col" data-align="end">
                    Worked
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const status = ATTENDANCE_STATUS[record.status];
                  return (
                    <tr key={record.id}>
                      <td>
                        <Link href={`/my-attendance/${record.id}`}>{formatIsoDate(record.workDate, "EEE d MMM yyyy")}</Link>
                      </td>
                      <td>
                        {record.shiftCode ? `${record.shiftCode} · ${record.shiftName}` : "Unscheduled"}
                        {record.checkInLocationName && (
                          <div className="text-muted text-sm">{record.checkInLocationName}</div>
                        )}
                      </td>
                      <td className="tabular-nums">
                        {time(record.checkInAt)}
                        {record.isLate && <div className="text-sm">{formatMinutes(record.lateMinutes)} late</div>}
                      </td>
                      <td className="tabular-nums">
                        {time(record.checkOutAt)}
                        {record.isOvertime && (
                          <div className="text-sm">{formatMinutes(record.overtimeMinutes)} overtime</div>
                        )}
                      </td>
                      <td data-align="end">{formatMinutes(record.workedMinutes)}</td>
                      <td>
                        <div className={styles.badges}>
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {record.flags.map((flag) => (
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
            <div className={styles.footer}>
              <Pagination
                page={page}
                pageSize={MY_ATTENDANCE_PAGE_SIZE}
                total={total}
                hrefForPage={(next) => `/my-attendance${toQueryString({ page: next })}`}
                itemLabel="shifts"
              />
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
