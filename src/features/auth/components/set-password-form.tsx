"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { setPassword } from "../actions";
import { PASSWORD_MIN_LENGTH, setPasswordSchema } from "../schemas";
import styles from "./auth-form.module.css";

export function SetPasswordForm() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof setPasswordSchema>, unknown, z.output<typeof setPasswordSchema>>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    const result = await setPassword(values);
    if (result?.ok === false) applyActionFailure(setError, result);
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A phrase of several words is easy to remember and hard to guess.`}
        error={errors.password?.message}
        {...register("password")}
      />
      <TextField
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />
      <Button type="submit" fullWidth loading={isSubmitting}>
        Save password
      </Button>
    </form>
  );
}
