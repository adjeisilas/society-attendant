import { z } from "zod";

export const AUDIT_PAGE_SIZE = 50;

/** Tables the audit trigger watches. Filtering is limited to these. */
export const AUDITED_TABLES = [
  "hospitals",
  "hospital_settings",
  "profiles",
  "departments",
  "staff",
  "shifts",
  "shift_assignments",
  "account_invitations",
  "attendance_locations",
  "attendance_terminals",
  "attendance_records",
  "attendance_corrections",
] as const;

export const auditFiltersSchema = z.object({
  entity: z.enum(["all", ...AUDITED_TABLES]).catch("all"),
  action: z.enum(["all", "insert", "update", "delete"]).catch("all"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type AuditFilters = z.output<typeof auditFiltersSchema>;
