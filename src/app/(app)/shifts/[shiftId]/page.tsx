import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { ActiveStatusBadge } from "@/components/ui/badge";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { listDepartmentOptions } from "@/features/departments/queries";
import { ShiftForm } from "@/features/shifts/components/shift-form";
import { getShift } from "@/features/shifts/queries";
import { formatDuration } from "@/features/shifts/time";
import { requireHospitalScope } from "@/lib/hospital-context";
import { isRecordId } from "@/lib/validation";

export const metadata: Metadata = { title: "Shift template" };

export default async function ShiftPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params;
  const { hospital } = await requireHospitalScope("shifts.manage");
  if (!hospital) return <NoHospitalState />;
  if (!isRecordId(shiftId)) notFound();

  const [shift, departments] = await Promise.all([getShift(hospital.id, shiftId), listDepartmentOptions(hospital.id)]);
  if (!shift) notFound();

  const departmentOptions = departments
    .filter((department) => department.isActive || department.id === shift.departmentId)
    .map((department) => ({
      value: department.id,
      label: department.isActive ? department.name : `${department.name} (inactive)`,
    }));

  return (
    <div className={layout.narrow}>
      <PageHeader
        title={shift.name}
        meta={<ActiveStatusBadge active={shift.isActive} />}
        description={`${shift.code} · ${shift.timesLabel} · ${formatDuration(shift.durationMinutes)}`}
        back={{ href: "/shifts", label: "Shift templates" }}
      />
      <Panel title="Shift template">
        <ShiftForm
          shiftId={shift.id}
          departmentOptions={departmentOptions}
          defaultValues={{
            name: shift.name,
            code: shift.code,
            departmentId: shift.departmentId ?? "",
            startTime: shift.startTime,
            endTime: shift.endTime,
            breakMinutes: shift.breakMinutes,
            lateGraceMinutes: shift.lateGraceMinutes,
            earlyLeaveGraceMinutes: shift.earlyLeaveGraceMinutes,
            overtimeThresholdMinutes: shift.overtimeThresholdMinutes,
            checkInOpensMinutes: shift.checkInOpensMinutes,
            isActive: shift.isActive,
          }}
        />
      </Panel>
    </div>
  );
}
