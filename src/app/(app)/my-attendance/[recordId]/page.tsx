import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DescriptionList } from "@/components/ui/description-list";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { StatusPanel } from "@/components/ui/status-panel";
import { ClipboardCheck } from "lucide-react";
import { ATTENDANCE_FLAG_LABELS, ATTENDANCE_STATUS, formatMinutes } from "@/features/attendance/labels";
import { getAttendanceRecord } from "@/features/attendance/queries";
import { CorrectionRequestForm } from "@/features/corrections/components/correction-request-form";
import { listCorrectionsForRecord } from "@/features/corrections/queries";
import { requireCapability } from "@/lib/auth/session";
import { formatIsoDate, formatTimestamp } from "@/lib/dates";
import { REQUEST_STATUS } from "@/lib/request-status";
import { isRecordId } from "@/lib/validation";

export const metadata: Metadata = { title: "Attendance record" };

export default async function MyAttendanceRecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params;
  const user = await requireCapability("attendance.viewOwn");
  if (!user.hospital) {
    return (
      <StatusPanel
        icon={<ClipboardCheck size={22} />}
        title="No staff record"
        description="Attendance is recorded against a staff record. Contact your HR office."
      />
    );
  }
  if (!isRecordId(recordId)) notFound();

  const record = await getAttendanceRecord(recordId);
  if (!record) notFound();

  const timeZone = user.hospital.timezone;
  const corrections = await listCorrectionsForRecord(record.id);
  const status = ATTENDANCE_STATUS[record.status];
  const isOwnRecord = user.staff?.id === record.staffId;
  const hasPending = corrections.some((correction) => correction.status === "pending");

  return (
    <div className={layout.narrow}>
      <PageHeader
        title={formatIsoDate(record.workDate, "EEEE d MMMM yyyy")}
        meta={<Badge tone={status.tone}>{status.label}</Badge>}
        description={record.shiftCode ? `${record.shiftCode} · ${record.shiftName}` : "Unscheduled attendance"}
        back={{ href: "/my-attendance", label: "My attendance" }}
      />

      <div className={layout.stack}>
        <Panel title="Recorded attendance" flush>
          <DescriptionList
            items={[
              {
                term: "Scheduled",
                value:
                  record.scheduledStart && record.scheduledEnd
                    ? `${formatTimestamp(record.scheduledStart, timeZone)} – ${formatTimestamp(record.scheduledEnd, timeZone)}`
                    : "No shift rostered",
              },
              {
                term: "Checked in",
                value: record.checkInAt
                  ? `${formatTimestamp(record.checkInAt, timeZone)}${record.checkInLocationName ? ` · ${record.checkInLocationName}` : ""}`
                  : "Not recorded",
              },
              {
                term: "Checked out",
                value: record.checkOutAt
                  ? `${formatTimestamp(record.checkOutAt, timeZone)}${record.checkOutLocationName ? ` · ${record.checkOutLocationName}` : ""}`
                  : "Not recorded",
              },
              { term: "Time worked", value: formatMinutes(record.workedMinutes) },
              ...(record.isLate ? [{ term: "Late by", value: formatMinutes(record.lateMinutes) }] : []),
              ...(record.isOvertime ? [{ term: "Overtime", value: formatMinutes(record.overtimeMinutes) }] : []),
              ...(record.isEarlyLeave ? [{ term: "Left early by", value: formatMinutes(record.earlyLeaveMinutes) }] : []),
              ...(record.flags.length > 0
                ? [{ term: "Flagged", value: record.flags.map((flag) => ATTENDANCE_FLAG_LABELS[flag]).join(", ") }]
                : []),
            ]}
          />
        </Panel>

        {corrections.length > 0 && (
          <Panel title="Corrections" flush>
            <DescriptionList
              items={corrections.map((correction) => ({
                term: formatTimestamp(correction.createdAt, timeZone),
                value: (
                  <>
                    <Badge tone={REQUEST_STATUS[correction.status].tone}>
                      {REQUEST_STATUS[correction.status].label}
                    </Badge>{" "}
                    {correction.reason}
                    {correction.reviewNote && <div className="text-muted text-sm">{correction.reviewNote}</div>}
                  </>
                ),
              }))}
            />
          </Panel>
        )}

        {isOwnRecord && (
          <Panel
            title="Request a correction"
            description="Ask an administrator to change the recorded times. Nothing changes until they approve it."
          >
            {hasPending ? (
              <Alert tone="info">
                A correction for this record is already awaiting review. You will be told once it is decided.
              </Alert>
            ) : (
              <CorrectionRequestForm
                attendanceRecordId={record.id}
                currentCheckInAt={record.checkInAt}
                currentCheckOutAt={record.checkOutAt}
              />
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
