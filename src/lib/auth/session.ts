import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { capabilitiesFor, type AccessProfile, type AppRole, type Capability } from "@/lib/auth/permissions";
import { routes } from "@/lib/auth/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface HospitalSummary {
  id: string;
  name: string;
  code: string;
  timezone: string;
}

export interface SessionUser {
  userId: string;
  email: string | null;
  displayName: string;
  role: AppRole;
  access: AccessProfile;
  capabilities: ReadonlySet<Capability>;
  hospital: HospitalSummary | null;
  /** The account was created with an administrator-set password and must replace it. */
  mustChangePassword: boolean;
  staff: { id: string; departmentId: string; fullName: string; jobTitle: string; employeeNumber: string } | null;
  headedDepartments: { id: string; name: string }[];
}

export type SessionState =
  | { status: "signed_out" }
  | { status: "inactive"; email: string | null }
  | { status: "active"; user: SessionUser };

/**
 * Resolves the current user and their authorization context. Every read runs under
 * RLS as that user, so deactivated accounts and hospitals are reflected immediately.
 * Memoized for the duration of a request.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (claimsError || !userId) {
    return { status: "signed_out" };
  }
  const email = claimsData.claims.email ?? null;

  const [profileResult, staffResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("role, hospital_id, display_name, is_active, must_change_password")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("staff")
      .select("id, department_id, first_name, last_name, job_title, employee_number")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const profile = unwrap(profileResult, "profile");
  const staff = unwrap(staffResult, "staff record");

  if (!profile?.is_active) {
    return { status: "inactive", email };
  }

  const [hospitalResult, departmentsResult] = await Promise.all([
    profile.hospital_id
      ? supabase.from("hospitals").select("id, name, code, timezone").eq("id", profile.hospital_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    staff
      ? supabase.from("departments").select("id, name").eq("head_staff_id", staff.id).eq("is_active", true).order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const hospital = unwrap(hospitalResult, "hospital");
  const headedDepartments = unwrap(departmentsResult, "departments") ?? [];

  // RLS hides inactive hospitals and non-active staff records, which leaves the account unusable.
  const hospitalUnavailable = profile.role !== "super_admin" && !hospital;
  const staffRecordUnavailable = profile.role === "staff" && !staff;
  if (hospitalUnavailable || staffRecordUnavailable) {
    return { status: "inactive", email };
  }

  const access: AccessProfile = {
    role: profile.role,
    isActive: true,
    hasStaffRecord: staff !== null,
    headedDepartmentCount: headedDepartments.length,
  };

  return {
    status: "active",
    user: {
      userId,
      email,
      displayName: profile.display_name,
      role: profile.role,
      access,
      capabilities: capabilitiesFor(access),
      hospital,
      mustChangePassword: profile.must_change_password,
      staff: staff && {
        id: staff.id,
        departmentId: staff.department_id,
        fullName: `${staff.first_name} ${staff.last_name}`,
        jobTitle: staff.job_title,
        employeeNumber: staff.employee_number,
      },
      headedDepartments,
    },
  };
});

/** Returns the active user, or redirects to sign in / the account-disabled page. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSessionState();
  if (session.status === "signed_out") redirect(routes.signIn);
  if (session.status === "inactive") redirect(routes.accountDisabled);
  return session.user;
}

/** Returns the active user when they hold any of the capabilities; otherwise responds with 404. */
export async function requireCapability(capability: Capability | readonly Capability[]): Promise<SessionUser> {
  const user = await requireUser();
  const accepted: readonly Capability[] = typeof capability === "string" ? [capability] : capability;
  if (!accepted.some((candidate) => user.capabilities.has(candidate))) notFound();
  return user;
}

function unwrap<T>(result: { data: T; error: PostgrestError | null }, description: string): T {
  if (result.error) {
    throw new Error(`Could not load ${description}: ${result.error.message}`);
  }
  return result.data;
}
