import { FilePenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Panel } from "@/components/ui/panel";
import { SelectField } from "@/components/ui/select-field";
import { listDepartmentOptions } from "@/features/departments/queries";
import { listCorrections } from "@/features/corrections/queries";
import { correctionFiltersSchema } from "@/features/corrections/schemas";
import { formatIsoDate, formatTimestamp } from "@/lib/dates";
import { requireHospitalScope } from "@/lib/hospital-context";
import { REQUEST_STATUS } from "@/lib/request-status";
import { firstSearchParam, type SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Attendance corrections" };

const STATUS_OPTIONS = [
  { value: "pending", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Not approved" },
  { value: "cancelled", label: "Withdrawn" },
  { value: "all", label: "All corrections" },
];

export default async function CorrectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, hospital } = await requireHospitalScope(["corrections.review", "attendance.viewDepartment"]);
  if (!hospital) return <NoHospitalState />;

  const params = await searchParams;
  const filters = correctionFiltersSchema.parse({
    status: firstSearchParam(params.status),
    department: firstSearchParam(params.department),
  });
  const canReview = user.capabilities.has("corrections.review");

  const [corrections, departments] = await Promise.all([
    listCorrections(hospital.id, filters),
    listDepartmentOptions(hospital.id),
  ]);
  const departmentOptions = departments
    .filter((department) => canReview || user.headedDepartments.some((headed) => headed.id === department.id))
    .map((department) => ({ value: department.id, label: department.name }));

  return (
    <>
      <PageHeader
        title="Attendance corrections"
        description={
          canReview
            ? "Requests to change recorded attendance times. Approving recalculates the attendance status."
            : "Corrections requested by staff in your departments. Hospital administrators decide them."
        }
      />
      <Panel flush>
        <FilterBar resetHref="/corrections">
          <SelectField name="status" label="Status" options={STATUS_OPTIONS} defaultValue={filters.status} />
          <SelectField
            name="department"
            label="Department"
            placeholder="All departments"
            options={departmentOptions}
            defaultValue={filters.department}
          />
        </FilterBar>

        {corrections.length === 0 ? (
          <EmptyState
            icon={<FilePenLine size={20} />}
            title="No corrections"
            description="Requests to change attendance times appear here."
          />
        ) : (
          <DataTable caption="Attendance corrections">
            <thead>
              <tr>
                <th scope="col">Staff</th>
                <th scope="col">Department</th>
                <th scope="col">Attendance date</th>
                <th scope="col">Requested</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((correction) => {
                const status = REQUEST_STATUS[correction.status];
                return (
                  <tr key={correction.id}>
                    <td>
                      <Link href={`/corrections/${correction.id}`}>{correction.staffName}</Link>
                      <div className="text-muted text-sm">{correction.employeeNumber}</div>
                    </td>
                    <td>{correction.departmentName}</td>
                    <td>{formatIsoDate(correction.workDate)}</td>
                    <td>{formatTimestamp(correction.createdAt, hospital.timezone)}</td>
                    <td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </>
  );
}
