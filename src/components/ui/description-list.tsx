import type { ReactNode } from "react";
import styles from "./description-list.module.css";

export interface DescriptionItem {
  term: string;
  value: ReactNode;
}

export function DescriptionList({ items }: { items: readonly DescriptionItem[] }) {
  return (
    <dl className={styles.list}>
      {items.map((item) => (
        <div key={item.term} className={styles.item}>
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
