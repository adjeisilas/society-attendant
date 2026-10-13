import type { ReactNode } from "react";
import styles from "./auth-card.module.css";

interface AuthCardProps {
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function AuthCard({ title, description, footer, children }: AuthCardProps) {
  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </header>
      {children}
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  );
}
