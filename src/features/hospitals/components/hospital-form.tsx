"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import layout from "@/components/ui/form-layout.module.css";
import { SelectField, type SelectOption } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { setUpHospital, updateHospitalDetails } from "../actions";
import { hospitalSchema, type HospitalFormInput } from "../schemas";

interface HospitalFormProps {
  /** Present when editing the hospital; absent during first-time setup. */
  hospitalId?: string;
  defaultValues: HospitalFormInput;
  timeZoneOptions: SelectOption[];
}

export function HospitalForm({ hospitalId, defaultValues, timeZoneOptions }: HospitalFormProps) {
  const isEditing = hospitalId !== undefined;
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<HospitalFormInput, unknown, z.output<typeof hospitalSchema>>({
    resolver: zodResolver(hospitalSchema),
    defaultValues,
  });

  const onSubmit = handleSubmit(async () => {
    setSaved(false);
    const values = getValues();
    const result = hospitalId ? await updateHospitalDetails(hospitalId, values) : await setUpHospital(values);
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

      <div className={layout.grid}>
        <TextField
          className={layout.fullRow}
          label="Hospital name"
          autoComplete="organization"
          error={errors.name?.message}
          {...register("name")}
        />
        <TextField
          label="Short code"
          autoComplete="off"
          hint="Used in report file names, for example KBTH."
          error={errors.code?.message}
          {...register("code")}
        />
        <SelectField
          label="Time zone"
          placeholder="Choose a time zone"
          options={timeZoneOptions}
          hint="Shift times and attendance dates use this time zone."
          error={errors.timezone?.message}
          {...register("timezone")}
        />
        <TextField label="Phone" type="tel" autoComplete="tel" optional error={errors.phone?.message} {...register("phone")} />
        <TextField label="Email" type="email" autoComplete="email" optional error={errors.email?.message} {...register("email")} />
        <TextareaField
          className={layout.fullRow}
          label="Address"
          optional
          error={errors.address?.message}
          {...register("address")}
        />
      </div>

      <div className={layout.actions}>
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? "Save changes" : "Set up hospital"}
        </Button>
      </div>
    </form>
  );
}
