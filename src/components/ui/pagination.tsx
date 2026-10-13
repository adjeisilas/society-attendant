import Link from "next/link";
import { cx } from "@/lib/class-names";
import { buttonClassName } from "./button";
import styles from "./pagination.module.css";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  hrefForPage: (page: number) => string;
  itemLabel?: string;
}

export function Pagination({ page, pageSize, total, hrefForPage, itemLabel = "results" }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const linkClass = buttonClassName({ variant: "secondary", size: "sm" });

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <p className={styles.summary}>
        {total === 0 || first > total ? `No ${itemLabel} on this page` : `Showing ${first}–${last} of ${total} ${itemLabel}`}
      </p>
      <div className={styles.controls}>
        {page > 1 ? (
          <Link href={hrefForPage(Math.min(page - 1, pageCount))} className={linkClass}>
            Previous
          </Link>
        ) : (
          <span className={cx(linkClass, styles.disabled)} aria-disabled="true">
            Previous
          </span>
        )}
        <span className={styles.position}>
          Page {Math.min(page, pageCount)} of {pageCount}
        </span>
        {page < pageCount ? (
          <Link href={hrefForPage(page + 1)} className={linkClass}>
            Next
          </Link>
        ) : (
          <span className={cx(linkClass, styles.disabled)} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
