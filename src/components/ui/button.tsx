import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/class-names";
import { Spinner } from "./spinner";
import styles from "./button.module.css";

type ButtonVariant = "primary" | "success" | "dark" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/** Button styling for elements that are not buttons, such as links. */
export function buttonClassName({ variant = "primary", size = "md", fullWidth = false }: ButtonStyleOptions = {}): string {
  return cx(styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleOptions {
  loading?: boolean;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  disabled,
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(buttonClassName({ variant, size, fullWidth }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
