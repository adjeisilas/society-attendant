"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox-field";
import layout from "@/components/ui/form-layout.module.css";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { createAttendanceLocation, updateAttendanceLocation } from "../actions";
import { attendanceLocationSchema, type AttendanceLocationFormInput } from "../schemas";

interface LocationFormProps {
  /** Present when editing an existing location. */
  locationId?: string;
  defaultValues: AttendanceLocationFormInput;
}

export function LocationForm({ locationId, defaultValues }: LocationFormProps) {
  const isEditing = locationId !== undefined;
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AttendanceLocationFormInput, unknown, z.output<typeof attendanceLocationSchema>>({
    resolver: zodResolver(attendanceLocationSchema),
    defaultValues,
  });

  const onSubmit = handleSubmit(async () => {
    setSaved(false);
    const values = getValues();
    const result = locationId
      ? await updateAttendanceLocation(locationId, values)
      : await createAttendanceLocation(values);
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

      <TextField
        label="Name"
        autoComplete="off"
        hint="Where the terminals stand, for example Main Staff Entrance or Maternity Block."
        error={errors.name?.message}
        {...register("name")}
      />
      <TextareaField label="Description" optional error={errors.description?.message} {...register("description")} />

      {isEditing && (
        <CheckboxField
          label="Active: staff can clock in on this location's terminals"
          {...register("isActive")}
        />
      )}

      <div className={layout.actions}>
        {!isEditing && (
          <Link href="/locations" className={buttonClassName({ variant: "secondary" })}>
            Cancel
          </Link>
        )}
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? "Save changes" : "Create location"}
        </Button>
      </div>
    </form>
  );
}
