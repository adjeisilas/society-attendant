"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DescriptionList } from "@/components/ui/description-list";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import type { AppRole } from "@/lib/auth/permissions";
import { PASSWORD_MIN_LENGTH } from "@/features/auth/schemas";
import { createStaffAccount, resetStaffPassword } from "../actions";
import { ACCOUNT_ROLE_LABELS, type AccountState } from "../labels";
import { INVITABLE_ROLES, type InvitableRole } from "../schemas";
import styles from "./staff-account.module.css";

const ROLE_OPTIONS = INVITABLE_ROLES.map((role) => ({ value: role, label: ACCOUNT_ROLE_LABELS[role] }));

interface StaffAccountProps {
  staffId: string;
  state: AccountState;
  role: AppRole | null;
  email: string | null;
  isActiveStaff: boolean;
  /** Preformatted in the hospital's time zone. */
  activatedAtLabel: string | null;
}

export function StaffAccount({ staffId, state, role, email, isActiveStaff, activatedAtLabel }: StaffAccountProps) {
  const [selectedRole, setSelectedRole] = useState<InvitableRole>("staff");
  const [mode, setMode] = useState<"generate" | "manual">("generate");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string | null } | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const blocker = !email
    ? "Add an email address to this staff record to give them an account."
    : !isActiveStaff
      ? "Only active staff can be given an account."
      : null;

  const createAccount = () => {
    setError(null);
    startTransition(async () => {
      const result = await createStaffAccount(staffId, { role: selectedRole, mode, password });
      if (result.ok) {
        setCreated({ email: result.data.email, password: result.data.generatedPassword });
        setPassword("");
      } else {
        setError(result.message);
      }
    });
  };

  /** Returns an error message for the dialog, or null when the reset succeeded. */
  const resetPassword = async (): Promise<string | null> => {
    setError(null);
    setResetPasswordValue(null);
    const result = await resetStaffPassword(staffId, { mode, password });
    if (!result.ok) return result.message;
    setResetPasswordValue(result.data.generatedPassword ?? "");
    setPassword("");
    return null;
  };

  return (
    <div className={styles.account}>
      {error && <Alert tone="danger">{error}</Alert>}

      {resetPasswordValue !== null && (
        <Alert tone="success">
          <p>Password reset. They must choose a new password the next time they sign in.</p>
          {resetPasswordValue && (
            <p>
              New password: <code>{resetPasswordValue}</code>
              <br />
              Give it to them now. It is not shown again.
            </p>
          )}
        </Alert>
      )}

      {created && (
        <Alert tone="success">
          <p>
            Account created for <strong>{created.email}</strong>.
          </p>
          {created.password && (
            <p>
              Temporary password: <code>{created.password}</code>
              <br />
              Give it to the staff member now. It is not shown again, and they choose their own password when they
              first sign in.
            </p>
          )}
          {!created.password && <p>They must choose a new password when they first sign in.</p>}
        </Alert>
      )}

      {state === "none" && !created && (
        <>
          <p className="text-muted">This staff member cannot sign in yet.</p>
          {blocker ? (
            <Alert tone="info">{blocker}</Alert>
          ) : (
            <>
              <SelectField
                label="Role"
                options={ROLE_OPTIONS}
                value={selectedRole}
                onChange={(event) => setSelectedRole(event.target.value as InvitableRole)}
                hint="Hospital admins manage staff, rosters and attendance for the whole hospital."
              />
              <SelectField
                label="First password"
                options={[
                  { value: "generate", label: "Generate a password" },
                  { value: "manual", label: "Enter a password" },
                ]}
                value={mode}
                onChange={(event) => setMode(event.target.value as "generate" | "manual")}
                hint="The staff member signs in with this once, then chooses their own."
              />
              {mode === "manual" && (
                <TextField
                  label="Password"
                  type="text"
                  autoComplete="off"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  hint={`At least ${PASSWORD_MIN_LENGTH} characters. It is shown here so you can pass it on.`}
                />
              )}
              <Button onClick={createAccount} loading={pending}>
                Create sign-in account
              </Button>
            </>
          )}
        </>
      )}

      {state === "invited" && (
        <p className="text-muted">
          An invitation was sent to <strong>{email}</strong>. The account has not been activated yet.
        </p>
      )}

      {(state === "active" || state === "disabled") && (
        <>
          {state === "disabled" && <Alert tone="warning">Sign-in access is disabled for this account.</Alert>}
          <DescriptionList
            items={[
              { term: "Role", value: role ? ACCOUNT_ROLE_LABELS[role] : "Unknown" },
              { term: "Sign-in email", value: email ?? "Not available" },
              { term: "Activated", value: activatedAtLabel ?? "Not activated" },
            ]}
          />
          {isActiveStaff && (
            <>
              <SelectField
                label="New password"
                options={[
                  { value: "generate", label: "Generate a password" },
                  { value: "manual", label: "Enter a password" },
                ]}
                value={mode}
                onChange={(event) => setMode(event.target.value as "generate" | "manual")}
                hint="Use this when someone has forgotten their password."
              />
              {mode === "manual" && (
                <TextField
                  label="Password"
                  type="text"
                  autoComplete="off"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  hint={`At least ${PASSWORD_MIN_LENGTH} characters. It is shown here so you can pass it on.`}
                />
              )}
              <ConfirmDialog
                title="Reset this password?"
                description="Their current password stops working immediately. They will have to choose a new one the next time they sign in."
                confirmLabel="Reset password"
                onConfirm={resetPassword}
                renderTrigger={(open) => (
                  <Button variant="secondary" onClick={open}>
                    Reset password
                  </Button>
                )}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
