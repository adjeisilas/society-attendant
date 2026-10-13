"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MonitorCheck, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import layout from "@/components/ui/form-layout.module.css";
import { TextField } from "@/components/ui/text-field";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { registerTerminal, startTerminalMode } from "../actions";
import { terminalNameSchema, type TerminalNameInput } from "../schemas";

interface RegisterTerminalFormProps {
  locationId: string;
  locationIsActive: boolean;
  /** The terminal this browser is already registered as, if any. */
  currentTerminalName: string | null;
}

/** Registers the computer the administrator is using right now as a terminal at the location. */
export function RegisterTerminalForm({ locationId, locationIsActive, currentTerminalName }: RegisterTerminalFormProps) {
  const [registeredName, setRegisteredName] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TerminalNameInput, unknown, z.output<typeof terminalNameSchema>>({
    resolver: zodResolver(terminalNameSchema),
    defaultValues: { name: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    const result = await registerTerminal(locationId, values);
    if (!result.ok) {
      applyActionFailure(setError, result);
      return;
    }
    reset();
    setRegisteredName(values.name);
  });

  if (registeredName) {
    return (
      <div className={layout.form}>
        <Alert tone="success" title="This computer is now a terminal">
          It is registered as <strong>{registeredName}</strong>. Sign out and open the clock-in screen before leaving it
          for staff.
        </Alert>
        <form action={startTerminalMode}>
          <Button type="submit" fullWidth>
            <MonitorCheck size={16} aria-hidden="true" />
            Sign out and start the terminal
          </Button>
        </form>
      </div>
    );
  }

  if (!locationIsActive) {
    return <Alert tone="info">Reactivate this location before registering a terminal here.</Alert>;
  }

  return (
    <form className={layout.form} onSubmit={onSubmit} noValidate>
      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
      {currentTerminalName && (
        <Alert tone="info">
          This computer is already the terminal <strong>{currentTerminalName}</strong>. Registering it again switches that
          one off.
        </Alert>
      )}
      <TextField
        label="Terminal name"
        autoComplete="off"
        hint="Something staff and administrators recognise, for example Front desk PC."
        error={errors.name?.message}
        {...register("name")}
      />
      <Button type="submit" loading={isSubmitting} fullWidth>
        <MonitorSmartphone size={16} aria-hidden="true" />
        Register this computer
      </Button>
    </form>
  );
}
