"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AttachmentField } from "@/features/attachments/components/attachment-field";
import layout from "@/components/ui/form-layout.module.css";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { requestCorrection } from "../actions";
import { correctionRequestSchema } from "../schemas";

interface CorrectionRequestFormProps {
  attendanceRecordId: string;
  /** Recorded times as ISO instants, shown in the device's time zone for editing. */
  currentCheckInAt: string | null;
  currentCheckOutAt: string | null;
}

export function CorrectionRequestForm({
  attendanceRecordId,
  currentCheckInAt,
  currentCheckOutAt,
}: CorrectionRequestFormProps) {
  const [checkIn, setCheckIn] = useState(toLocalInput(currentCheckInAt));
  const [checkOut, setCheckOut] = useState(toLocalInput(currentCheckOutAt));
  const [reason, setReason] = useState("");
  const [evidencePath, setEvidencePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const input = { checkInAt: toInstant(checkIn), checkOutAt: toInstant(checkOut), reason, evidencePath };
    const parsed = correctionRequestSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the times and try again.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await requestCorrection(attendanceRecordId, input);
      if (result.ok) {
        setSent(true);
        setReason("");
      } else {
        setError(result.message);
      }
    });
  };

  if (sent) {
    return <Alert tone="success">Your correction was sent for review.</Alert>;
  }

  return (
    <div className={layout.form}>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className={layout.grid}>
        <TextField
          label="Checked in at"
          type="datetime-local"
          optional
          value={checkIn}
          onChange={(event) => setCheckIn(event.target.value)}
        />
        <TextField
          label="Checked out at"
          type="datetime-local"
          optional
          value={checkOut}
          onChange={(event) => setCheckOut(event.target.value)}
        />
      </div>
      <TextareaField
        label="What happened"
        hint="Explain why the recorded times are wrong. Your hospital administrator reviews this."
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <AttachmentField
        label="Evidence"
        hint="For example a ward register photo. A photo or PDF, up to 6 MB."
        onChange={(path) => setEvidencePath(path ?? "")}
      />
      <div className={layout.actions}>
        <Button onClick={submit} loading={pending}>
          Request correction
        </Button>
      </div>
    </div>
  );
}

/** ISO instant to the "YYYY-MM-DDTHH:mm" a datetime-local input expects, in device time. */
function toLocalInput(instant: string | null): string {
  if (!instant) return "";
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toInstant(localValue: string): string {
  if (!localValue) return "";
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
