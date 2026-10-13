import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { RequestReviewForm } from "@/components/requests/request-review-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DescriptionList } from "@/components/ui/description-list";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { ATTENDANCE_STATUS } from "@/features/attendance/labels";
import { createAttachmentUrl } from "@/features/attachments/queries";
import { reviewCorrection } from "@/features/corrections/actions";
import { getCorrection } from "@/features/corrections/queries";
import { formatIsoDate, formatTimestamp } from "@/lib/dates";
import { requireHospitalScope } from "@/lib/hospital-context";
import { REQUEST_STATUS } from "@/lib/request-status";
import { isRecordId } from "@/lib/validation";

export const metadata: Metadata = { title: "Attendance correction" };

export default async function CorrectionPage({ params }: { params: Promise<{ correctionId: string }> }) {
  const { correctionId } = await params;
  const { user, hospital } = await requireHospitalScope(["corrections.review", "attendance.viewDepartment"]);
  if (!hospital) return <NoHospitalState />;
  if (!isRecordId(correctionId)) notFound();

  const correction = await getCorrection(hospital.id, correctionId);
  if (!correction) notFound();

  const timeZone = hospital.timezone;
  const status = REQUEST_STATUS[correction.status];
  const recordStatus = ATTENDANCE_STATUS[correction.recordStatus];
  const evidenceUrl = await createAttachmentUrl(correction.evidencePath);
  const isOwnAttendance = user.staff?.id === correction.staffId;
  const canDecide = user.capabilities.has("corrections.review") && correction.status === "pending" && !isOwnAttendance;

  const time = (value: string | null) => (value ? formatTimestamp(value, timeZone) : "Not recorded");

  return (
    <div className={layout.narrow}>
      <PageHeader
        title={`Correction for ${correction.staffName}`}
        meta={<Badge tone={status.tone}>{status.label}</Badge>}
        description={`${correction.employeeNumber} · ${correction.departmentName} · ${formatIsoDate(correction.workDate)}`}
        back={{ href: "/corrections", label: "Attendance corrections" }}
      />

      <div className={layout.stack}>
        <Panel title="Requested change" flush>
          <DescriptionList
            items={[
              {
                term: "Recorded now",
                value: (
                  <>
                    <Badge tone={recordStatus.tone}>{recordStatus.label}</Badge>
                    <div>In: {time(correction.currentCheckInAt)}</div>
                    <div>Out: {time(correction.currentCheckOutAt)}</div>
                  </>
                ),
              },
              {
                term: "Requested",
                value: (
                  <>
                    <div>In: {correction.requestedCheckInAt ? time(correction.requestedCheckInAt) : "Unchanged"}</div>
                    <div>Out: {correction.requestedCheckOutAt ? time(correction.requestedCheckOutAt) : "Unchanged"}</div>
                  </>
                ),
              },
              { term: "Reason", value: correction.reason },
              ...(correction.evidencePath
                ? [
                    {
                      term: "Evidence",
                      value: evidenceUrl ? (
                        <a href={evidenceUrl} target="_blank" rel="noreferrer">
                          Open evidence
                        </a>
                      ) : (
                        "Attached, but it could not be opened"
                      ),
                    },
                  ]
                : []),
              { term: "Submitted", value: formatTimestamp(correction.createdAt, timeZone) },
              ...(correction.reviewedAt
                ? [
                    {
                      term: "Decision",
                      value: `${status.label} by ${correction.reviewedByName ?? "a reviewer"} on ${formatTimestamp(correction.reviewedAt, timeZone)}`,
                    },
                  ]
                : []),
              ...(correction.reviewNote ? [{ term: "Note", value: correction.reviewNote }] : []),
            ]}
          />
        </Panel>

        {canDecide && (
          <Panel
            title="Decision"
            description="Approving applies these times and recalculates late, overtime and early-leave minutes. The change is recorded in the audit log."
          >
            <RequestReviewForm
              requestId={correction.id}
              review={reviewCorrection}
              approveLabel="Approve correction"
            />
          </Panel>
        )}

        {isOwnAttendance && correction.status === "pending" && (
          <Alert tone="info">You cannot review a correction to your own attendance.</Alert>
        )}

        {!user.capabilities.has("corrections.review") && correction.status === "pending" && (
          <Alert tone="info">Attendance corrections are decided by a hospital administrator.</Alert>
        )}
      </div>
    </div>
  );
}
