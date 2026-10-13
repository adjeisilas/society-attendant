import type { ReactNode } from "react";
import styles from "./data-table.module.css";

/**
 * A readable, horizontally scrollable table. Compose with thead/tbody; set
 * data-align="end" on numeric th/td cells.
 */
export function DataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
