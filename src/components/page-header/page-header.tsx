import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./page-header.module.css";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Shown beside the title, for example a status badge. */
  meta?: ReactNode;
}

export function PageHeader({ title, description, actions, back, meta }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.heading}>
        {back && (
          <Link href={back.href} className={styles.back}>
            <ChevronLeft size={16} aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {meta}
        </div>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
