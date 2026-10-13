"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Fieldset } from "@/components/ui/fieldset";
import layout from "@/components/ui/form-layout.module.css";
import { TextField } from "@/components/ui/text-field";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { updateHospitalSettings } from "../actions";
import { hospitalSettingsSchema, type HospitalSettingsFormInput } from "../schemas";

export function SettingsForm({ defaultValues }: { defaultValues: HospitalSettingsFormInput }) {
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<HospitalSettingsFormInput, unknown, z.output<typeof hospitalSettingsSchema>>({
    resolver: zodResolver(hospitalSettingsSchema),
    defaultValues,
  });

  const onSubmit = handleSubmit(async () => {
    setSaved(false);
    const values = getValues();
    const result = await updateHospitalSettings(values);
    if (!result.ok) {
      applyActionFailure(setError, result);
      return;
    }
    reset(values);
    setSaved(true);
  });

  return (
    <form className={layout.form} onSubmit={onSubmit} noValidate>
      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
      {saved && !isDirty && <Alert tone="success">Settings saved.</Alert>}

      <Fieldset legend="Clock-in rules">
        <div className={layout.grid}>
          <TextField
            label="Minimum time between clock-in and clock-out (minutes)"
            type="number"
            min={0}
            max={120}
            inputMode="numeric"
            hint="Stops someone pressing Clock out by mistake straight after clocking in."
            error={errors.minSessionMinutes?.message}
            {...register("minSessionMinutes")}
          />
          <TextField
            label="Clock-out allowed until (minutes after the shift ends)"
            type="number"
            min={60}
            max={1440}
            inputMode="numeric"
            hint="After this, the session is closed as a missed clock-out and needs a correction."
            error={errors.checkOutWindowMinutes?.message}
            {...register("checkOutWindowMinutes")}
          />
          <TextField
            label="Half day below (% of the scheduled shift)"
            type="number"
            min={1}
            max={99}
            inputMode="numeric"
            hint="A worked shift shorter than this is recorded as a half day."
            error={errors.halfDayThresholdPercent?.message}
            {...register("halfDayThresholdPercent")}
          />
        </div>
        <CheckboxField
          label="Allow clock-in without a rostered shift (flagged for review)"
          {...register("allowUnscheduledCheckIn")}
        />
      </Fieldset>

      <div className={layout.actions}>
        <Button type="submit" loading={isSubmitting}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
