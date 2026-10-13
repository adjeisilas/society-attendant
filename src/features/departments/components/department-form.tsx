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
import { SelectField, type SelectOption } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { createDepartment, updateDepartment } from "../actions";
import { departmentSchema, type DepartmentFormInput } from "../schemas";

interface DepartmentFormProps {
  /** Present when editing an existing department. */
  departmentId?: string;
  defaultValues: DepartmentFormInput;
  headOptions?: SelectOption[];
}

export function DepartmentForm({ departmentId, defaultValues, headOptions = [] }: DepartmentFormProps) {
  const isEditing = departmentId !== undefined;
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<DepartmentFormInput, unknown, z.output<typeof departmentSchema>>({
    resolver: zodResolver(departmentSchema),
    defaultValues,
  });

  const onSubmit = handleSubmit(async () => {
    setSaved(false);
    const values = getValues();
    const result = departmentId ? await updateDepartment(departmentId, values) : await createDepartment(values);
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
        <TextField label="Name" autoComplete="off" error={errors.name?.message} {...register("name")} />
        <TextField
          label="Code"
          autoComplete="off"
          hint="A short identifier, for example ER or MAT."
          error={errors.code?.message}
          {...register("code")}
        />
        <TextareaField
          className={layout.fullRow}
          label="Description"
          optional
          error={errors.description?.message}
          {...register("description")}
        />
        {isEditing && (
          <SelectField
            className={layout.fullRow}
            label="Department head"
            optional
            placeholder="No department head"
            options={headOptions}
            hint="Only active members of this department can be appointed. The head can view the department's staff, roster and attendance."
            error={errors.headStaffId?.message}
            {...register("headStaffId")}
          />
        )}
        {isEditing && (
          <div className={layout.fullRow}>
            <CheckboxField label="Active: staff and shifts can be assigned to this department" {...register("isActive")} />
          </div>
        )}
      </div>

      <div className={layout.actions}>
        {!isEditing && (
          <Link href="/departments" className={buttonClassName({ variant: "secondary" })}>
            Cancel
          </Link>
        )}
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? "Save changes" : "Create department"}
        </Button>
      </div>
    </form>
  );
}
