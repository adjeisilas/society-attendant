import "server-only";
import { dataError, isRangeNotSatisfiable, required } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUDIT_PAGE_SIZE, type AuditFilters } from "./schemas";

export interface AuditEntry {
  id: number;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entityTable: string;
  entityId: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  reason: string | null;
  source: string | null;
  createdAt: string;
}

const COLUMNS = "id, actor_name, actor_role, action, entity_table, entity_id, old_data, new_data, reason, context, created_at";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export async function listAuditEntries(
  hospitalId: string,
  filters: AuditFilters,
): Promise<{ entries: AuditEntry[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("audit_log_entries").select(COLUMNS, { count: "exact" }).eq("hospital_id", hospitalId);
  if (filters.entity !== "all") query = query.eq("entity_table", filters.entity);
  if (filters.action !== "all") query = query.eq("action", filters.action);

  const from = (filters.page - 1) * AUDIT_PAGE_SIZE;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + AUDIT_PAGE_SIZE - 1);

  if (error && isRangeNotSatisfiable(error)) return { entries: [], total: 0 };
  if (error) throw dataError("load the audit log", error);

  const entries = data.map((row) => {
    const context = asRecord(row.context);
    return {
      id: required(row.id, "id"),
      actorName: row.actor_name,
      actorRole: row.actor_role,
      action: required(row.action, "action"),
      entityTable: required(row.entity_table, "entity_table"),
      entityId: row.entity_id,
      oldData: asRecord(row.old_data),
      newData: asRecord(row.new_data),
      reason: row.reason,
      source: typeof context?.source === "string" ? context.source : null,
      createdAt: required(row.created_at, "created_at"),
    };
  });

  return { entries, total: count ?? entries.length };
}
