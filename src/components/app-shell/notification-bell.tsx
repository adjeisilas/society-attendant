import { Bell } from "lucide-react";
import Link from "next/link";
import styles from "./notification-bell.module.css";

export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";

  return (
    <Link href="/notifications" className={styles.bell} aria-label={label}>
      <Bell size={18} aria-hidden="true" />
      {unreadCount > 0 && (
        <span className={styles.count} aria-hidden="true">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
