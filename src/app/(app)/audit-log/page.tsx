import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { SelectField } from "@/components/ui/select-field";
import { ACTION_LABELS, changedFields, entityLabel } from "@/features/audit/labels";
import { listAuditEntries } from "@/features/audit/queries";
import { AUDIT_PAGE_SIZE, AUDITED_TABLES, auditFiltersSchema } from "@/features/audit/schemas";
import { formatTimestamp } from "@/lib/dates";
import { requireHospitalScope } from "@/lib/hospital-context";
import { firstSearchParam, toQueryString, type SearchParams } from "@/lib/search-params";
import styles from "./audit-log.module.css";

export const metadata: Metadata = { title: "Audit log" };

const ENTITY_OPTIONS = [
  { value: "all", label: "All records" },
  ...AUDITED_TABLES.map((table) => ({ value: table, label: entityLabel(table) })),
];

const ACTION_OPTIONS = [
  { value: "all", label: "All changes" },
  { value: "insert", label: "Created" },
  { value: "update", label: "Changed" },
  { value: "delete", label: "Deleted" },
];

export default async function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  const { hospital } = await requireHospitalScope("audit.view");
  if (!hospital) return <NoHospitalState />;

  const params = await searchParams;
  const filters = auditFiltersSchema.parse({
    entity: firstSearchParam(params.entity),
    action: firstSearchParam(params.action),
    page: firstSearchParam(params.page),
  });
  const { entries, total } = await listAuditEntries(hospital.id, filters);

  return (
    <>
      <PageHeader
        title="Audit log"
        description={`Every change to ${hospital.name}'s records, with who made it and why. Entries cannot be edited or deleted.`}
      />
      <Panel flush>
        <FilterBar resetHref="/audit-log">
          <SelectField name="entity" label="Record type" options={ENTITY_OPTIONS} defaultValue={filters.entity} />
          <SelectField name="action" label="Change" options={ACTION_OPTIONS} defaultValue={filters.action} />
        </FilterBar>

        {entries.length === 0 ? (
          <EmptyState
            icon={<ScrollText size={20} />}
            title="No entries"
            description="Changes to staff, attendance, rosters and settings are recorded here."
          />
        ) : (
          <>
            <DataTable caption="Audit log">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Record</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const action = ACTION_LABELS[entry.action] ?? { label: entry.action, tone: "neutral" as const };
                  const changes = changedFields(entry.oldData, entry.newData);
                  return (
                    <tr key={entry.id}>
                      <td className="tabular-nums">{formatTimestamp(entry.createdAt, hospital.timezone)}</td>
                      <td>
                        {entry.actorName ?? <span className="text-muted">System</span>}
                        {entry.actorRole && <div className="text-muted text-sm">{entry.actorRole.replaceAll("_", " ")}</div>}
                        {entry.source && <div className="text-muted text-sm">{entry.source.replaceAll("_", " ")}</div>}
                      </td>
                      <td>
                        <Badge tone={action.tone}>{action.label}</Badge>
                        <div>{entityLabel(entry.entityTable)}</div>
                      </td>
                      <td>
                        {entry.reason && <p className={styles.reason}>{entry.reason}</p>}
                        {changes.length > 0 ? (
                          <ul className={styles.changes}>
                            {changes.slice(0, 6).map((change) => (
                              <li key={change.field}>
                                <span className="text-muted">{change.field}:</span> {change.from} → {change.to}
                              </li>
                            ))}
                            {changes.length > 6 && <li className="text-muted">and {changes.length - 6} more fields</li>}
                          </ul>
                        ) : (
                          !entry.reason && <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
            <div className={styles.footer}>
              <Pagination
                page={filters.page}
                pageSize={AUDIT_PAGE_SIZE}
                total={total}
                hrefForPage={(next) =>
                  `/audit-log${toQueryString({ entity: filters.entity, action: filters.action, page: next })}`
                }
                itemLabel="entries"
              />
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
