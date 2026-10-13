import { Hospital } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header/page-header";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { StatusPanel } from "@/components/ui/status-panel";
import { HospitalForm } from "@/features/hospitals/components/hospital-form";
import { hospitalRecordExists, timeZoneOptions } from "@/features/hospitals/queries";
import { requireCapability } from "@/lib/auth/session";
import { getWorkingHospital } from "@/lib/hospital-context";

export const metadata: Metadata = { title: "Set up the hospital" };

/** First-time setup. Once the hospital exists, its details are edited in Settings. */
export default async function SetupPage() {
  const user = await requireCapability("hospitals.manage");
  if (await getWorkingHospital(user)) redirect("/settings");

  if (await hospitalRecordExists()) {
    return (
      <StatusPanel
        icon={<Hospital size={22} />}
        tone="warning"
        title="The hospital is deactivated"
        description="A hospital record exists but is switched off, so nobody can use it. Reactivate it in the database (hospitals.is_active) to continue."
      />
    );
  }

  return (
    <div className={layout.narrow}>
      <PageHeader
        title="Set up the hospital"
        description="This system serves one hospital. Enter its details once; you can change them later in Settings."
      />
      <Panel>
        <HospitalForm
          defaultValues={{ name: "", code: "", timezone: "", address: "", phone: "", email: "" }}
          timeZoneOptions={timeZoneOptions()}
        />
      </Panel>
    </div>
  );
}
