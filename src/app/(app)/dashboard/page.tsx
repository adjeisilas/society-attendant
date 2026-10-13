import {
  CalendarClock,
  ClipboardCheck,
  Clock3,
  FilePenLine,
  LogIn,
  LogOut,
  MonitorSmartphone,
  TimerOff,
  UserCheck,
  UserX,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { NoHospitalState } from "@/components/no-hospital-state";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { DescriptionList, type DescriptionItem } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { ATTENDANCE_STATUS } from "@/features/attendance/labels";
import { getOpenSession, listAttendanceForDay, listMyShiftsOn } from "@/features/attendance/queries";
import { listCorrections } from "@/features/corrections/queries";
import { roleLabel } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { formatIsoDate, formatTimeOfDay, todayInTimeZone } from "@/lib/dates";
import { getWorkingHospital } from "@/lib/hospital-context";
import styles from "./dashboard.module.css";

export const metadata: Metadata = { title: "Dashboard" };

const RECENT_ACTIVITY_LIMIT = 6;

export default async function DashboardPage() {
  const user = await requireUser();
  const hospital = await getWorkingHospital(user);
  if (!hospital && user.capabilities.has("hospitals.manage")) return <NoHospitalState />;

  const timeZone = hospital?.timezone ?? "UTC";
  const today = todayInTimeZone(timeZone);

  const canSeeAttendance =
    user.capabilities.has("attendance.viewHospital") || user.capabilities.has("attendance.viewDepartment");
  const canReviewCorrections = user.capabilities.has("corrections.review");

  const [openSession, myShifts, dayRows, pendingCorrections] = await Promise.all([
    user.staff ? getOpenSession(user.staff.id) : Promise.resolve(null),
    user.staff && hospital ? listMyShiftsOn(hospital.id, user.staff.id, today) : Promise.resolve([]),
    hospital && canSeeAttendance ? listAttendanceForDay(hospital.id, { workDate: today }) : Promise.resolve([]),
    hospital && canReviewCorrections
      ? listCorrections(hospital.id, { status: "pending", department: "" })
      : Promise.resolve([]),
  ]);

  const counts = {
    onDuty: dayRows.filter((row) => row.record?.isOpen && row.record.checkInAt).length,
    clockedIn: dayRows.filter((row) => row.record?.status === "present" || row.record?.status === "late").length,
    late: dayRows.filter((row) => row.record?.status === "late").length,
    absent: dayRows.filter((row) => row.record?.status === "absent").length,
    notYet: dayRows.filter((row) => row.record === null).length,
  };

  const recentActivity = dayRows
    .flatMap((row) => {
      const record = row.record;
      if (!record?.checkInAt) return [];
      const at = record.checkOutAt ?? record.checkInAt;
      return [{ key: row.key, row, record, at, direction: record.checkOutAt ? ("out" as const) : ("in" as const) }];
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_ACTIVITY_LIMIT);

  const nextShift = myShifts.find((shift) => !shift.hasRecord) ?? myShifts[0];
  const firstName = (user.staff?.fullName ?? user.displayName).split(" ")[0];

  const accessItems: DescriptionItem[] = [
    { term: "Role", value: roleLabel(user.access) },
    {
      term: "Staff record",
      value: user.staff ? `${user.staff.fullName} · ${user.staff.employeeNumber}` : "Not linked to a staff record",
    },
    ...(user.headedDepartments.length > 0
      ? [{ term: "Departments you head", value: user.headedDepartments.map((department) => department.name).join(", ") }]
      : []),
  ];

  return (
    <>
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.heroEyebrow}>{formatIsoDate(today, "EEEE d MMMM yyyy")}</p>
          <h1 className={styles.heroTitle}>Welcome back, {firstName}</h1>
          <p className={styles.heroMeta}>
            {hospital && <span>{hospital.name}</span>}
            <span className={styles.heroRole}>{roleLabel(user.access)}</span>
          </p>
        </div>
        <span className={styles.heroMark} aria-hidden="true">
          <Clock3 size={30} strokeWidth={2.2} />
        </span>
      </header>

      <div className={styles.grid}>
        {canSeeAttendance && hospital && (
          <section className={styles.fullRow} aria-label="Attendance today">
            <div className={styles.tiles}>
              <StatTile icon={<Clock3 size={18} />} tone="primary" label="On duty now" value={counts.onDuty} />
              <StatTile icon={<UserCheck size={18} />} tone="success" label="Clocked in today" value={counts.clockedIn} />
              <StatTile icon={<TimerOff size={18} />} tone="warning" label="Late" value={counts.late} />
              <StatTile icon={<UserX size={18} />} tone="danger" label="Absent" value={counts.absent} />
              <StatTile icon={<CalendarClock size={18} />} tone="neutral" label="Yet to clock in" value={counts.notYet} />
            </div>
          </section>
        )}

        {user.staff && (
          <Panel
            title="Your day"
            description="Clock in and out at any attendance terminal."
            actions={
              <Link href="/my-attendance" className={buttonClassName({ variant: "secondary", size: "sm" })}>
                My attendance
              </Link>
            }
          >
            {openSession ? (
              <div className={styles.today}>
                <span className={styles.todayIcon} data-tone="success" aria-hidden="true">
                  <LogIn size={20} />
                </span>
                <div>
                  <p className={styles.todayHeadline}>
                    Clocked in at {openSession.checkInAt ? formatTimeOfDay(openSession.checkInAt, timeZone) : "—"}
                  </p>
                  <p className={styles.todayMeta}>
                    <Badge tone={ATTENDANCE_STATUS[openSession.status].tone}>
                      {ATTENDANCE_STATUS[openSession.status].label}
                    </Badge>
                    {openSession.scheduledEnd && <span>Due to finish {formatTimeOfDay(openSession.scheduledEnd, timeZone)}</span>}
                    {openSession.checkInLocationName && <span>{openSession.checkInLocationName}</span>}
                  </p>
                </div>
              </div>
            ) : nextShift ? (
              <div className={styles.today}>
                <span className={styles.todayIcon} data-tone={nextShift.hasRecord ? "neutral" : "primary"} aria-hidden="true">
                  <CalendarClock size={20} />
                </span>
                <div>
                  <p className={styles.todayHeadline}>{nextShift.shiftLabel}</p>
                  <p className={styles.todayMeta}>
                    <span>{nextShift.times}</span>
                    {nextShift.hasRecord ? <Badge tone="success">Attendance recorded</Badge> : <Badge>Not clocked in</Badge>}
                  </p>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<CalendarClock size={22} />}
                title="No shift rostered today"
                description="Your rostered shifts appear here on the day they start."
              />
            )}
          </Panel>
        )}

        {canSeeAttendance && hospital && (
          <Panel
            title="Latest activity"
            description={user.capabilities.has("attendance.viewHospital") ? "Across the hospital today." : "In your departments today."}
            actions={
              <Link href="/attendance" className={buttonClassName({ variant: "secondary", size: "sm" })}>
                All records
              </Link>
            }
            flush
          >
            {recentActivity.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck size={22} />}
                title="No clock-ins yet today"
                description="Clock-ins and clock-outs appear here as staff use the terminals."
              />
            ) : (
              <ul className={styles.activity}>
                {recentActivity.map((item) => (
                  <li key={item.key}>
                    <span className={styles.activityIcon} data-direction={item.direction} aria-hidden="true">
                      {item.direction === "in" ? <LogIn size={15} /> : <LogOut size={15} />}
                    </span>
                    <div className={styles.activityWho}>
                      <span className={styles.activityName}>{item.row.staffName}</span>
                      <span className={styles.activityMeta}>{item.row.departmentName}</span>
                    </div>
                    <Badge tone={ATTENDANCE_STATUS[item.record.status].tone}>{ATTENDANCE_STATUS[item.record.status].label}</Badge>
                    <span className={styles.activityTime}>
                      {item.direction === "in" ? "In" : "Out"} {formatTimeOfDay(item.at, timeZone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {canReviewCorrections && (
          <Panel title="Waiting for you">
            {pendingCorrections.length === 0 ? (
              <EmptyState
                icon={<FilePenLine size={22} />}
                title="Nothing to review"
                description="Requests to correct clock-in or clock-out times appear here."
              />
            ) : (
              <div className={styles.today}>
                <span className={styles.todayIcon} data-tone="warning" aria-hidden="true">
                  <FilePenLine size={20} />
                </span>
                <div>
                  <p className={styles.todayHeadline}>
                    {pendingCorrections.length} {pendingCorrections.length === 1 ? "correction" : "corrections"} awaiting review
                  </p>
                  <p className={styles.todayMeta}>
                    <Link href="/corrections">Review corrections</Link>
                  </p>
                </div>
              </div>
            )}
          </Panel>
        )}

        {user.capabilities.has("locations.manage") && (
          <Panel title="Terminals" description="Computers where staff clock in and out.">
            <div className={styles.today}>
              <span className={styles.todayIcon} data-tone="primary" aria-hidden="true">
                <MonitorSmartphone size={20} />
              </span>
              <div>
                <p className={styles.todayHeadline}>Register computers at each location</p>
                <p className={styles.todayMeta}>
                  <Link href="/locations">Manage terminals</Link>
                </p>
              </div>
            </div>
          </Panel>
        )}

        <Panel title="Your access" description="What this account can see and do." flush>
          <DescriptionList items={accessItems} />
        </Panel>
      </div>
    </>
  );
}

type TileTone = "primary" | "success" | "warning" | "danger" | "neutral";

function StatTile({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: TileTone }) {
  return (
    <div className={styles.tile} data-tone={tone}>
      <div className={styles.tileTop}>
        <p className={styles.tileLabel}>{label}</p>
        <span className={styles.tileIcon} data-tone={tone} aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className={styles.tileValue}>{value}</p>
    </div>
  );
}
