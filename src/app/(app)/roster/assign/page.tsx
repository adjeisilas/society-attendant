import { CalendarClock, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { SelectField } from "@/components/ui/select-field";
import { listDepartmentOptions } from "@/features/departments/queries";
import { AssignShiftsForm } from "@/features/roster/components/assign-shifts-form";
import { listRosterStaff } from "@/features/roster/queries";
import { listShifts } from "@/features/shifts/queries";
import { addDaysToIsoDate, isIsoDate, startOfIsoWeek, todayInTimeZone } from "@/lib/dates";
import { requireHospitalScope } from "@/lib/hospital-context";
import { firstSearchParam, toQueryString, type SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Assign shifts" };

export default async function AssignShiftsPage({ searchParams }: { searchParams: SearchParams }) {
  const { hospital } = await requireHospitalScope("shifts.manage");
  if (!hospital) return <NoHospitalState />;

  const params = await searchParams;
  const departments = (await listDepartmentOptions(hospital.id)).filter((department) => department.isActive);
  if (departments.length === 0) {
    return (
      <>
        <PageHeader title="Assign shifts" back={{ href: "/roster", label: "Roster" }} />
        <Panel flush>
          <EmptyState
            icon={<Users size={20} />}
            title="No active departments yet"
            description="Rosters are organised by department."
            action={
              <Link href="/departments/new" className={buttonClassName()}>
                New department
              </Link>
            }
          />
        </Panel>
      </>
    );
  }

  const requestedDepartment = firstSearchParam(params.department);
  const department = departments.find((option) => option.id === requestedDepartment) ?? departments[0];
  const requestedStart = firstSearchParam(params.start);
  const startDate = isIsoDate(requestedStart) ? requestedStart : todayInTimeZone(hospital.timezone);

  const [staff, shifts] = await Promise.all([listRosterStaff(hospital.id, department.id), listShifts(hospital.id)]);
  const shiftOptions = shifts
    .filter((shift) => shift.isActive && (shift.departmentId === null || shift.departmentId === department.id))
    .map((shift) => ({ value: shift.id, label: `${shift.code} · ${shift.name} · ${shift.timesLabel}` }));
  const rosterHref = `/roster${toQueryString({ department: department.id, week: startOfIsoWeek(startDate) })}`;

  return (
    <div className={layout.stack}>
      <PageHeader
        title="Assign shifts"
        description={`Add shifts to the ${department.name} roster. Overlapping shifts are skipped and reported.`}
        back={{ href: rosterHref, label: "Roster" }}
      />

      <Panel flush>
        <FilterBar submitLabel="Change department">
          <SelectField
            name="department"
            label="Department"
            options={departments.map((option) => ({ value: option.id, label: option.name }))}
            defaultValue={department.id}
          />
          <input type="hidden" name="start" value={startDate} />
        </FilterBar>
      </Panel>

      <Panel title="Shifts to add">
        {staff.length === 0 ? (
          <EmptyState
            icon={<Users size={20} />}
            title="No active staff in this department"
            description="Add staff to this department before planning its roster."
            action={
              <Link href="/staff/new" className={buttonClassName({ variant: "secondary" })}>
                Add staff member
              </Link>
            }
          />
        ) : shiftOptions.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={20} />}
            title="No shift templates available"
            description="Create a shift template for this department, or one available to all departments."
            action={
              <Link href="/shifts/new" className={buttonClassName()}>
                New shift template
              </Link>
            }
          />
        ) : (
          <AssignShiftsForm
            key={department.id}
            staff={staff}
            shiftOptions={shiftOptions}
            defaultStartDate={startDate}
            defaultEndDate={addDaysToIsoDate(startDate, 6)}
            rosterHref={rosterHref}
          />
        )}
      </Panel>
    </div>
  );
}
