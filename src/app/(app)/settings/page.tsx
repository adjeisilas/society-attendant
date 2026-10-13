import { Settings as SettingsIcon } from "lucide-react";
import type { Metadata } from "next";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { DescriptionList } from "@/components/ui/description-list";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { StatusPanel } from "@/components/ui/status-panel";
import { HospitalForm } from "@/features/hospitals/components/hospital-form";
import { getHospital, timeZoneOptions } from "@/features/hospitals/queries";
import { SettingsForm } from "@/features/settings/components/settings-form";
import { getHospitalSettings } from "@/features/settings/queries";
import { requireHospitalScope } from "@/lib/hospital-context";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, hospital } = await requireHospitalScope("settings.manage");
  if (!hospital) return <NoHospitalState />;

  const canEditHospital = user.capabilities.has("hospitals.manage");
  const [settings, details] = await Promise.all([
    getHospitalSettings(hospital.id),
    canEditHospital ? getHospital(hospital.id) : Promise.resolve(null),
  ]);
  if (!settings) {
    return (
      <StatusPanel
        icon={<SettingsIcon size={22} />}
        title="Settings unavailable"
        description="The hospital has no settings record. Contact a super admin."
      />
    );
  }

  return (
    <div className={layout.narrow}>
      <PageHeader title="Settings" description={`How clock-ins are recorded at ${hospital.name}.`} />

      <div className={layout.stack}>
        {details ? (
          <Panel title="Hospital details">
            <HospitalForm
              hospitalId={details.id}
              defaultValues={{
                name: details.name,
                code: details.code,
                timezone: details.timezone,
                address: details.address ?? "",
                phone: details.phone ?? "",
                email: details.email ?? "",
              }}
              timeZoneOptions={timeZoneOptions(details.timezone)}
            />
          </Panel>
        ) : (
          <Panel title="Hospital" description="A super admin changes these details." flush>
            <DescriptionList
              items={[
                { term: "Name", value: hospital.name },
                { term: "Code", value: hospital.code },
                { term: "Time zone", value: hospital.timezone.replaceAll("_", " ") },
              ]}
            />
          </Panel>
        )}

        <Panel title="Attendance rules">
          <SettingsForm
            defaultValues={{
              allowUnscheduledCheckIn: settings.allowUnscheduledCheckIn,
              minSessionMinutes: settings.minSessionMinutes,
              checkOutWindowMinutes: settings.checkOutWindowMinutes,
              halfDayThresholdPercent: settings.halfDayThresholdPercent,
            }}
          />
        </Panel>
      </div>
    </div>
  );
}
