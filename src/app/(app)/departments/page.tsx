import { Building2, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { ActiveStatusBadge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { listDepartments } from "@/features/departments/queries";
import { requireHospitalScope } from "@/lib/hospital-context";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const { hospital } = await requireHospitalScope("departments.manage");
  if (!hospital) return <NoHospitalState />;

  const departments = await listDepartments(hospital.id);
  const newDepartmentLink = (
    <Link href="/departments/new" className={buttonClassName()}>
      <Plus size={16} aria-hidden="true" />
      New department
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Departments"
        description={`Departments and units at ${hospital.name}.`}
        actions={departments.length > 0 && newDepartmentLink}
      />
      <Panel flush>
        {departments.length === 0 ? (
          <EmptyState
            icon={<Building2 size={20} />}
            title="No departments yet"
            description="Create the departments and units that staff belong to. Shifts and rosters are organised by department."
            action={newDepartmentLink}
          />
        ) : (
          <DataTable caption="Departments">
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Code</th>
                <th scope="col">Head</th>
                <th scope="col" data-align="end">
                  Active staff
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => (
                <tr key={department.id}>
                  <td>
                    <Link href={`/departments/${department.id}`}>{department.name}</Link>
                    {department.description && <div className="text-muted text-sm">{department.description}</div>}
                  </td>
                  <td>
                    <code>{department.code}</code>
                  </td>
                  <td>{department.headName ?? <span className="text-muted">Not assigned</span>}</td>
                  <td data-align="end">{department.activeStaffCount}</td>
                  <td>
                    <ActiveStatusBadge active={department.isActive} />
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
