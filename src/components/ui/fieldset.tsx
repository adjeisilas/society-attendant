import type { ReactNode } from "react";
import { cx } from "@/lib/class-names";
import styles from "./form-field.module.css";

interface FieldsetProps {
  legend: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}

/** Groups related controls, such as a set of checkboxes, under one label. */
export function Fieldset({ legend, hint, error, className, children }: FieldsetProps) {
  return (
    <fieldset className={cx(styles.fieldset, className)}>
      <legend className={styles.legend}>{legend}</legend>
      {hint && <p className={styles.hint}>{hint}</p>}
      {children}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
