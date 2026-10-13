import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { countUnreadNotifications } from "@/features/notifications/queries";
import { roleLabel } from "@/lib/auth/permissions";
import { routes } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";
import { formatIsoDate, todayInTimeZone } from "@/lib/dates";
import { getWorkingHospital } from "@/lib/hospital-context";
import { navigationFor } from "@/lib/navigation";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await requireUser();
  // An account created with an administrator-set password chooses its own first.
  if (user.mustChangePassword) redirect(routes.setPassword);

  const [hospital, unreadNotifications] = await Promise.all([getWorkingHospital(user), countUnreadNotifications()]);
  const today = todayInTimeZone(hospital?.timezone ?? "UTC");

  return (
    <AppShell
      user={{
        displayName: user.displayName,
        roleLabel: roleLabel(user.access),
        contextLabel: hospital?.name ?? "Hospital not set up",
        todayLabel: formatIsoDate(today, "EEE d MMM yyyy"),
      }}
      navigation={navigationFor(user.capabilities)}
      unreadNotifications={unreadNotifications}
    >
      {children}
    </AppShell>
  );
}
