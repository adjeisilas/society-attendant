import type { Capability } from "./auth/permissions";

export type NavigationIcon =
  | "dashboard"
  | "history"
  | "staff"
  | "departments"
  | "shifts"
  | "roster"
  | "attendance"
  | "corrections"
  | "terminals"
  | "reports"
  | "audit"
  | "settings";

export interface NavigationItem {
  href: string;
  label: string;
  icon: NavigationIcon;
  /** Visible when the user has any of these capabilities. Empty means every signed-in user. */
  requiresAny: readonly Capability[];
  /** False until the module is delivered; the item is shown as not yet available. */
  available: boolean;
}

export interface NavigationSection {
  label: string;
  items: readonly NavigationItem[];
}

const NAVIGATION: readonly NavigationSection[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", requiresAny: [], available: true }],
  },
  {
    label: "My work",
    items: [
      { href: "/my-attendance", label: "My attendance", icon: "history", requiresAny: ["attendance.viewOwn"], available: true },
    ],
  },
  {
    label: "Attendance",
    items: [
      {
        href: "/attendance",
        label: "Attendance records",
        icon: "attendance",
        requiresAny: ["attendance.viewHospital", "attendance.viewDepartment"],
        available: true,
      },
      {
        href: "/corrections",
        label: "Corrections",
        icon: "corrections",
        requiresAny: ["corrections.review", "attendance.viewDepartment"],
        available: true,
      },
      { href: "/locations", label: "Terminals", icon: "terminals", requiresAny: ["locations.manage"], available: true },
    ],
  },
  {
    label: "Workforce",
    items: [
      { href: "/staff", label: "Staff", icon: "staff", requiresAny: ["staff.manage", "staff.viewDepartment"], available: true },
      { href: "/departments", label: "Departments", icon: "departments", requiresAny: ["departments.manage"], available: true },
      { href: "/shifts", label: "Shift templates", icon: "shifts", requiresAny: ["shifts.manage"], available: true },
      { href: "/roster", label: "Roster", icon: "roster", requiresAny: ["shifts.manage", "roster.viewDepartment"], available: true },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/reports", label: "Reports", icon: "reports", requiresAny: ["reports.view"], available: true },
      { href: "/audit-log", label: "Audit log", icon: "audit", requiresAny: ["audit.view"], available: true },
    ],
  },
  {
    label: "Administration",
    items: [{ href: "/settings", label: "Settings", icon: "settings", requiresAny: ["settings.manage"], available: true }],
  },
];

export function navigationFor(capabilities: ReadonlySet<Capability>): NavigationSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.requiresAny.length === 0 || item.requiresAny.some((capability) => capabilities.has(capability)),
    ),
  })).filter((section) => section.items.length > 0);
}

/** The most specific navigation href that contains the current path. */
export function activeNavigationHref(pathname: string, hrefs: readonly string[]): string | undefined {
  return hrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}
