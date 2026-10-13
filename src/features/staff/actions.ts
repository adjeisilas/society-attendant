"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import {
  actionFailure,
  actionSuccess,
  CHECK_FIELDS_MESSAGE,
  NO_HOSPITAL_MESSAGE,
  validationFailure,
  type ActionFailure,
  type ActionResult,
} from "@/lib/forms/action-result";
import { requireHospitalScope } from "@/lib/hospital-context";
import { supabaseAuthAdmin } from "@/lib/supabase/admin";
import { dataError, isUniqueViolation, raisedErrorCode } from "@/lib/supabase/data";
import { createSupabaseServerClient, type SupabaseServerClient } from "@/lib/supabase/server";
import { isRecordId } from "@/lib/validation";
import { generateTemporaryPassword } from "./password";
import {
  invitationSchema,
  passwordResetSchema,
  staffAccountSchema,
  staffSchema,
  staffStatusChangeSchema,
} from "./schemas";

const NOT_FOUND_MESSAGE = "This staff record no longer exists or you cannot change it.";

export async function createStaff(input: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("staff.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);

  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const departmentProblem = await checkDepartment(supabase, hospital.id, parsed.data.departmentId, null);
  if (departmentProblem) return departmentProblem;

  const { data, error } = await supabase
    .from("staff")
    .insert({ hospital_id: hospital.id, ...toStaffColumns(parsed.data) })
    .select("id")
    .single();
  if (error) return saveFailure(error);

  redirect(`/staff/${data.id}`);
}

export async function updateStaff(staffId: unknown, input: unknown): Promise<ActionResult> {
  const { hospital } = await requireHospitalScope("staff.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(staffId)) return actionFailure(NOT_FOUND_MESSAGE);

  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data: current, error: currentError } = await supabase
    .from("staff")
    .select("department_id")
    .eq("id", staffId)
    .eq("hospital_id", hospital.id)
    .maybeSingle();
  if (currentError) throw dataError("load staff member", currentError);
  if (!current) return actionFailure(NOT_FOUND_MESSAGE);

  const departmentProblem = await checkDepartment(supabase, hospital.id, parsed.data.departmentId, current.department_id);
  if (departmentProblem) return departmentProblem;

  const { data, error } = await supabase
    .from("staff")
    .update(toStaffColumns(parsed.data))
    .eq("id", staffId)
    .eq("hospital_id", hospital.id)
    .select("id")
    .maybeSingle();
  if (error) return saveFailure(error);
  if (!data) return actionFailure(NOT_FOUND_MESSAGE);

  refresh();
  return actionSuccess(null);
}

export async function changeStaffStatus(
  staffId: unknown,
  input: unknown,
): Promise<ActionResult<{ cancelledShifts: number }>> {
  const { hospital } = await requireHospitalScope("staff.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(staffId)) return actionFailure(NOT_FOUND_MESSAGE);

  const parsed = staffStatusChangeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { status, effectiveDate, reason } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("change_staff_status", {
    p_staff_id: staffId,
    p_status: status,
    p_reason: reason,
    p_effective_date: effectiveDate ?? undefined,
  });

  if (error) {
    switch (raisedErrorCode(error) ?? error.code) {
      case "STAFF_NOT_FOUND":
        return actionFailure(NOT_FOUND_MESSAGE);
      case "STATUS_UNCHANGED":
        return actionFailure("The staff member already has this status.");
      case "CANNOT_CHANGE_OWN_STATUS":
        return actionFailure("You cannot change your own employment status.");
      case "TERMINATION_DATE_REQUIRED":
        return actionFailure(CHECK_FIELDS_MESSAGE, { effectiveDate: ["Enter the date the termination took effect."] });
      case "TERMINATION_DATE_IN_FUTURE":
        return actionFailure(CHECK_FIELDS_MESSAGE, { effectiveDate: ["The termination date cannot be in the future."] });
      case "23514":
        return actionFailure(CHECK_FIELDS_MESSAGE, { effectiveDate: ["The termination date cannot be before the hire date."] });
      default:
        throw dataError("change staff status", error);
    }
  }

  refresh();
  return actionSuccess({ cancelledShifts: data });
}

/**
 * Sends (or resends) a Supabase invitation. The database authorizes the invitation
 * first; the secret key is used only to ask Supabase Auth to send the email.
 */
export async function inviteStaff(staffId: unknown, input: unknown): Promise<ActionResult<{ email: string }>> {
  const { hospital } = await requireHospitalScope("staff.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(staffId)) return actionFailure(NOT_FOUND_MESSAGE);

  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data: email, error } = await supabase.rpc("prepare_account_invitation", {
    p_staff_id: staffId,
    p_role: parsed.data.role,
  });

  if (error) {
    switch (raisedErrorCode(error)) {
      case "STAFF_NOT_FOUND":
        return actionFailure(NOT_FOUND_MESSAGE);
      case "STAFF_EMAIL_REQUIRED":
        return actionFailure("Add an email address to this staff record before sending an invitation.");
      case "STAFF_NOT_ACTIVE":
        return actionFailure("Only active staff can be invited.");
      case "ACCOUNT_ALREADY_ACTIVE":
        return actionFailure("This staff member has already activated their account.");
      case "EMAIL_IN_USE":
        return actionFailure("Another account already uses this email address.");
      default:
        throw dataError("prepare invitation", error);
    }
  }

  const { error: inviteError } = await supabaseAuthAdmin().inviteUserByEmail(email);
  if (inviteError) {
    switch (inviteError.code) {
      case "email_exists":
      case "user_already_exists":
        return actionFailure("An account with this email address has already been activated.");
      case "over_email_send_rate_limit":
      case "over_request_rate_limit":
        return actionFailure("Too many invitations have been sent recently. Try again later.");
      // Supabase's built-in email service only delivers to the project team's own
      // addresses; a project needs its own SMTP provider to invite anyone else.
      case "email_address_not_authorized":
        console.error("Supabase invitation rejected the address", { email, message: inviteError.message });
        return actionFailure("Sending to this address is not allowed yet. Set up an email (SMTP) provider in Supabase.");
      default:
        console.error("Supabase invitation failed", {
          code: inviteError.code,
          status: inviteError.status,
          message: inviteError.message,
        });
        return actionFailure("The invitation email could not be sent. Try again later.");
    }
  }

  refresh();
  return actionSuccess({ email });
}

/**
 * Creates the sign-in account directly, with a password the administrator hands over.
 * The database authorizes it first (the same pending invitation an email invite uses),
 * which also marks the account as having to choose its own password at first sign-in.
 */
export async function createStaffAccount(
  staffId: unknown,
  input: unknown,
): Promise<ActionResult<{ email: string; generatedPassword: string | null }>> {
  const { hospital } = await requireHospitalScope("staff.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(staffId)) return actionFailure(NOT_FOUND_MESSAGE);

  const parsed = staffAccountSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const generatedPassword = parsed.data.password === null ? generateTemporaryPassword() : null;
  const password = parsed.data.password ?? generatedPassword;

  const supabase = await createSupabaseServerClient();
  const { data: email, error } = await supabase.rpc("prepare_account_invitation", {
    p_staff_id: staffId,
    p_role: parsed.data.role,
    p_with_password: true,
  });

  if (error) {
    switch (raisedErrorCode(error)) {
      case "STAFF_NOT_FOUND":
        return actionFailure(NOT_FOUND_MESSAGE);
      case "STAFF_EMAIL_REQUIRED":
        return actionFailure("Add an email address to this staff record before creating an account.");
      case "STAFF_NOT_ACTIVE":
        return actionFailure("Only active staff can be given an account.");
      case "ACCOUNT_ALREADY_EXISTS":
        return actionFailure("This staff member already has a sign-in account.");
      case "EMAIL_IN_USE":
        return actionFailure("Another account already uses this email address.");
      default:
        throw dataError("prepare account", error);
    }
  }

  const { error: createError } = await supabaseAuthAdmin().createUser({
    email,
    password: password as string,
    email_confirm: true,
  });

  if (createError) {
    switch (createError.code) {
      case "email_exists":
      case "user_already_exists":
        return actionFailure("Another account already uses this email address.");
      case "weak_password":
        return actionFailure("That password is too weak or has appeared in a data breach. Choose a different one.");
      case "over_request_rate_limit":
        return actionFailure("Too many accounts have been created recently. Try again in a few minutes.");
      default:
        console.error("Supabase account creation failed", {
          code: createError.code,
          status: createError.status,
          message: createError.message,
        });
        return actionFailure("The account could not be created. Try again later.");
    }
  }

  refresh();
  return actionSuccess({ email, generatedPassword });
}

/**
 * Replaces a staff account password with one the administrator hands over. The
 * database authorizes the reset, and the account must choose its own password again.
 */
export async function resetStaffPassword(
  staffId: unknown,
  input: unknown,
): Promise<ActionResult<{ generatedPassword: string | null }>> {
  const { hospital } = await requireHospitalScope("staff.manage");
  if (!hospital) return actionFailure(NO_HOSPITAL_MESSAGE);
  if (!isRecordId(staffId)) return actionFailure(NOT_FOUND_MESSAGE);

  const parsed = passwordResetSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const generatedPassword = parsed.data === null ? generateTemporaryPassword() : null;
  const password = parsed.data ?? (generatedPassword as string);

  const supabase = await createSupabaseServerClient();
  const { data: userId, error } = await supabase.rpc("prepare_password_reset", { p_staff_id: staffId });
  if (error) return resetFailure(error);

  const { error: updateError } = await supabaseAuthAdmin().updateUserById(userId, { password });
  if (updateError) {
    switch (updateError.code) {
      case "weak_password":
        return actionFailure("That password is too weak or has appeared in a data breach. Choose a different one.");
      case "same_password":
        return actionFailure("Choose a password that is different from the current one.");
      case "over_request_rate_limit":
        return actionFailure("Too many changes recently. Try again in a few minutes.");
      default:
        console.error("Supabase password reset failed", {
          code: updateError.code,
          status: updateError.status,
          message: updateError.message,
        });
        return actionFailure("The password could not be changed. Try again later.");
    }
  }

  const { error: finishError } = await supabase.rpc("finish_password_reset", { p_staff_id: staffId });
  if (finishError) return resetFailure(finishError);

  refresh();
  return actionSuccess({ generatedPassword });
}

function resetFailure(error: PostgrestError): ActionFailure {
  switch (raisedErrorCode(error)) {
    case "STAFF_NOT_FOUND":
      return actionFailure(NOT_FOUND_MESSAGE);
    case "ACCOUNT_NOT_FOUND":
      return actionFailure("This staff member has no sign-in account yet.");
    case "CANNOT_RESET_OWN_ACCOUNT":
      return actionFailure("Change your own password from the account menu instead.");
    case "STAFF_NOT_ACTIVE":
      return actionFailure("Only active staff can have their password reset.");
    default:
      throw dataError("reset password", error);
  }
}

function toStaffColumns(values: z.output<typeof staffSchema>) {
  return {
    employee_number: values.employeeNumber,
    first_name: values.firstName,
    last_name: values.lastName,
    email: values.email,
    phone: values.phone,
    job_title: values.jobTitle,
    department_id: values.departmentId,
    employment_type: values.employmentType,
    hire_date: values.hireDate,
  };
}

/** Staff can join only active departments of the hospital (keeping an existing assignment is allowed). */
async function checkDepartment(
  supabase: SupabaseServerClient,
  hospitalId: string,
  departmentId: string,
  currentDepartmentId: string | null,
): Promise<ActionFailure | null> {
  const { data, error } = await supabase
    .from("departments")
    .select("is_active")
    .eq("id", departmentId)
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  if (error) throw dataError("check department", error);
  if (data && (data.is_active || departmentId === currentDepartmentId)) return null;
  return actionFailure(CHECK_FIELDS_MESSAGE, { departmentId: ["Select an active department."] });
}

function saveFailure(error: PostgrestError): ActionFailure {
  if (isUniqueViolation(error, "staff_hospital_employee_number_key")) {
    return actionFailure(CHECK_FIELDS_MESSAGE, { employeeNumber: ["Another staff member already has this employee number."] });
  }
  if (isUniqueViolation(error, "staff_hospital_email_key")) {
    return actionFailure(CHECK_FIELDS_MESSAGE, { email: ["Another staff member already uses this email address."] });
  }
  if (raisedErrorCode(error) === "EMAIL_LINKED_TO_ACCOUNT") {
    return actionFailure(CHECK_FIELDS_MESSAGE, {
      email: ["This staff member signs in with this email address, so it cannot be changed here."],
    });
  }
  throw dataError("save staff member", error);
}
