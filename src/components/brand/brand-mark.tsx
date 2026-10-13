import styles from "./brand-mark.module.css";

/** A clock face whose hands form a tick: the time, recorded. */
export function BrandMark({ tone = "light", size = "md" }: { tone?: "light" | "dark"; size?: "md" | "lg" }) {
  const iconSize = size === "lg" ? 28 : 20;
  return (
    <span className={`${styles.mark} ${styles[tone]} ${styles[size]}`} aria-hidden="true">
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.75" strokeWidth="2" />
        <path d="M12 3.25v2" strokeWidth="2" />
        <path d="m8.4 12.3 2.5 2.4 4.8-5.2" strokeWidth="2.4" />
      </svg>
    </span>
  );
}
