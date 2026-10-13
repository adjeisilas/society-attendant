import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
import { routes } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email address and we will send you a link to choose a new password."
      footer={<Link href={routes.signIn}>Back to sign in</Link>}
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
