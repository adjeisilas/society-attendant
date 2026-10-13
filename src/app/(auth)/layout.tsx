import { Clock3, MonitorSmartphone, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import styles from "./auth-layout.module.css";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={styles.page}>
      <div className={styles.formSide}>
        <div className={styles.formBrand}>
          <BrandMark />
          <span className={styles.formBrandName}>Staff Attendance</span>
        </div>

        <main className={styles.main}>{children}</main>

        <p className={styles.formFooter}>Access is restricted to authorised hospital personnel. Activity is recorded.</p>
      </div>

      <aside className={styles.hero}>
        <div className={styles.dial} aria-hidden="true">
          <span className={styles.dialHourHand} />
          <span className={styles.dialMinuteHand} />
          <span className={styles.dialHub} />
        </div>

        <div className={styles.heroBody}>
          <p className={styles.heroEyebrow}>Hospital time &amp; attendance</p>
          <h2 className={styles.heroTitle}>Every shift, clocked in and out.</h2>
          <ul className={styles.heroPoints}>
            <li>
              <span className={styles.heroPointIcon}>
                <MonitorSmartphone size={18} aria-hidden="true" />
              </span>
              Staff clock in at attendance terminals with their own sign-in.
            </li>
            <li>
              <span className={styles.heroPointIcon}>
                <Clock3 size={18} aria-hidden="true" />
              </span>
              Lateness, overtime and absences are worked out from the roster.
            </li>
            <li>
              <span className={styles.heroPointIcon}>
                <ShieldCheck size={18} aria-hidden="true" />
              </span>
              Every change is recorded in the audit log.
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
