import { MapPin, MonitorSmartphone, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { ActiveStatusBadge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { listAttendanceLocations } from "@/features/locations/queries";
import { TerminalTable } from "@/features/terminals/components/terminal-table";
import { getCurrentTerminal, listTerminals } from "@/features/terminals/queries";
import { routes } from "@/lib/auth/routes";
import { formatTimestamp } from "@/lib/dates";
import { requireHospitalScope } from "@/lib/hospital-context";

export const metadata: Metadata = { title: "Terminals" };

export default async function LocationsPage() {
  const { hospital } = await requireHospitalScope("locations.manage");
  if (!hospital) return <NoHospitalState />;

  const [locations, terminals, currentTerminal] = await Promise.all([
    listAttendanceLocations(hospital.id),
    listTerminals(hospital.id),
    getCurrentTerminal(),
  ]);
  const activeTerminals = terminals.filter((terminal) => !terminal.revokedAt);

  const newLocationLink = (
    <Link href="/locations/new" className={buttonClassName()}>
      <Plus size={16} aria-hidden="true" />
      New location
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Terminals"
        description="Computers where staff clock in and out, grouped by the location they stand in."
        actions={
          <>
            <Link href={routes.terminal} className={buttonClassName({ variant: "secondary" })} prefetch={false}>
              <MonitorSmartphone size={16} aria-hidden="true" />
              Open clock-in screen
            </Link>
            {locations.length > 0 && newLocationLink}
          </>
        }
      />

      <div className={layout.stack}>
        <Panel title="Locations" description="Register a terminal from a location's page, on the computer itself." flush>
          {locations.length === 0 ? (
            <EmptyState
              icon={<MapPin size={22} />}
              title="No locations yet"
              description="Create a location such as the main staff entrance, then register the computers that stand there."
              action={newLocationLink}
            />
          ) : (
            <DataTable caption="Attendance locations">
              <thead>
                <tr>
                  <th scope="col">Location</th>
                  <th scope="col" data-align="end">
                    Active terminals
                  </th>
                  <th scope="col">Last clock-in</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => {
                  const here = activeTerminals.filter((terminal) => terminal.locationId === location.id);
                  const lastUsed = here
                    .map((terminal) => terminal.lastUsedAt)
                    .filter((value): value is string => value !== null)
                    .sort()
                    .at(-1);
                  return (
                    <tr key={location.id}>
                      <td>
                        <Link href={`/locations/${location.id}`}>
                          <strong>{location.name}</strong>
                        </Link>
                        {location.description && <div className="text-muted text-sm">{location.description}</div>}
                      </td>
                      <td data-align="end">{here.length}</td>
                      <td className="tabular-nums">
                        {lastUsed ? formatTimestamp(lastUsed, hospital.timezone) : <span className="text-muted">—</span>}
                      </td>
                      <td>
                        <ActiveStatusBadge active={location.isActive} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </Panel>

        {terminals.length > 0 && (
          <Panel title="All terminals" flush>
            <TerminalTable
              terminals={terminals}
              timeZone={hospital.timezone}
              currentTerminalId={currentTerminal?.id ?? null}
              showLocation
            />
          </Panel>
        )}
      </div>
    </>
  );
}
