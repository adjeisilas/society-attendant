import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { listDepartmentOptions } from "@/features/departments/queries";
import { StaffForm } from "@/features/staff/components/staff-form";
import { requireHospitalScope } from "@/lib/hospital-context";
import { todayInTimeZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Add staff member" };

export default async function NewStaffPage() {
  const { hospital } = await requireHospitalScope("staff.manage");
  if (!hospital) return <NoHospitalState />;

  const departments = (await listDepartmentOptions(hospital.id)).filter((department) => department.isActive);

  return (
    <div className={layout.narrow}>
      <PageHeader
        title="Add staff member"
        description="Create the staff record first. You can invite the staff member to sign in afterwards."
        back={{ href: "/staff", label: "Staff" }}
      />
      <Panel>
        {departments.length === 0 ? (
          <EmptyState
            icon={<Building2 size={20} />}
            title="Create a department first"
            description="Every staff member belongs to a department."
            action={
              <Link href="/departments/new" className={buttonClassName()}>
                New department
              </Link>
            }
          />
        ) : (
          <StaffForm
            departmentOptions={departments.map((department) => ({ value: department.id, label: department.name }))}
            defaultValues={{
              employeeNumber: "",
              firstName: "",
              lastName: "",
              email: "",
              phone: "",
              jobTitle: "",
              departmentId: "",
              employmentType: "full_time",
              hireDate: todayInTimeZone(hospital.timezone),
            }}
          />
        )}
      </Panel>
    </div>
  );
}
