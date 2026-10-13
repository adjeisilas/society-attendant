import type { Enums } from "@/types/database";

export type NotificationType = Enums<"notification_type">;

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  correction_submitted: "Attendance correction",
  correction_reviewed: "Correction decision",
};
