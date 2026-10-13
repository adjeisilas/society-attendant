import { Clock, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { ActiveStatusBadge, Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { listShifts } from "@/features/shifts/queries";
import { formatDuration } from "@/features/shifts/time";
import { requireHospitalScope } from "@/lib/hospital-context";

export const metadata: Metadata = { title: "Shift templates" };

export default async function ShiftsPage() {
  const { hospital } = await requireHospitalScope("shifts.manage");
  if (!hospital) return <NoHospitalState />;

  const shifts = await listShifts(hospital.id);
  const newShiftLink = (
    <Link href="/shifts/new" className={buttonClassName()}>
      <Plus size={16} aria-hidden="true" />
      New shift template
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Shift templates"
        description={`Working patterns used to build rosters. Times are in ${hospital.timezone}.`}
        actions={shifts.length > 0 && newShiftLink}
      />
      <Panel flush>
        {shifts.length === 0 ? (
          <EmptyState
            icon={<Clock size={20} />}
            title="No shift templates yet"
            description="Define the shifts your hospital works, such as day, evening and night, with their attendance rules."
            action={newShiftLink}
          />
        ) : (
          <DataTable caption="Shift templates">
            <thead>
              <tr>
                <th scope="col">Shift</th>
                <th scope="col">Times</th>
                <th scope="col">Length</th>
                <th scope="col">Department</th>
                <th scope="col" data-align="end">
                  Late after
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => (
                <tr key={shift.id}>
                  <td>
                    <Link href={`/shifts/${shift.id}`}>{shift.name}</Link>
                    <div className="text-muted text-sm">
                      <code>{shift.code}</code>
                    </div>
                  </td>
                  <td className="tabular-nums">
                    {shift.startTime}–{shift.endTime} {shift.endsNextDay && <Badge tone="info">Next day</Badge>}
                  </td>
                  <td>
                    {formatDuration(shift.durationMinutes)}
                    {shift.breakMinutes > 0 && (
                      <div className="text-muted text-sm">{formatDuration(shift.breakMinutes)} break</div>
                    )}
                  </td>
                  <td>{shift.departmentName ?? <span className="text-muted">All departments</span>}</td>
                  <td data-align="end">{shift.lateGraceMinutes} min</td>
                  <td>
                    <ActiveStatusBadge active={shift.isActive} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </>
  );
}
