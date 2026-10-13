import { MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { ActiveStatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { LocationForm } from "@/features/locations/components/location-form";
import { getAttendanceLocation } from "@/features/locations/queries";
import { RegisterTerminalForm } from "@/features/terminals/components/register-terminal-form";
import { TerminalTable } from "@/features/terminals/components/terminal-table";
import { getCurrentTerminal, listTerminals } from "@/features/terminals/queries";
import { requireHospitalScope } from "@/lib/hospital-context";
import { isRecordId } from "@/lib/validation";
import styles from "../locations.module.css";

export const metadata: Metadata = { title: "Attendance location" };

export default async function LocationPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params;
  const { hospital } = await requireHospitalScope("locations.manage");
  if (!hospital) return <NoHospitalState />;
  if (!isRecordId(locationId)) notFound();

  const location = await getAttendanceLocation(hospital.id, locationId);
  if (!location) notFound();

  const [terminals, currentTerminal] = await Promise.all([listTerminals(hospital.id, location.id), getCurrentTerminal()]);

  return (
    <>
      <PageHeader
        title={location.name}
        meta={<ActiveStatusBadge active={location.isActive} />}
        description={location.description ?? undefined}
        back={{ href: "/locations", label: "Terminals" }}
      />
      <div className={styles.layout}>
        <div className={styles.column}>
          <Panel title="Terminals here" flush>
            {terminals.length === 0 ? (
              <EmptyState
                icon={<MonitorSmartphone size={22} />}
                title="No terminals at this location"
                description="Open this page on the computer staff will use, then register it."
              />
            ) : (
              <TerminalTable terminals={terminals} timeZone={hospital.timezone} currentTerminalId={currentTerminal?.id ?? null} />
            )}
          </Panel>

          <Panel title="Location details">
            <LocationForm
              locationId={location.id}
              defaultValues={{ name: location.name, description: location.description ?? "", isActive: location.isActive }}
            />
          </Panel>
        </div>

        <Panel
          title="Register this computer"
          description="Do this on the computer at this location. Staff then sign in on it with their own staff ID or email and password."
        >
          <RegisterTerminalForm
            locationId={location.id}
            locationIsActive={location.isActive}
            currentTerminalName={currentTerminal?.name ?? null}
          />
        </Panel>
      </div>
    </>
  );
}
