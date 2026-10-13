"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Fieldset } from "@/components/ui/fieldset";
import layout from "@/components/ui/form-layout.module.css";
import { SelectField, type SelectOption } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { createShift, updateShift } from "../actions";
import { MIN_SHIFT_MINUTES, shiftSchema, type ShiftFormInput } from "../schemas";
import { durationBetween, formatDuration } from "../time";

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

interface ShiftFormProps {
  /** Present when editing an existing shift template. */
  shiftId?: string;
  defaultValues: ShiftFormInput;
  departmentOptions: SelectOption[];
}

export function ShiftForm({ shiftId, defaultValues, departmentOptions }: ShiftFormProps) {
  const isEditing = shiftId !== undefined;
  const [saved, setSaved] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ShiftFormInput, unknown, z.output<typeof shiftSchema>>({
    resolver: zodResolver(shiftSchema),
    defaultValues,
  });

  const [startTime, endTime] = useWatch({ control, name: ["startTime", "endTime"] });
  const timesValid = TIME_OF_DAY.test(startTime) && TIME_OF_DAY.test(endTime);
  const duration = timesValid ? durationBetween(startTime, endTime) : null;

  const onSubmit = handleSubmit(async () => {
    setSaved(false);
    const values = getValues();
    const result = shiftId ? await updateShift(shiftId, values) : await createShift(values);
    if (result?.ok === false) {
      applyActionFailure(setError, result);
      return;
    }
    reset(values);
    setSaved(true);
  });

  return (
    <form className={layout.form} onSubmit={onSubmit} noValidate>
      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
      {saved && !isDirty && <Alert tone="success">Changes saved.</Alert>}

      <Fieldset legend="Shift">
        <div className={layout.grid}>
          <TextField label="Name" autoComplete="off" error={errors.name?.message} {...register("name")} />
          <TextField
            label="Code"
            autoComplete="off"
            hint="Shown on the roster, for example D, N or LD."
            error={errors.code?.message}
            {...register("code")}
          />
          <SelectField
            className={layout.fullRow}
            label="Department"
            placeholder="All departments"
            options={departmentOptions}
            hint="Limit the template to one department, or make it available hospital-wide."
            error={errors.departmentId?.message}
            {...register("departmentId")}
          />
        </div>
      </Fieldset>

      <Fieldset legend="Times">
        <div className={layout.grid}>
          <TextField label="Start time" type="time" error={errors.startTime?.message} {...register("startTime")} />
          <TextField
            label="End time"
            type="time"
            hint={
              duration === null
                ? "An end time at or before the start time finishes the next day."
                : `${formatDuration(duration)}${duration >= MIN_SHIFT_MINUTES && timesValid && endTime <= startTime ? ", ends the next day" : ""}.`
            }
            error={errors.endTime?.message}
            {...register("endTime")}
          />
        </div>
        {isEditing && (
          <Alert tone="info">
            Changing the start or end time also updates rostered shifts that have not started yet. Shifts already
            worked keep their original times.
          </Alert>
        )}
      </Fieldset>

      <Fieldset legend="Attendance rules" hint="Applied when staff check in and out against this shift.">
        <div className={layout.grid}>
          <TextField
            label="Unpaid break (minutes)"
            type="number"
            min={0}
            inputMode="numeric"
            error={errors.breakMinutes?.message}
            {...register("breakMinutes")}
          />
          <TextField
            label="Check-in opens (minutes before start)"
            type="number"
            min={0}
            inputMode="numeric"
            error={errors.checkInOpensMinutes?.message}
            {...register("checkInOpensMinutes")}
          />
          <TextField
            label="Late after (minutes of grace)"
            type="number"
            min={0}
            inputMode="numeric"
            hint="Checking in later than this after the start time is recorded as late."
            error={errors.lateGraceMinutes?.message}
            {...register("lateGraceMinutes")}
          />
          <TextField
            label="Early leave grace (minutes)"
            type="number"
            min={0}
            inputMode="numeric"
            error={errors.earlyLeaveGraceMinutes?.message}
            {...register("earlyLeaveGraceMinutes")}
          />
          <TextField
            label="Overtime counts after (minutes)"
            type="number"
            min={0}
            inputMode="numeric"
            hint="Minutes past the end time before overtime is recorded."
            error={errors.overtimeThresholdMinutes?.message}
            {...register("overtimeThresholdMinutes")}
          />
        </div>
      </Fieldset>

      {isEditing && (
        <CheckboxField label="Active: this template can be used for new roster entries" {...register("isActive")} />
      )}

      <div className={layout.actions}>
        {!isEditing && (
          <Link href="/shifts" className={buttonClassName({ variant: "secondary" })}>
            Cancel
          </Link>
        )}
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? "Save changes" : "Create shift template"}
        </Button>
      </div>
    </form>
  );
}
