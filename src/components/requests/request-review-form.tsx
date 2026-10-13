"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import layout from "@/components/ui/form-layout.module.css";
import { TextareaField } from "@/components/ui/textarea-field";
import type { ActionResult } from "@/lib/forms/action-result";
import { reviewSchema } from "@/features/corrections/schemas";

interface RequestReviewFormProps {
  requestId: string;
  /** Server action that decides the request. */
  review: (requestId: string, input: unknown) => Promise<ActionResult>;
  approveLabel?: string;
  rejectLabel?: string;
  hint?: string;
}

/** Approve or refuse a request. Refusing requires a note, which the database also enforces. */
export function RequestReviewForm({
  requestId,
  review,
  approveLabel = "Approve",
  rejectLabel = "Refuse",
  hint = "Shared with the person who made the request and recorded in the audit log.",
}: RequestReviewFormProps) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decide = (approve: boolean) => {
    const parsed = reviewSchema.safeParse({ approve, note });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the note and try again.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await review(requestId, { approve, note });
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <div className={layout.form}>
      {error && <Alert tone="danger">{error}</Alert>}
      <TextareaField
        label="Note"
        optional
        hint={hint}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className={layout.actions}>
        <Button variant="secondary" onClick={() => decide(false)} disabled={pending}>
          {rejectLabel}
        </Button>
        <Button onClick={() => decide(true)} loading={pending}>
          {approveLabel}
        </Button>
      </div>
    </div>
  );
}
