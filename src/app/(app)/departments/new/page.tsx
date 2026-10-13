import type { Metadata } from "next";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { DepartmentForm } from "@/features/departments/components/department-form";
import { requireHospitalScope } from "@/lib/hospital-context";

export const metadata: Metadata = { title: "New department" };

export default async function NewDepartmentPage() {
  const { hospital } = await requireHospitalScope("departments.manage");
  if (!hospital) return <NoHospitalState />;

  return (
    <div className={layout.narrow}>
      <PageHeader
        title="New department"
        description={`Add a department or unit to ${hospital.name}. You can appoint a head once staff are assigned to it.`}
        back={{ href: "/departments", label: "Departments" }}
      />
      <Panel>
        <DepartmentForm defaultValues={{ name: "", code: "", description: "", headStaffId: "", isActive: true }} />
      </Panel>
    </div>
  );
}
