"use client";

import { useSyncExternalStore } from "react";
import styles from "./terminal.module.css";

function subscribe(onTick: () => void): () => void {
  const interval = window.setInterval(onTick, 1000);
  return () => window.clearInterval(interval);
}

/** Whole seconds, so the snapshot only changes once per tick. */
function currentSecond(): number {
  return Math.floor(Date.now() / 1000);
}

/** Nothing on the server: the time is filled in once the page is running in the browser. */
function noSecondOnServer(): null {
  return null;
}

/** The current time and date in the hospital's time zone, updated every second. */
export function TerminalClock({ timeZone }: { timeZone: string }) {
  const second = useSyncExternalStore(subscribe, currentSecond, noSecondOnServer);
  const now = second === null ? null : new Date(second * 1000);

  const time = now
    ? new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)
    : "––:––";
  const seconds = now ? new Intl.DateTimeFormat("en-GB", { timeZone, second: "2-digit" }).format(now).padStart(2, "0") : "––";
  const date = now
    ? new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)
    : " ";

  return (
    <div className={styles.clock}>
      <p className={styles.clockTime} aria-live="off">
        <time dateTime={now?.toISOString()}>{time}</time>
        <span className={styles.clockSeconds} aria-hidden="true">
          {seconds}
        </span>
      </p>
      <p className={styles.clockDate}>{date}</p>
    </div>
  );
}
