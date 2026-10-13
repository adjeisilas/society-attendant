import { Plus, Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { listDepartmentOptions } from "@/features/departments/queries";
import { ACCOUNT_STATE, STAFF_STATUS, type StaffStatus } from "@/features/staff/labels";
import { listStaff } from "@/features/staff/queries";
import { STAFF_PAGE_SIZE, staffFiltersSchema } from "@/features/staff/schemas";
import { requireHospitalScope } from "@/lib/hospital-context";
import { firstSearchParam, toQueryString, type SearchParams } from "@/lib/search-params";
import styles from "./staff.module.css";

export const metadata: Metadata = { title: "Staff" };

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...(Object.keys(STAFF_STATUS) as StaffStatus[]).map((status) => ({ value: status, label: STAFF_STATUS[status].label })),
];

export default async function StaffPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, hospital } = await requireHospitalScope(["staff.manage", "staff.viewDepartment"]);
  if (!hospital) return <NoHospitalState />;

  const params = await searchParams;
  const filters = staffFiltersSchema.parse({
    q: firstSearchParam(params.q),
    department: firstSearchParam(params.department),
    status: firstSearchParam(params.status),
    page: firstSearchParam(params.page),
  });
  const canManage = user.capabilities.has("staff.manage");

  const [{ members, total }, departments] = await Promise.all([
    listStaff(hospital.id, filters),
    listDepartmentOptions(hospital.id),
  ]);
  const departmentOptions = departments
    .filter((department) => canManage || user.headedDepartments.some((headed) => headed.id === department.id))
    .map((department) => ({ value: department.id, label: department.name }));

  const isFiltered = Boolean(filters.q || filters.department || filters.status !== "active");
  const hrefForPage = (page: number) =>
    `/staff${toQueryString({ q: filters.q, department: filters.department, status: filters.status, page })}`;

  const newStaffLink = canManage && (
    <Link href="/staff/new" className={buttonClassName()}>
      <Plus size={16} aria-hidden="true" />
      Add staff member
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Staff"
        description={canManage ? `Staff records at ${hospital.name}.` : "Staff in the departments you head."}
        actions={newStaffLink}
      />
      <Panel flush>
        <FilterBar resetHref={isFiltered ? "/staff" : undefined}>
          <TextField
            name="q"
            type="search"
            label="Search"
            placeholder="Name, employee number, email or job title"
            defaultValue={filters.q}
          />
          <SelectField
            name="department"
            label="Department"
            placeholder="All departments"
            options={departmentOptions}
            defaultValue={filters.department}
          />
          <SelectField name="status" label="Status" options={STATUS_FILTER_OPTIONS} defaultValue={filters.status} />
        </FilterBar>

        {members.length === 0 ? (
          isFiltered || filters.page > 1 ? (
            <EmptyState
              icon={<Search size={20} />}
              title="No staff match these filters"
              description="Try a different search, department or status."
              action={
                <Link href="/staff" className={buttonClassName({ variant: "secondary" })}>
                  Clear filters
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={<Users size={20} />}
              title="No staff records yet"
              description={
                canManage
                  ? "Add staff members, then give them an account so they can clock in at the terminals."
                  : "There are no active staff in the departments you head."
              }
              action={newStaffLink}
            />
          )
        ) : (
          <>
            <DataTable caption="Staff">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Department</th>
                  <th scope="col">Job title</th>
                  <th scope="col">Status</th>
                  {canManage && <th scope="col">Sign-in account</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <Link href={`/staff/${member.id}`}>{member.fullName}</Link>
                      <div className="text-muted text-sm">{member.employeeNumber}</div>
                    </td>
                    <td>{member.departmentName}</td>
                    <td>{member.jobTitle}</td>
                    <td>
                      <Badge tone={STAFF_STATUS[member.status].tone}>{STAFF_STATUS[member.status].label}</Badge>
                    </td>
                    {canManage && (
                      <td>
                        <Badge tone={ACCOUNT_STATE[member.accountState].tone}>
                          {ACCOUNT_STATE[member.accountState].label}
                        </Badge>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <div className={styles.footer}>
              <Pagination
                page={filters.page}
                pageSize={STAFF_PAGE_SIZE}
                total={total}
                hrefForPage={hrefForPage}
                itemLabel="staff"
              />
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
