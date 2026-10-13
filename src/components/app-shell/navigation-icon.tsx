import {
  Building2,
  CalendarClock,
  ChartColumn,
  ClipboardCheck,
  Clock,
  FilePenLine,
  History,
  LayoutDashboard,
  MonitorSmartphone,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import type { NavigationIcon as NavigationIconName } from "@/lib/navigation";

const ICONS: Record<NavigationIconName, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  history: History,
  staff: Users,
  departments: Building2,
  shifts: Clock,
  roster: CalendarClock,
  attendance: ClipboardCheck,
  corrections: FilePenLine,
  terminals: MonitorSmartphone,
  reports: ChartColumn,
  audit: ScrollText,
  settings: Settings,
};

export function NavigationIcon({ name }: { name: NavigationIconName }) {
  const Icon = ICONS[name];
  return <Icon size={18} strokeWidth={1.9} aria-hidden="true" />;
}
