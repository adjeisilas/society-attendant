import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "@/lib/class-names";
import styles from "./form-field.module.css";

interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function CheckboxField({ label, className, ref, ...inputProps }: CheckboxFieldProps) {
  return (
    <label className={cx(styles.checkbox, className)}>
      <input {...inputProps} ref={ref} type="checkbox" />
      <span>{label}</span>
    </label>
  );
}
