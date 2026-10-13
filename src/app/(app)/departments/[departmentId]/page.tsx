import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { ActiveStatusBadge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { DepartmentForm } from "@/features/departments/components/department-form";
import { getDepartment, listHeadCandidates } from "@/features/departments/queries";
import { requireHospitalScope } from "@/lib/hospital-context";
import { toQueryString } from "@/lib/search-params";
import { isRecordId } from "@/lib/validation";

export const metadata: Metadata = { title: "Department" };

export default async function DepartmentPage({ params }: { params: Promise<{ departmentId: string }> }) {
  const { departmentId } = await params;
  const { hospital } = await requireHospitalScope("departments.manage");
  if (!hospital) return <NoHospitalState />;
  if (!isRecordId(departmentId)) notFound();

  const [department, candidates] = await Promise.all([
    getDepartment(hospital.id, departmentId),
    listHeadCandidates(hospital.id, departmentId),
  ]);
  if (!department) notFound();

  const headOptions = candidates.map((candidate) => ({ value: candidate.id, label: candidate.label }));
  // Keep a head who is no longer eligible visible, so the form shows the real state.
  if (department.headStaffId && !headOptions.some((option) => option.value === department.headStaffId)) {
    headOptions.unshift({
      value: department.headStaffId,
      label: `${department.headName ?? "Current head"} (no longer an active member)`,
    });
  }

  return (
    <div className={layout.narrow}>
      <PageHeader
        title={department.name}
        meta={<ActiveStatusBadge active={department.isActive} />}
        description={`${department.code} · ${department.activeStaffCount} active staff`}
        back={{ href: "/departments", label: "Departments" }}
        actions={
          <Link
            href={`/staff${toQueryString({ department: department.id })}`}
            className={buttonClassName({ variant: "secondary" })}
          >
            View staff
          </Link>
        }
      />
      <Panel title="Department details">
        <DepartmentForm
          departmentId={department.id}
          defaultValues={{
            name: department.name,
            code: department.code,
            description: department.description ?? "",
            headStaffId: department.headStaffId ?? "",
            isActive: department.isActive,
          }}
          headOptions={headOptions}
        />
      </Panel>
    </div>
  );
}
