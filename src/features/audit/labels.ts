import type { BadgeTone } from "@/components/ui/badge";

export const ENTITY_LABELS: Record<string, string> = {
  hospitals: "Hospital",
  hospital_settings: "Hospital settings",
  profiles: "Account",
  departments: "Department",
  staff: "Staff record",
  shifts: "Shift template",
  shift_assignments: "Rostered shift",
  account_invitations: "Account invitation",
  attendance_locations: "Attendance location",
  attendance_terminals: "Attendance terminal",
  attendance_records: "Attendance record",
  attendance_corrections: "Attendance correction",
  // Removed modules, kept so their existing audit entries stay readable.
  attendance_qr_codes: "QR code",
  leave_types: "Leave type",
  leave_requests: "Leave request",
};

export const ACTION_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  insert: { label: "Created", tone: "success" },
  update: { label: "Changed", tone: "info" },
  delete: { label: "Deleted", tone: "danger" },
};

export function entityLabel(entityTable: string): string {
  return ENTITY_LABELS[entityTable] ?? entityTable;
}

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

/** Columns that change on every write and say nothing about intent. */
const NOISE = new Set(["updated_at", "created_at"]);

/**
 * The fields that actually changed between two audited snapshots, for a readable
 * summary instead of two blocks of JSON.
 */
export function changedFields(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): FieldChange[] {
  if (!oldData || !newData) return [];
  const changes: FieldChange[] = [];

  for (const key of Object.keys(newData)) {
    if (NOISE.has(key)) continue;
    const before = formatValue(oldData[key]);
    const after = formatValue(newData[key]);
    if (before !== after) changes.push({ field: humanizeField(key), from: before, to: after });
  }
  return changes;
}

function humanizeField(field: string): string {
  return field.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
