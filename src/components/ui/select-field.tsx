"use client";

import type { ReactNode, Ref, SelectHTMLAttributes } from "react";
import { FormField } from "./form-field";
import styles from "./form-field.module.css";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  options: readonly SelectOption[];
  /** Adds an empty first option with this label. */
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

export function SelectField({ label, options, placeholder, hint, error, optional, className, ref, ...selectProps }: SelectFieldProps) {
  return (
    <FormField label={label} hint={hint} error={error} optional={optional} className={className}>
      {(control) => (
        <select {...selectProps} {...control} ref={ref} className={styles.select}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
