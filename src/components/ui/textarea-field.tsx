"use client";

import type { ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { FormField } from "./form-field";
import styles from "./form-field.module.css";

interface TextareaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextareaField({ label, hint, error, optional, className, rows = 3, ref, ...textareaProps }: TextareaFieldProps) {
  return (
    <FormField label={label} hint={hint} error={error} optional={optional} className={className}>
      {(control) => <textarea {...textareaProps} {...control} ref={ref} rows={rows} className={styles.textarea} />}
    </FormField>
  );
}
