import type { ReactNode } from "react";
import { cx } from "@/lib/class-names";
import styles from "./panel.module.css";

interface PanelProps {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /** Removes body padding, for tables and lists that run edge to edge. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, description, actions, footer, flush = false, className, children }: PanelProps) {
  return (
    <section className={cx(styles.panel, className)} aria-label={title}>
      {(title || actions) && (
        <header className={styles.header}>
          <div className={styles.heading}>
            {title && <h2 className={styles.title}>{title}</h2>}
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={flush ? undefined : styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  );
}
