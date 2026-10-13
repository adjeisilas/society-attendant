import type { Metadata } from "next";
import { AuthCard } from "@/features/auth/components/auth-card";
import { SetPasswordForm } from "@/features/auth/components/set-password-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Set password" };

export default async function SetPasswordPage() {
  const user = await requireUser();

  return (
    <AuthCard
      title="Choose a password"
      description={
        user.mustChangePassword
          ? "Replace the password your administrator gave you with one only you know."
          : user.email
            ? `You will use this password to sign in as ${user.email}.`
            : undefined
      }
    >
      <SetPasswordForm />
    </AuthCard>
  );
}
