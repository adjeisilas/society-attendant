/**
 * Shared attachment settings. These live outside the "use server" module, which may
 * only export async functions.
 */
export const ATTACHMENTS_BUCKET = "request-attachments";

export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

/** Accepted content types, and the extension each is stored with. */
export const ACCEPTED_ATTACHMENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const ACCEPTED_ATTACHMENT_ACCEPT = Object.keys(ACCEPTED_ATTACHMENT_TYPES).join(",");
