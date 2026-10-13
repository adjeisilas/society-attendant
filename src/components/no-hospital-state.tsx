import { Hospital } from "lucide-react";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";
import { routes } from "@/lib/auth/routes";

/** Shown to super admins on hospital pages before the hospital has been set up. */
export function NoHospitalState() {
  return (
    <StatusPanel
      icon={<Hospital size={22} />}
      title="The hospital is not set up yet"
      description="Enter the hospital's details once. Departments, staff, shifts and terminals are added after that."
    >
      <Link href={routes.setup} className={buttonClassName()}>
        Set up the hospital
      </Link>
    </StatusPanel>
  );
}
