"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheckBig, LogIn, LogOut, MapPin, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { BrandMark } from "@/components/brand/brand-mark";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ATTENDANCE_FLAG_LABELS, ATTENDANCE_STATUS, formatMinutes } from "@/features/attendance/labels";
import type { ClockAction } from "@/features/attendance/schemas";
import { formatTimeOfDay } from "@/lib/dates";
import { clockAtTerminal, type ClockOutcome } from "../actions";
import { IDLE_RESET_SECONDS, RESULT_DISPLAY_SECONDS } from "../constants";
import { terminalCredentialsSchema, type TerminalCredentialsInput } from "../schemas";
import { TerminalClock } from "./terminal-clock";
import styles from "./terminal.module.css";

export interface TerminalScreenProps {
  terminalName: string;
  locationName: string;
  hospitalName: string;
  timeZone: string;
}

export function TerminalScreen({ terminalName, locationName, hospitalName, timeZone }: TerminalScreenProps) {
  const [outcome, setOutcome] = useState<ClockOutcome | null>(null);
  const clearOutcome = useCallback(() => setOutcome(null), []);

  return (
    <div className={styles.screen}>
      <section className={styles.hero} aria-label="Terminal">
        <div className={styles.heroBrand}>
          <BrandMark tone="dark" size="lg" />
          <div>
            <p className={styles.heroProduct}>Staff Attendance</p>
            <p className={styles.heroHospital}>{hospitalName}</p>
          </div>
        </div>

        <TerminalClock timeZone={timeZone} />

        <dl className={styles.heroFacts}>
          <div>
            <dt>
              <MapPin size={15} aria-hidden="true" />
              Location
            </dt>
            <dd>{locationName}</dd>
          </div>
          <div>
            <dt>
              <MonitorSmartphone size={15} aria-hidden="true" />
              Terminal
            </dt>
            <dd>{terminalName}</dd>
          </div>
        </dl>

        <p className={styles.heroNote}>
          <ShieldCheck size={16} aria-hidden="true" />
          Your sign-in is used for this clock-in only and is never kept on this computer.
        </p>
      </section>

      <section className={styles.panel} aria-live="polite">
        {outcome ? (
          <ClockResult outcome={outcome} timeZone={timeZone} onDone={clearOutcome} />
        ) : (
          <ClockForm onClocked={setOutcome} />
        )}
      </section>
    </div>
  );
}

function ClockForm({ onClocked }: { onClocked: (outcome: ClockOutcome) => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ClockAction | null>(null);
  const [pending, startTransition] = useTransition();
  const idleTimer = useRef<number | undefined>(undefined);
  const {
    register,
    handleSubmit,
    reset,
    resetField,
    setFocus,
    formState: { errors },
  } = useForm<TerminalCredentialsInput, unknown, z.output<typeof terminalCredentialsSchema>>({
    resolver: zodResolver(terminalCredentialsSchema),
    defaultValues: { identifier: "", password: "" },
  });

  useEffect(() => {
    setFocus("identifier");
    return () => window.clearTimeout(idleTimer.current);
  }, [setFocus]);

  // Someone who walks away mid-entry should not leave their staff ID or password behind.
  const restartIdleTimer = () => {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      reset();
      setServerError(null);
    }, IDLE_RESET_SECONDS * 1000);
  };

  const submit = (action: ClockAction) =>
    void handleSubmit((values) => {
      setServerError(null);
      setPendingAction(action);
      startTransition(async () => {
        const result = await clockAtTerminal({ ...values, action });
        setPendingAction(null);
        if (result.ok) {
          window.clearTimeout(idleTimer.current);
          onClocked(result.data);
          return;
        }
        setServerError(result.message);
        resetField("password");
        setFocus("password");
      });
    })();

  return (
    // Both actions are ordinary buttons, so pressing Enter never picks one by accident.
    <form className={styles.form} onInput={restartIdleTimer} onSubmit={(event) => event.preventDefault()} noValidate>
      <header className={styles.formHeader}>
        <p className={styles.formEyebrow}>Attendance terminal</p>
        <h1 className={styles.formTitle}>Clock in or out</h1>
        <p className={styles.formDescription}>Sign in with your staff ID or email and your password, then choose.</p>
      </header>

      {serverError && <Alert tone="danger">{serverError}</Alert>}

      <div className={styles.fields}>
        <TextField
          label="Staff ID or email"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          readOnly={pending}
          error={errors.identifier?.message}
          {...register("identifier")}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="off"
          readOnly={pending}
          error={errors.password?.message}
          {...register("password")}
        />
      </div>

      <div className={styles.actions}>
        <Button
          variant="success"
          size="lg"
          fullWidth
          onClick={() => submit("check_in")}
          loading={pendingAction === "check_in"}
          disabled={pending}
        >
          {pendingAction !== "check_in" && <LogIn size={20} aria-hidden="true" />}
          Clock in
        </Button>
        <Button
          variant="dark"
          size="lg"
          fullWidth
          onClick={() => submit("check_out")}
          loading={pendingAction === "check_out"}
          disabled={pending}
        >
          {pendingAction !== "check_out" && <LogOut size={20} aria-hidden="true" />}
          Clock out
        </Button>
      </div>

      <p className={styles.formFootnote}>
        Forgotten your password? Ask your HR office, or reset it from the staff portal.
      </p>
    </form>
  );
}

function ClockResult({ outcome, timeZone, onDone }: { outcome: ClockOutcome; timeZone: string; onDone: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(RESULT_DISPLAY_SECONDS);

  useEffect(() => {
    const done = window.setTimeout(onDone, RESULT_DISPLAY_SECONDS * 1000);
    const tick = window.setInterval(() => setSecondsLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => {
      window.clearTimeout(done);
      window.clearInterval(tick);
    };
  }, [onDone]);

  const isClockIn = outcome.action === "check_in";
  const status = ATTENDANCE_STATUS[outcome.status];
  const firstName = outcome.staffName.split(" ")[0];
  const time = formatTimeOfDay(outcome.recordedAt, timeZone);

  const details: { term: string; value: ReactNode }[] = [
    {
      term: "Status",
      value: (
        <span className={styles.statusValue}>
          <Badge tone={status.tone}>{status.label}</Badge>
          {isClockIn && outcome.lateMinutes > 0 && outcome.status === "late" && (
            <span>{formatMinutes(outcome.lateMinutes)} late</span>
          )}
        </span>
      ),
    },
  ];
  if (outcome.shiftName) details.push({ term: "Shift", value: outcome.shiftName });
  if (!isClockIn) details.push({ term: "Time worked", value: formatMinutes(outcome.workedMinutes) });
  if (outcome.overtimeMinutes !== null) details.push({ term: "Overtime", value: formatMinutes(outcome.overtimeMinutes) });
  if (outcome.earlyLeaveMinutes !== null) {
    details.push({ term: "Left early by", value: formatMinutes(outcome.earlyLeaveMinutes) });
  }
  if (outcome.flags.length > 0) {
    details.push({
      term: "For review",
      value: outcome.flags.map((flag) => ATTENDANCE_FLAG_LABELS[flag]).join(", "),
    });
  }

  return (
    <div className={styles.result} data-action={outcome.action}>
      <span className={styles.resultIcon} aria-hidden="true">
        <CircleCheckBig size={44} strokeWidth={2.2} />
      </span>
      <p className={styles.resultEyebrow}>{isClockIn ? "Clocked in" : "Clocked out"}</p>
      <h1 className={styles.resultTitle}>
        {isClockIn ? `${greetingAt(outcome.recordedAt, timeZone)}, ${firstName}` : `Goodbye, ${firstName}`}
      </h1>
      <p className={styles.resultTime}>
        {outcome.staffName} · {isClockIn ? "in" : "out"} at <strong>{time}</strong>
      </p>

      <dl className={styles.resultDetails}>
        {details.map((item) => (
          <div key={item.term}>
            <dt>{item.term}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>

      {outcome.mustChangePassword && (
        <Alert tone="warning" title="Choose your own password">
          Your password was set by an administrator. Sign in to the staff portal on your own device to change it.
        </Alert>
      )}

      <Button variant="secondary" size="lg" fullWidth onClick={onDone} autoFocus>
        Done
      </Button>
      <p className={styles.resultCountdown}>Ready for the next person in {secondsLeft} s</p>
    </div>
  );
}

function greetingAt(timestamp: string, timeZone: string): string {
  const hour = Number(formatTimeOfDay(timestamp, timeZone).slice(0, 2));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
