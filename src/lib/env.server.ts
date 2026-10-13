import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let serverEnv: ServerEnv | undefined;

/** Secret configuration. Never import this module from client code. */
export function getServerEnv(): ServerEnv {
  if (!serverEnv) {
    const result = serverEnvSchema.safeParse({ SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY });
    if (!result.success) {
      throw new Error(`Invalid server environment configuration:\n${z.prettifyError(result.error)}`);
    }
    serverEnv = result.data;
  }
  return serverEnv;
}
