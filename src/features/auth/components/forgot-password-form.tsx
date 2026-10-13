"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { requestPasswordReset } from "../actions";
import { forgotPasswordSchema } from "../schemas";
import styles from "./auth-form.module.css";

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof forgotPasswordSchema>, unknown, z.output<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    const result = await requestPasswordReset(values);
    if (result.ok) setSentTo(values.email);
    else applyActionFailure(setError, result);
  });

  if (sentTo) {
    return (
      <Alert tone="success" title="Check your email">
        If an account exists for <strong>{sentTo}</strong>, we have sent a link to reset the password. The link can
        be used once and expires after a short time.
      </Alert>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
      <TextField
        label="Email address"
        type="email"
        inputMode="email"
        autoComplete="username"
        error={errors.email?.message}
        {...register("email")}
      />
      <Button type="submit" fullWidth loading={isSubmitting}>
        Send reset link
      </Button>
    </form>
  );
}
