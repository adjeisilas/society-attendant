import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let publicEnv: PublicEnv | undefined;

/**
 * Validated browser-safe configuration. Read lazily so the app can be built without
 * credentials; a misconfigured deployment fails on its first request.
 */
export function getPublicEnv(): PublicEnv {
  if (!publicEnv) {
    // NEXT_PUBLIC_* values must be referenced explicitly to be inlined by Next.js.
    const result = publicEnvSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    if (!result.success) {
      throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
    }
    publicEnv = result.data;
  }
  return publicEnv;
}
