import type { Metadata } from "next";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { listDepartmentOptions } from "@/features/departments/queries";
import { ShiftForm } from "@/features/shifts/components/shift-form";
import { requireHospitalScope } from "@/lib/hospital-context";

export const metadata: Metadata = { title: "New shift template" };

export default async function NewShiftPage() {
  const { hospital } = await requireHospitalScope("shifts.manage");
  if (!hospital) return <NoHospitalState />;

  const departments = (await listDepartmentOptions(hospital.id)).filter((department) => department.isActive);

  return (
    <div className={layout.narrow}>
      <PageHeader
        title="New shift template"
        description={`Times are recorded in ${hospital.timezone}.`}
        back={{ href: "/shifts", label: "Shift templates" }}
      />
      <Panel>
        <ShiftForm
          departmentOptions={departments.map((department) => ({ value: department.id, label: department.name }))}
          defaultValues={{
            name: "",
            code: "",
            departmentId: "",
            startTime: "07:00",
            endTime: "15:00",
            breakMinutes: 30,
            lateGraceMinutes: 10,
            earlyLeaveGraceMinutes: 10,
            overtimeThresholdMinutes: 30,
            checkInOpensMinutes: 60,
            isActive: true,
          }}
        />
      </Panel>
    </div>
  );
}
