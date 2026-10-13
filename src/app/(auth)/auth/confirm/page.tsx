import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { AuthCard } from "@/features/auth/components/auth-card";
import { ConfirmEmailLinkForm } from "@/features/auth/components/confirm-email-link-form";
import { emailLinkSchema, type EmailLinkType } from "@/features/auth/schemas";
import { routes } from "@/lib/auth/routes";
import { firstSearchParam, type SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Confirm email link" };

const COPY: Record<EmailLinkType, { title: string; description: string; actionLabel: string }> = {
  invite: {
    title: "Activate your account",
    description: "Your hospital has invited you to the staff attendance system. Continue to choose your password.",
    actionLabel: "Continue",
  },
  recovery: {
    title: "Reset your password",
    description: "Continue to choose a new password for your account.",
    actionLabel: "Continue",
  },
};

export default async function ConfirmEmailLinkPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const link = emailLinkSchema.safeParse({
    tokenHash: firstSearchParam(params.token_hash),
    type: firstSearchParam(params.type),
  });

  if (!link.success) {
    return (
      <AuthCard title="Link not valid" footer={<Link href={routes.signIn}>Go to sign in</Link>}>
        <Alert tone="danger">
          This link is incomplete or not valid. Open the most recent email you received, or ask your hospital
          administrator for a new invitation.
        </Alert>
      </AuthCard>
    );
  }

  const copy = COPY[link.data.type];
  return (
    <AuthCard title={copy.title} description={copy.description}>
      <ConfirmEmailLinkForm tokenHash={link.data.tokenHash} type={link.data.type} actionLabel={copy.actionLabel} />
    </AuthCard>
  );
}
