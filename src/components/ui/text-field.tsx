"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { cx } from "@/lib/class-names";
import { FormField } from "./form-field";
import styles from "./form-field.module.css";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, hint, error, optional, type = "text", className, ref, ...inputProps }: TextFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";

  return (
    <FormField label={label} hint={hint} error={error} optional={optional} className={className}>
      {(control) => (
        <div className={styles.control}>
          <input
            {...inputProps}
            {...control}
            ref={ref}
            type={isPassword && revealed ? "text" : type}
            className={cx(styles.input, isPassword && styles.inputWithAction)}
          />
          {isPassword && (
            <button
              type="button"
              className={styles.action}
              onClick={() => setRevealed((value) => !value)}
              aria-label={revealed ? "Hide password" : "Show password"}
              aria-pressed={revealed}
            >
              {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          )}
        </div>
      )}
    </FormField>
  );
}
