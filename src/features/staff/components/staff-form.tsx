"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import layout from "@/components/ui/form-layout.module.css";
import { SelectField, type SelectOption } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { createStaff, updateStaff } from "../actions";
import { EMPLOYMENT_TYPE_LABELS, type EmploymentType } from "../labels";
import { staffSchema, type StaffFormInput } from "../schemas";

const EMPLOYMENT_TYPE_OPTIONS: SelectOption[] = (Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((type) => ({
  value: type,
  label: EMPLOYMENT_TYPE_LABELS[type],
}));

interface StaffFormProps {
  /** Present when editing an existing staff record. */
  staffId?: string;
  defaultValues: StaffFormInput;
  departmentOptions: SelectOption[];
  /** The email is the sign-in address of a linked account and cannot change here. */
  emailLocked?: boolean;
}

export function StaffForm({ staffId, defaultValues, departmentOptions, emailLocked = false }: StaffFormProps) {
  const isEditing = staffId !== undefined;
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<StaffFormInput, unknown, z.output<typeof staffSchema>>({
    resolver: zodResolver(staffSchema),
    defaultValues,
  });

  const onSubmit = handleSubmit(async () => {
    setSaved(false);
    const values = getValues();
    const result = staffId ? await updateStaff(staffId, values) : await createStaff(values);
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
        <TextField label="First name" autoComplete="off" error={errors.firstName?.message} {...register("firstName")} />
        <TextField label="Last name" autoComplete="off" error={errors.lastName?.message} {...register("lastName")} />
        <TextField
          label="Employee number"
          autoComplete="off"
          error={errors.employeeNumber?.message}
          {...register("employeeNumber")}
        />
        <TextField label="Job title" autoComplete="off" error={errors.jobTitle?.message} {...register("jobTitle")} />
        <SelectField
          label="Department"
          placeholder="Select a department"
          options={departmentOptions}
          error={errors.departmentId?.message}
          {...register("departmentId")}
        />
        <SelectField
          label="Employment type"
          placeholder="Select an employment type"
          options={EMPLOYMENT_TYPE_OPTIONS}
          error={errors.employmentType?.message}
          {...register("employmentType")}
        />
        <TextField label="Hire date" type="date" error={errors.hireDate?.message} {...register("hireDate")} />
        <TextField
          label="Phone"
          type="tel"
          optional
          autoComplete="off"
          error={errors.phone?.message}
          {...register("phone")}
        />
        <TextField
          className={layout.fullRow}
          label="Email address"
          type="email"
          optional={!emailLocked}
          readOnly={emailLocked}
          autoComplete="off"
          hint={
            emailLocked
              ? "This is the staff member's sign-in address and cannot be changed here."
              : "Required to invite the staff member to sign in."
          }
          error={errors.email?.message}
          {...register("email")}
        />
      </div>

      <div className={layout.actions}>
        {!isEditing && (
          <Link href="/staff" className={buttonClassName({ variant: "secondary" })}>
            Cancel
          </Link>
        )}
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? "Save changes" : "Add staff member"}
        </Button>
      </div>
    </form>
  );
}
