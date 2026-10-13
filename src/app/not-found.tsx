import { FileQuestion } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";
import { routes } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <StatusPanel
      fullPage
      icon={<FileQuestion size={22} />}
      title="Page not found"
      description="The page does not exist, or your account does not have access to it."
    >
      <Link href={routes.home} className={buttonClassName({ variant: "secondary" })}>
        Go to dashboard
      </Link>
    </StatusPanel>
  );
}
