import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../auth/schemas.ts";
import { isoDate, optionalEmailAddress, recordId } from "../../lib/validation.ts";
import { Constants } from "../../types/database.ts";

const { employment_type: EMPLOYMENT_TYPES, staff_status: STAFF_STATUSES } = Constants.public.Enums;

export const staffSchema = z.object({
  employeeNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9/._-]{1,30}$/, "Use up to 30 letters, numbers or the characters / . _ -"),
  firstName: z.string().trim().min(1, "Enter the first name.").max(100, "Use 100 characters or fewer."),
  lastName: z.string().trim().min(1, "Enter the last name.").max(100, "Use 100 characters or fewer."),
  email: optionalEmailAddress,
  phone: z
    .string()
    .trim()
    .max(30, "Use 30 characters or fewer.")
    .regex(/^[0-9+()\-\s]*$/, "Use digits, spaces and + ( ) - only.")
    .transform((value) => value || null),
  jobTitle: z.string().trim().min(2, "Enter the job title.").max(120, "Use 120 characters or fewer."),
  departmentId: recordId("Select a department."),
  employmentType: z.enum(EMPLOYMENT_TYPES, "Select an employment type."),
  hireDate: isoDate("Enter the hire date."),
});

export type StaffFormInput = z.input<typeof staffSchema>;

export const staffStatusChangeSchema = z
  .object({
    status: z.enum(STAFF_STATUSES, "Select a new status."),
    effectiveDate: z.union([z.literal(""), z.iso.date("Enter a valid date.")]).transform((value) => value || null),
    reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500, "Use 500 characters or fewer."),
  })
  .refine((values) => values.status !== "terminated" || values.effectiveDate !== null, {
    path: ["effectiveDate"],
    message: "Enter the date the termination took effect.",
  });

export type StaffStatusChangeInput = z.input<typeof staffStatusChangeSchema>;

export const INVITABLE_ROLES = ["staff", "hospital_admin"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const invitationSchema = z.object({
  role: z.enum(INVITABLE_ROLES, "Select a role."),
});

export const PASSWORD_MODES = ["generate", "manual"] as const;

/**
 * Creating a sign-in account with a password the administrator hands over.
 * A generated password ignores the password field.
 */
export const staffAccountSchema = z
  .object({
    role: z.enum(INVITABLE_ROLES, "Select a role."),
    mode: z.enum(PASSWORD_MODES, "Choose how to set the password."),
    password: z.string().max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`),
  })
  .refine((values) => values.mode !== "manual" || values.password.length >= PASSWORD_MIN_LENGTH, {
    path: ["password"],
    message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .transform((values) => ({ role: values.role, password: values.mode === "manual" ? values.password : null }));

export type StaffAccountInput = z.input<typeof staffAccountSchema>;

/** Replacing an existing account password; the role never changes here. */
export const passwordResetSchema = z
  .object({
    mode: z.enum(PASSWORD_MODES, "Choose how to set the password."),
    password: z.string().max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`),
  })
  .refine((values) => values.mode !== "manual" || values.password.length >= PASSWORD_MIN_LENGTH, {
    path: ["password"],
    message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .transform((values) => (values.mode === "manual" ? values.password : null));

export const STAFF_PAGE_SIZE = 25;

/** Parses list filters from the URL; invalid values fall back to defaults. */
export const staffFiltersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  department: z.union([z.uuid(), z.literal("")]).catch(""),
  status: z.enum(["all", ...STAFF_STATUSES]).catch("active"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type StaffFilters = z.output<typeof staffFiltersSchema>;
