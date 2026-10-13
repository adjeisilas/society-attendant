import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { markAllNotificationsRead } from "@/features/notifications/actions";
import { NOTIFICATION_TYPE_LABELS } from "@/features/notifications/labels";
import { listNotifications } from "@/features/notifications/queries";
import { requireUser } from "@/lib/auth/session";
import { formatTimestamp } from "@/lib/dates";
import styles from "./notifications.module.css";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const notifications = await listNotifications();
  const timeZone = user.hospital?.timezone ?? "UTC";
  const unread = notifications.filter((notification) => notification.readAt === null).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread > 0 ? `${unread} unread` : "You are up to date."}
        actions={
          unread > 0 && (
            <form action={markAllNotificationsRead}>
              <Button type="submit" variant="secondary">
                Mark all as read
              </Button>
            </form>
          )
        }
      />
      <Panel flush>
        {notifications.length === 0 ? (
          <EmptyState
            icon={<Bell size={20} />}
            title="No notifications"
            description="Attendance corrections and their decisions appear here."
          />
        ) : (
          <ul className={styles.list}>
            {notifications.map((notification) => (
              <li key={notification.id} className={styles.item} data-unread={notification.readAt === null}>
                <div className={styles.heading}>
                  <Badge tone={notification.readAt === null ? "info" : "neutral"}>
                    {NOTIFICATION_TYPE_LABELS[notification.type]}
                  </Badge>
                  <span className="text-muted text-sm">{formatTimestamp(notification.createdAt, timeZone)}</span>
                </div>
                <p className={styles.title}>
                  {notification.linkPath ? (
                    <Link href={notification.linkPath}>{notification.title}</Link>
                  ) : (
                    notification.title
                  )}
                </p>
                {notification.body && <p className="text-muted">{notification.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
