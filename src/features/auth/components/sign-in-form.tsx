"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { routes } from "@/lib/auth/routes";
import { applyActionFailure } from "@/lib/forms/apply-action-failure";
import { signIn } from "../actions";
import { signInSchema } from "../schemas";
import styles from "./auth-form.module.css";

export function SignInForm({ next }: { next: string }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof signInSchema>, unknown, z.output<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    const result = await signIn(values, next);
    if (result?.ok === false) applyActionFailure(setError, result);
  });

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
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <p className={styles.inlineLink}>
        <Link href={routes.forgotPassword}>Forgot your password?</Link>
      </p>
      <Button type="submit" fullWidth loading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
