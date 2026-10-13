"use client";

import { Paperclip, X } from "lucide-react";
import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import fieldStyles from "@/components/ui/form-field.module.css";
import { uploadRequestAttachment } from "../actions";
import { ACCEPTED_ATTACHMENT_ACCEPT } from "../constants";
import styles from "./attachment-field.module.css";

interface AttachmentFieldProps {
  label: string;
  hint?: string;
  /** Receives the stored path, or null when the attachment is removed. */
  onChange: (path: string | null) => void;
}

export function AttachmentField({ label, hint, onChange }: AttachmentFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<{ path: string; fileName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    startTransition(async () => {
      const result = await uploadRequestAttachment(formData);
      if (result.ok) {
        setAttached(result.data);
        onChange(result.data.path);
      } else {
        setError(result.message);
        onChange(null);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  const remove = () => {
    setAttached(null);
    setError(null);
    onChange(null);
  };

  return (
    <div className={fieldStyles.field}>
      <span className={fieldStyles.label}>
        {label}
        <span className={fieldStyles.optional}> (optional)</span>
      </span>

      {error && <Alert tone="danger">{error}</Alert>}

      {attached ? (
        <p className={styles.attached}>
          <Paperclip size={16} aria-hidden="true" />
          <span className={styles.fileName}>{attached.fileName}</span>
          <Button variant="ghost" size="sm" onClick={remove}>
            <X size={14} aria-hidden="true" />
            Remove
          </Button>
        </p>
      ) : (
        <input
          ref={inputRef}
          type="file"
          className={styles.input}
          accept={ACCEPTED_ATTACHMENT_ACCEPT}
          onChange={upload}
          disabled={pending}
          aria-label={label}
        />
      )}

      <p className={fieldStyles.hint}>{hint ?? "A photo or PDF, up to 6 MB."}</p>
    </div>
  );
}
