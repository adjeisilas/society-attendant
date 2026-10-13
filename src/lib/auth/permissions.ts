import type { Enums } from "@/types/database";

export type AppRole = Enums<"app_role">;

/** The facts about an account that determine what it may do. */
export interface AccessProfile {
  role: AppRole;
  isActive: boolean;
  hasStaffRecord: boolean;
  headedDepartmentCount: number;
}

export type Capability =
  | "hospitals.manage"
  | "settings.manage"
  | "departments.manage"
  | "staff.manage"
  | "staff.viewDepartment"
  | "shifts.manage"
  | "roster.viewDepartment"
  | "roster.viewOwn"
  | "locations.manage"
  | "attendance.viewOwn"
  | "attendance.viewDepartment"
  | "attendance.viewHospital"
  | "corrections.request"
  | "corrections.review"
  | "reports.view"
  | "audit.view";

const HOSPITAL_ADMIN: readonly Capability[] = [
  "settings.manage",
  "departments.manage",
  "staff.manage",
  "shifts.manage",
  "locations.manage",
  "attendance.viewHospital",
  "corrections.review",
  "reports.view",
  "audit.view",
];

/** Super admins also set up the hospital and edit its details. */
const SUPER_ADMIN: readonly Capability[] = ["hospitals.manage", ...HOSPITAL_ADMIN];

const DEPARTMENT_HEAD: readonly Capability[] = [
  "staff.viewDepartment",
  "roster.viewDepartment",
  "attendance.viewDepartment",
  "reports.view",
];

/** Staff clock in and out at attendance terminals, which need no capability of their own. */
const STAFF_MEMBER: readonly Capability[] = ["roster.viewOwn", "attendance.viewOwn", "corrections.request"];

/**
 * Capabilities used to shape the interface (navigation, page access).
 * They mirror the database authorization model; RLS and RPCs remain the enforcement point.
 */
export function capabilitiesFor(access: AccessProfile): ReadonlySet<Capability> {
  if (!access.isActive) return new Set();

  const granted: Capability[] = [];
  if (access.role === "super_admin") granted.push(...SUPER_ADMIN);
  if (access.role === "hospital_admin") granted.push(...HOSPITAL_ADMIN);
  if (access.headedDepartmentCount > 0) granted.push(...DEPARTMENT_HEAD);
  if (access.hasStaffRecord) granted.push(...STAFF_MEMBER);
  return new Set(granted);
}

export function roleLabel(access: AccessProfile): string {
  switch (access.role) {
    case "super_admin":
      return "Super Admin";
    case "hospital_admin":
      return "Hospital Admin";
    case "staff":
      return access.headedDepartmentCount > 0 ? "Department Head" : "Staff";
  }
}
