import type { BadgeTone } from "@/components/ui/badge";
import type { Enums } from "@/types/database";

export type StaffStatus = Enums<"staff_status">;
export type EmploymentType = Enums<"employment_type">;

export const STAFF_STATUS: Record<StaffStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  suspended: { label: "Suspended", tone: "warning" },
  terminated: { label: "Terminated", tone: "neutral" },
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  locum: "Locum",
  intern: "Intern",
};

export const ACCOUNT_ROLE_LABELS: Record<Enums<"app_role">, string> = {
  super_admin: "Super Admin",
  hospital_admin: "Hospital Admin",
  staff: "Staff",
};

export type AccountState = "none" | "invited" | "active" | "disabled" | "restricted";

export interface AccountFacts {
  userId: string | null;
  accountIsActive: boolean | null;
  accountActivatedAt: string | null;
}

/**
 * The sign-in account state as far as the viewer can see it. "restricted" means an
 * account exists but its profile is not visible to the viewer (for example a department head).
 */
export function accountStateOf({ userId, accountIsActive, accountActivatedAt }: AccountFacts): AccountState {
  if (!userId) return "none";
  if (accountIsActive === null) return "restricted";
  if (!accountIsActive) return "disabled";
  return accountActivatedAt ? "active" : "invited";
}

export const ACCOUNT_STATE: Record<AccountState, { label: string; tone: BadgeTone }> = {
  none: { label: "No account", tone: "neutral" },
  invited: { label: "Invited", tone: "info" },
  active: { label: "Active", tone: "success" },
  disabled: { label: "Disabled", tone: "danger" },
  restricted: { label: "Has account", tone: "neutral" },
};
