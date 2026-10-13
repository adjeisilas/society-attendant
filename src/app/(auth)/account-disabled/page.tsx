import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth/actions";
import { AuthCard } from "@/features/auth/components/auth-card";
import { routes } from "@/lib/auth/routes";
import { getSessionState } from "@/lib/auth/session";
import styles from "./account-disabled.module.css";

export const metadata: Metadata = { title: "Account not active" };

export default async function AccountDisabledPage() {
  const session = await getSessionState();
  if (session.status === "signed_out") redirect(routes.signIn);
  if (session.status === "active") redirect(routes.home);

  return (
    <AuthCard title="Account not active">
      <div className={styles.content}>
        <Alert tone="warning">
          {session.email ? (
            <>
              The account <strong>{session.email}</strong> is not currently active.
            </>
          ) : (
            "This account is not currently active."
          )}{" "}
          Contact your hospital administrator or HR office if you believe this is a mistake.
        </Alert>
        <form action={signOut}>
          <Button type="submit" variant="secondary" fullWidth>
            Sign out
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
