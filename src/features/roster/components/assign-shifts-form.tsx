"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Fieldset } from "@/components/ui/fieldset";
import layout from "@/components/ui/form-layout.module.css";
import { SelectField, type SelectOption } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { datesOnWeekdays, formatIsoDate, isIsoDate, WEEKDAYS } from "@/lib/dates";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { assignShifts } from "../actions";
import type { RosterStaff } from "../queries";
import { assignShiftsSchema, type AssignShiftsInput, type AssignShiftsOutcome } from "../schemas";
import styles from "./roster.module.css";

const SKIP_REASONS = {
  overlap: "already rostered at an overlapping time",
  staff_not_active: "no longer an active staff member",
} as const;

interface AssignShiftsFormProps {
  staff: RosterStaff[];
  shiftOptions: SelectOption[];
  defaultStartDate: string;
  defaultEndDate: string;
  rosterHref: string;
}

export function AssignShiftsForm({ staff, shiftOptions, defaultStartDate, defaultEndDate, rosterHref }: AssignShiftsFormProps) {
  const [outcome, setOutcome] = useState<AssignShiftsOutcome | null>(null);
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AssignShiftsInput, unknown, z.output<typeof assignShiftsSchema>>({
    resolver: zodResolver(assignShiftsSchema),
    defaultValues: {
      shiftId: "",
      staffIds: [],
      startDate: defaultStartDate,
      endDate: defaultEndDate,
      weekdays: [1, 2, 3, 4, 5],
    },
  });

  const [staffIds, startDate, endDate, weekdays] = useWatch({
    control,
    name: ["staffIds", "startDate", "endDate", "weekdays"],
  });
  const plannedDates =
    isIsoDate(startDate) && isIsoDate(endDate) ? datesOnWeekdays(startDate, endDate, weekdays.map(Number)) : [];
  const plannedTotal = plannedDates.length * staffIds.length;
  const staffNames = new Map(staff.map((member) => [member.id, member.fullName]));

  const onSubmit = handleSubmit(async () => {
    setOutcome(null);
    const result = await assignShifts(getValues());
    if (!result.ok) {
      applyActionFailure(setError, result);
      return;
    }
    setOutcome(result.data);
  });

  return (
    <form className={layout.form} onSubmit={onSubmit} noValidate>
      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}

      {outcome && (
        <Alert tone={outcome.created > 0 ? "success" : "warning"}>
          {outcome.created > 0
            ? `${outcome.created} ${outcome.created === 1 ? "shift" : "shifts"} added to the roster.`
            : "No shifts were added."}{" "}
          <Link href={rosterHref}>View roster</Link>
          {outcome.skipped.length > 0 && (
            <>
              <p>
                {outcome.skipped.length} {outcome.skipped.length === 1 ? "shift was" : "shifts were"} skipped:
              </p>
              <ul className={styles.skippedList}>
                {outcome.skipped.slice(0, 10).map((entry) => (
                  <li key={`${entry.staffId}-${entry.workDate}`}>
                    {staffNames.get(entry.staffId) ?? "Staff member"} on {formatIsoDate(entry.workDate, "EEE d MMM")} —{" "}
                    {SKIP_REASONS[entry.reason]}
                  </li>
                ))}
                {outcome.skipped.length > 10 && <li>and {outcome.skipped.length - 10} more</li>}
              </ul>
            </>
          )}
        </Alert>
      )}

      <SelectField
        label="Shift"
        placeholder="Select a shift"
        options={shiftOptions}
        error={errors.shiftId?.message}
        {...register("shiftId")}
      />

      <Controller
        control={control}
        name="staffIds"
        render={({ field, fieldState }) => (
          <Fieldset
            legend="Staff"
            hint={`${field.value.length} of ${staff.length} selected`}
            error={fieldState.error?.message}
          >
            <div className={styles.pickerActions}>
              <Button size="sm" variant="ghost" onClick={() => field.onChange(staff.map((member) => member.id))}>
                Select all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => field.onChange([])}>
                Clear
              </Button>
            </div>
            <div className={styles.staffList}>
              {staff.map((member) => (
                <CheckboxField
                  key={member.id}
                  label={
                    <>
                      {member.fullName}
                      <span className="text-muted text-sm"> · {member.jobTitle}</span>
                    </>
                  }
                  checked={field.value.includes(member.id)}
                  onChange={(event) =>
                    field.onChange(
                      event.target.checked
                        ? [...field.value, member.id]
                        : field.value.filter((id) => id !== member.id),
                    )
                  }
                />
              ))}
            </div>
          </Fieldset>
        )}
      />

      <div className={layout.grid}>
        <TextField label="From" type="date" error={errors.startDate?.message} {...register("startDate")} />
        <TextField label="To" type="date" error={errors.endDate?.message} {...register("endDate")} />
      </div>

      <Controller
        control={control}
        name="weekdays"
        render={({ field, fieldState }) => (
          <Fieldset legend="Days of the week" error={fieldState.error?.message}>
            <div className={styles.weekdays}>
              {WEEKDAYS.map((weekday) => (
                <CheckboxField
                  key={weekday.value}
                  label={weekday.label}
                  checked={field.value.includes(weekday.value)}
                  onChange={(event) =>
                    field.onChange(
                      event.target.checked
                        ? [...field.value, weekday.value]
                        : field.value.filter((value) => value !== weekday.value),
                    )
                  }
                />
              ))}
            </div>
          </Fieldset>
        )}
      />

      <div className={layout.actions}>
        <p className="text-muted text-sm">
          {plannedTotal > 0
            ? `Adds up to ${plannedTotal} ${plannedTotal === 1 ? "shift" : "shifts"} across ${plannedDates.length} ${plannedDates.length === 1 ? "day" : "days"}.`
            : "Select staff, dates and days of the week."}
        </p>
        <Link href={rosterHref} className={buttonClassName({ variant: "secondary" })}>
          Back to roster
        </Link>
        <Button type="submit" loading={isSubmitting}>
          Add to roster
        </Button>
      </div>
    </form>
  );
}
