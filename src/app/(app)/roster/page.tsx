import { Building2, CalendarClock, Plus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Panel } from "@/components/ui/panel";
import { SelectField } from "@/components/ui/select-field";
import { listDepartmentOptions } from "@/features/departments/queries";
import { RosterGrid } from "@/features/roster/components/roster-grid";
import { getRosterWeek } from "@/features/roster/queries";
import { listShifts } from "@/features/shifts/queries";
import { addDaysToIsoDate, formatIsoDate, isIsoDate, startOfIsoWeek, todayInTimeZone } from "@/lib/dates";
import { requireHospitalScope } from "@/lib/hospital-context";
import { firstSearchParam, toQueryString, type SearchParams } from "@/lib/search-params";
import styles from "./roster.module.css";

export const metadata: Metadata = { title: "Roster" };

export default async function RosterPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, hospital } = await requireHospitalScope(["shifts.manage", "roster.viewDepartment"]);
  if (!hospital) return <NoHospitalState />;

  const canManage = user.capabilities.has("shifts.manage");
  const params = await searchParams;
  const today = todayInTimeZone(hospital.timezone);
  const requestedWeek = firstSearchParam(params.week);
  const weekStart = startOfIsoWeek(isIsoDate(requestedWeek) ? requestedWeek : today);

  const departments = (await listDepartmentOptions(hospital.id)).filter(
    (department) =>
      department.isActive && (canManage || user.headedDepartments.some((headed) => headed.id === department.id)),
  );

  if (departments.length === 0) {
    return (
      <>
        <PageHeader title="Roster" />
        <Panel flush>
          <EmptyState
            icon={<Building2 size={20} />}
            title={canManage ? "No active departments yet" : "You do not head an active department"}
            description={
              canManage
                ? "Rosters are organised by department. Create a department to start planning shifts."
                : "Ask your hospital administrator if you should be the head of a department."
            }
            action={
              canManage && (
                <Link href="/departments/new" className={buttonClassName()}>
                  New department
                </Link>
              )
            }
          />
        </Panel>
      </>
    );
  }

  const requestedDepartment = firstSearchParam(params.department);
  const department = departments.find((option) => option.id === requestedDepartment) ?? departments[0];
  const [week, shifts] = await Promise.all([
    getRosterWeek(hospital.id, department.id, weekStart),
    canManage ? listShifts(hospital.id) : Promise.resolve([]),
  ]);
  const activeShifts = shifts.filter((shift) => shift.isActive);

  const weekHref = (week: string) => `/roster${toQueryString({ department: department.id, week })}`;

  return (
    <>
      <PageHeader
        title="Roster"
        description={`${department.name} · week of ${formatIsoDate(weekStart)}`}
        actions={
          canManage && (
            <Link
              href={`/roster/assign${toQueryString({ department: department.id, start: weekStart })}`}
              className={buttonClassName()}
            >
              <Plus size={16} aria-hidden="true" />
              Assign shifts
            </Link>
          )
        }
      />

      <Panel flush>
        <FilterBar submitLabel="Show">
          <SelectField
            name="department"
            label="Department"
            options={departments.map((option) => ({ value: option.id, label: option.name }))}
            defaultValue={department.id}
          />
          <input type="hidden" name="week" value={weekStart} />
        </FilterBar>

        <div className={styles.weekBar}>
          <Link href={weekHref(addDaysToIsoDate(weekStart, -7))} className={buttonClassName({ variant: "secondary", size: "sm" })}>
            Previous week
          </Link>
          <Link href={weekHref(startOfIsoWeek(today))} className={buttonClassName({ variant: "ghost", size: "sm" })}>
            This week
          </Link>
          <Link href={weekHref(addDaysToIsoDate(weekStart, 7))} className={buttonClassName({ variant: "secondary", size: "sm" })}>
            Next week
          </Link>
        </div>

        {week.staff.length === 0 ? (
          <EmptyState
            icon={<Users size={20} />}
            title="No active staff in this department"
            description="Add staff to this department before planning its roster."
            action={
              canManage && (
                <Link href="/staff/new" className={buttonClassName({ variant: "secondary" })}>
                  Add staff member
                </Link>
              )
            }
          />
        ) : (
          <RosterGrid week={week} today={today} canManage={canManage} />
        )}
      </Panel>

      {canManage && activeShifts.length > 0 && (
        <div className={styles.legend}>
          <Panel title="Shift templates" description="Codes used in the roster." flush>
            <ul className={styles.legendList}>
              {activeShifts.map((shift) => (
                <li key={shift.id}>
                  <code>{shift.code}</code> {shift.name}
                  <span className="text-muted"> · {shift.timesLabel}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {canManage && activeShifts.length === 0 && (
        <div className={styles.legend}>
          <Panel flush>
            <EmptyState
              icon={<CalendarClock size={20} />}
              title="No shift templates yet"
              description="Create a shift template before assigning shifts to staff."
              action={
                <Link href="/shifts/new" className={buttonClassName()}>
                  New shift template
                </Link>
              }
            />
          </Panel>
        </div>
      )}
    </>
  );
}
