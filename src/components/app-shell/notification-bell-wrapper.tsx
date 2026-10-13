"use client";

import { NotificationBell } from "./notification-bell";

/** Lets the client-side shell render the (server-safe) bell. */
export function NavigationBell({ unreadCount }: { unreadCount: number }) {
  return <NotificationBell unreadCount={unreadCount} />;
}
