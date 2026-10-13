import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET } from "./constants";

const LINK_LIFETIME_SECONDS = 300;

/**
 * A short-lived link to an attachment. Storage policies decide whether the caller may
 * read it, so a link is only issued to someone already allowed to see the file.
 */
export async function createAttachmentUrl(path: string | null): Promise<string | null> {
  if (!path) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, LINK_LIFETIME_SECONDS);
  if (error) {
    console.error("Could not sign attachment URL", { message: error.message });
    return null;
  }
  return data.signedUrl;
}
