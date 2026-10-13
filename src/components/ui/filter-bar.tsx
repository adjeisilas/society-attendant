import Link from "next/link";
import type { ReactNode } from "react";
import { Button, buttonClassName } from "./button";
import styles from "./filter-bar.module.css";

interface FilterBarProps {
  /** Filter controls; each needs a `name` so its value is sent in the query string. */
  children: ReactNode;
  resetHref?: string;
  submitLabel?: string;
}

/** Filters submitted as a GET request, so filtered views are shareable URLs. */
export function FilterBar({ children, resetHref, submitLabel = "Apply" }: FilterBarProps) {
  return (
    <form method="get" className={styles.bar} role="search">
      <div className={styles.fields}>{children}</div>
      <div className={styles.actions}>
        <Button type="submit" variant="secondary">
          {submitLabel}
        </Button>
        {resetHref && (
          <Link href={resetHref} className={buttonClassName({ variant: "ghost" })}>
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}
