import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatTimestamp } from "@/lib/dates";
import type { TerminalSummary } from "../queries";
import { RevokeTerminalButton } from "./revoke-terminal-button";

interface TerminalTableProps {
  terminals: TerminalSummary[];
  timeZone: string;
  /** The terminal this browser is registered as, marked in the list. */
  currentTerminalId: string | null;
  showLocation?: boolean;
}

export function TerminalTable({ terminals, timeZone, currentTerminalId, showLocation = false }: TerminalTableProps) {
  return (
    <DataTable caption="Attendance terminals">
      <thead>
        <tr>
          <th scope="col">Terminal</th>
          {showLocation && <th scope="col">Location</th>}
          <th scope="col">Status</th>
          <th scope="col">Last clock-in</th>
          <th scope="col">Registered</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {terminals.map((terminal) => (
          <tr key={terminal.id}>
            <td>
              <strong>{terminal.name}</strong>
              {terminal.id === currentTerminalId && <div className="text-muted text-sm">This computer</div>}
            </td>
            {showLocation && (
              <td>
                <Link href={`/locations/${terminal.locationId}`}>{terminal.locationName}</Link>
              </td>
            )}
            <td>{terminal.revokedAt ? <Badge>Switched off</Badge> : <Badge tone="success">Active</Badge>}</td>
            <td className="tabular-nums">
              {terminal.lastUsedAt ? (
                formatTimestamp(terminal.lastUsedAt, timeZone)
              ) : (
                <span className="text-muted">Not used yet</span>
              )}
            </td>
            <td>
              <span className="tabular-nums">{formatTimestamp(terminal.createdAt, timeZone)}</span>
              {terminal.createdByName && <div className="text-muted text-sm">by {terminal.createdByName}</div>}
            </td>
            <td data-align="end">
              {!terminal.revokedAt && <RevokeTerminalButton terminalId={terminal.id} terminalName={terminal.name} />}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
