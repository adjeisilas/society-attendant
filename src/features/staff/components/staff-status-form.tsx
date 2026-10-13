"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import layout from "@/components/ui/form-layout.module.css";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { changeStaffStatus } from "../actions";
import { STAFF_STATUS, type StaffStatus } from "../labels";
import { staffStatusChangeSchema, type StaffStatusChangeInput } from "../schemas";

interface StaffStatusFormProps {
  staffId: string;
  currentStatus: StaffStatus;
}

export function StaffStatusForm({ staffId, currentStatus }: StaffStatusFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<StaffStatusChangeInput, unknown, z.output<typeof staffStatusChangeSchema>>({
    resolver: zodResolver(staffStatusChangeSchema),
    defaultValues: { effectiveDate: "", reason: "" },
  });
  const selectedStatus = useWatch({ control, name: "status" });

  const options = (Object.keys(STAFF_STATUS) as StaffStatus[])
    .filter((status) => status !== currentStatus)
    .map((status) => ({ value: status, label: STAFF_STATUS[status].label }));

  const onSubmit = handleSubmit(async () => {
    setMessage(null);
    const result = await changeStaffStatus(staffId, getValues());
    if (!result.ok) {
      applyActionFailure(setError, result);
      return;
    }
    reset();
    const { cancelledShifts } = result.data;
    setMessage(
      cancelledShifts > 0
        ? `Status updated. ${cancelledShifts} future rostered ${cancelledShifts === 1 ? "shift was" : "shifts were"} cancelled.`
        : "Status updated.",
    );
  });

  return (
    <form className={layout.form} onSubmit={onSubmit} noValidate>
      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      <SelectField
        label="New status"
        placeholder="Select a new status"
        options={options}
        error={errors.status?.message}
        {...register("status")}
      />
      {selectedStatus === "terminated" && (
        <TextField
          label="Termination date"
          type="date"
          error={errors.effectiveDate?.message}
          {...register("effectiveDate")}
        />
      )}
      <TextareaField
        label="Reason"
        hint="Recorded in the audit log."
        error={errors.reason?.message}
        {...register("reason")}
      />
      {selectedStatus && selectedStatus !== "active" && (
        <Alert tone="warning">
          Sign-in access is disabled immediately and rostered shifts that have not started are cancelled.
        </Alert>
      )}
      {selectedStatus === "active" && (
        <Alert tone="info">Reactivating the staff record does not restore sign-in access automatically.</Alert>
      )}

      <div className={layout.actions}>
        <Button type="submit" variant={selectedStatus === "terminated" ? "danger" : "secondary"} loading={isSubmitting}>
          Change status
        </Button>
      </div>
    </form>
  );
}
