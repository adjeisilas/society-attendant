"use server";

import { requireUser } from "@/lib/auth/session";
import { actionFailure, actionSuccess, type ActionResult } from "@/lib/forms/action-result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACCEPTED_ATTACHMENT_TYPES, ATTACHMENTS_BUCKET, MAX_ATTACHMENT_BYTES } from "./constants";

export interface UploadedAttachment {
  path: string;
  fileName: string;
}

/**
 * Stores correction evidence (a photo or PDF) in the private bucket, under
 * {hospital_id}/{staff_id}/. The upload runs with the user's own session, so the
 * storage policies apply as well as these checks, and the name the browser supplied
 * is never used as a path.
 */
export async function uploadRequestAttachment(formData: FormData): Promise<ActionResult<UploadedAttachment>> {
  const user = await requireUser();
  if (!user.staff || !user.hospital) {
    return actionFailure("Attachments belong to a staff record. Contact your HR office.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return actionFailure("Choose a file to attach.");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return actionFailure("That file is larger than 6 MB. Attach a smaller photo or PDF.");
  }

  const extension = ACCEPTED_ATTACHMENT_TYPES[file.type];
  if (!extension) {
    return actionFailure("Attach a JPEG, PNG or WebP image, or a PDF.");
  }

  const path = `${user.hospital.id}/${user.staff.id}/${crypto.randomUUID()}.${extension}`;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    console.error("Attachment upload failed", { message: error.message });
    return actionFailure("The file could not be uploaded. Try again.");
  }

  return actionSuccess({ path, fileName: file.name });
}
