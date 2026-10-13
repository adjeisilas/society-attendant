"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { Alert } from "./alert";
import { Button } from "./button";
import styles from "./confirm-dialog.module.css";

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  dismissLabel?: string;
  tone?: "primary" | "danger";
  /** Performs the action. Resolves to an error message to show, or null on success. */
  onConfirm: () => Promise<string | null>;
  renderTrigger: (open: () => void) => ReactNode;
}

/** A modal confirmation built on the native dialog element (focus handling and Escape included). */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  dismissLabel = "Cancel",
  tone = "primary",
  onConfirm,
  renderTrigger,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const open = () => {
    setError(null);
    setIsOpen(true);
  };

  const confirm = () => {
    startTransition(async () => {
      const message = await onConfirm();
      if (message) setError(message);
      else setIsOpen(false);
    });
  };

  return (
    <>
      {renderTrigger(open)}
      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={() => setIsOpen(false)}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <div className={styles.description}>{description}</div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setIsOpen(false)} disabled={pending}>
            {dismissLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={confirm} loading={pending}>
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
