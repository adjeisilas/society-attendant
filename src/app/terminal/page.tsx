import { MonitorX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";
import { startTerminalMode } from "@/features/terminals/actions";
import { TerminalScreen } from "@/features/terminals/components/terminal-screen";
import styles from "@/features/terminals/components/terminal.module.css";
import { getCurrentTerminal } from "@/features/terminals/queries";
import { routes } from "@/lib/auth/routes";
import { getSessionState } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Clock in" };

const TERMINALS_PAGE = "/locations";

/**
 * The clock-in screen on a registered attendance terminal. It needs no signed-in user:
 * each staff member signs in for their own clock-in, on the server, and is signed out again.
 */
export default async function TerminalPage() {
  const [terminal, session] = await Promise.all([getCurrentTerminal(), getSessionState()]);
  const signedInAs =
    session.status === "active" ? session.user.displayName : session.status === "inactive" ? (session.email ?? "An account") : null;

  if (!terminal) {
    return (
      <StatusPanel
        fullPage
        icon={<MonitorX size={22} />}
        title="This computer is not an attendance terminal"
        description="Staff can clock in only on computers an administrator has registered. To register this one, sign in as an administrator, open Terminals, choose the location and select Register this computer."
      >
        <Link
          href={signedInAs ? TERMINALS_PAGE : `${routes.signIn}?next=${encodeURIComponent(TERMINALS_PAGE)}`}
          className={buttonClassName()}
        >
          {signedInAs ? "Open Terminals" : "Sign in as an administrator"}
        </Link>
      </StatusPanel>
    );
  }

  return (
    <>
      {signedInAs && (
        <div className={styles.sessionNotice} role="alert">
          <p>
            <strong>{signedInAs}</strong> is still signed in to the staff portal on this computer. Sign out before
            leaving it as a terminal.
          </p>
          <form action={startTerminalMode}>
            <Button type="submit" size="sm" variant="secondary">
              Sign out
            </Button>
          </form>
        </div>
      )}
      <TerminalScreen
        terminalName={terminal.name}
        locationName={terminal.locationName}
        hospitalName={terminal.hospitalName}
        timeZone={terminal.timeZone}
      />
    </>
  );
}
