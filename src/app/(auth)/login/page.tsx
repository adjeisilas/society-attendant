import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/components/auth-card";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { routes, safeRedirectPath } from "@/lib/auth/routes";
import { getSessionState } from "@/lib/auth/session";
import { firstSearchParam, type SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const next = safeRedirectPath(firstSearchParam((await searchParams).next));

  const session = await getSessionState();
  if (session.status === "active") redirect(next);
  if (session.status === "inactive") redirect(routes.accountDisabled);

  return (
    <AuthCard
      title="Sign in"
      description="Use the email address registered with your hospital."
      footer="Don't have an account? Accounts are created by your hospital's HR office."
    >
      <SignInForm next={next} />
    </AuthCard>
  );
}
