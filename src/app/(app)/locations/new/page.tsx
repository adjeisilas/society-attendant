import type { Metadata } from "next";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import layout from "@/components/ui/form-layout.module.css";
import { Panel } from "@/components/ui/panel";
import { LocationForm } from "@/features/locations/components/location-form";
import { requireHospitalScope } from "@/lib/hospital-context";

export const metadata: Metadata = { title: "New attendance location" };

export default async function NewLocationPage() {
  const { hospital } = await requireHospitalScope("locations.manage");
  if (!hospital) return <NoHospitalState />;

  return (
    <div className={layout.narrow}>
      <PageHeader
        title="New location"
        description={`A place at ${hospital.name} where terminals stand, such as an entrance or a department desk.`}
        back={{ href: "/locations", label: "Terminals" }}
      />
      <Panel>
        <LocationForm defaultValues={{ name: "", description: "", isActive: true }} />
      </Panel>
    </div>
  );
}
