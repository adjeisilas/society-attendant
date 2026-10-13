"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { verifyEmailLink } from "../actions";
import type { EmailLinkType } from "../schemas";
import styles from "./auth-form.module.css";

interface ConfirmEmailLinkFormProps {
  tokenHash: string;
  type: EmailLinkType;
  actionLabel: string;
}

/**
 * Links are verified only after an explicit click. Email security scanners open links
 * automatically, and verifying on page load would use up the one-time token.
 */
export function ConfirmEmailLinkForm({ tokenHash, type, actionLabel }: ConfirmEmailLinkFormProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    startTransition(async () => {
      const result = await verifyEmailLink({ tokenHash, type });
      if (result?.ok === false) setError(result.message);
    });
  };

  return (
    <div className={styles.form}>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button fullWidth loading={pending} onClick={confirm}>
        {actionLabel}
      </Button>
    </div>
  );
}
