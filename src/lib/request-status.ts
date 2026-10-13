import type { BadgeTone } from "@/components/ui/badge";
import type { Enums } from "@/types/database";

export type RequestStatus = Enums<"request_status">;

/** The lifecycle of an attendance correction request. */
export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: "Awaiting review", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Not approved", tone: "danger" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};
