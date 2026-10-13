"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { dataError } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Marks the signed-in user's unread notifications as read (RLS limits this to their own).
 * Returns nothing, so it can be used directly as a form action.
 */
export async function markAllNotificationsRead(): Promise<void> {
  await requireUser();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) throw dataError("mark notifications as read", error);

  refresh();
}
