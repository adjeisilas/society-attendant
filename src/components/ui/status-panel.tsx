import type { ReactNode } from "react";
import { Spinner } from "./spinner";
import styles from "./status-panel.module.css";

interface StatusPanelProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  tone?: "neutral" | "danger" | "warning";
  /** Centers the panel in the viewport, for pages rendered outside the app shell. */
  fullPage?: boolean;
  children?: ReactNode;
}

/** Empty, error and not-found states. */
export function StatusPanel({ icon, title, description, tone = "neutral", fullPage = false, children }: StatusPanelProps) {
  // Inside the app shell the page may already have an h1.
  const Heading = fullPage ? "h1" : "h2";
  const panel = (
    <section className={styles.panel}>
      <div className={`${styles.icon} ${styles[tone]}`} aria-hidden="true">
        {icon}
      </div>
      <Heading className={styles.title}>{title}</Heading>
      {description && <p className={styles.description}>{description}</p>}
      {children && <div className={styles.actions}>{children}</div>}
    </section>
  );

  return fullPage ? <main className={styles.fullPage}>{panel}</main> : panel;
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <Spinner size={20} />
      <span>{label}</span>
    </div>
  );
}
