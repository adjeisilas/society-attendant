import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NoHospitalState } from "@/components/no-hospital-state";
import { PageHeader } from "@/components/page-header/page-header";
import { Badge } from "@/components/ui/badge";
import { DescriptionList } from "@/components/ui/description-list";
import { Panel } from "@/components/ui/panel";
import { listDepartmentOptions } from "@/features/departments/queries";
import { StaffAccount } from "@/features/staff/components/staff-account";
import { StaffForm } from "@/features/staff/components/staff-form";
import { StaffStatusForm } from "@/features/staff/components/staff-status-form";
import { ACCOUNT_STATE, EMPLOYMENT_TYPE_LABELS, STAFF_STATUS } from "@/features/staff/labels";
import { getStaffMember } from "@/features/staff/queries";
import { formatIsoDate, formatTimestamp } from "@/lib/dates";
import { requireHospitalScope } from "@/lib/hospital-context";
import { isRecordId } from "@/lib/validation";
import styles from "../staff.module.css";

export const metadata: Metadata = { title: "Staff member" };

export default async function StaffMemberPage({ params }: { params: Promise<{ staffId: string }> }) {
  const { staffId } = await params;
  const { user, hospital } = await requireHospitalScope(["staff.manage", "staff.viewDepartment"]);
  if (!hospital) return <NoHospitalState />;
  if (!isRecordId(staffId)) notFound();

  const member = await getStaffMember(hospital.id, staffId);
  if (!member) notFound();

  const canManage = user.capabilities.has("staff.manage");
  const status = STAFF_STATUS[member.status];
  const header = (
    <PageHeader
      title={member.fullName}
      meta={<Badge tone={status.tone}>{status.label}</Badge>}
      description={`${member.employeeNumber} · ${member.jobTitle} · ${member.departmentName}`}
      back={{ href: "/staff", label: "Staff" }}
    />
  );

  const employmentItems = [
    { term: "Employment type", value: EMPLOYMENT_TYPE_LABELS[member.employmentType] },
    { term: "Hire date", value: formatIsoDate(member.hireDate) },
    ...(member.terminationDate ? [{ term: "Termination date", value: formatIsoDate(member.terminationDate) }] : []),
  ];

  if (!canManage) {
    return (
      <>
        {header}
        <Panel title="Staff details" flush>
          <DescriptionList
            items={[
              { term: "Department", value: member.departmentName },
              { term: "Job title", value: member.jobTitle },
              ...employmentItems,
              { term: "Email", value: member.email ?? "Not recorded" },
              { term: "Phone", value: member.phone ?? "Not recorded" },
            ]}
          />
        </Panel>
      </>
    );
  }

  const departments = await listDepartmentOptions(hospital.id);
  const departmentOptions = departments
    .filter((department) => department.isActive || department.id === member.departmentId)
    .map((department) => ({
      value: department.id,
      label: department.isActive ? department.name : `${department.name} (inactive)`,
    }));
  const account = ACCOUNT_STATE[member.accountState];

  return (
    <>
      {header}
      <div className={styles.layout}>
        <Panel title="Staff details">
          <StaffForm
            staffId={member.id}
            departmentOptions={departmentOptions}
            emailLocked={member.accountState !== "none"}
            defaultValues={{
              employeeNumber: member.employeeNumber,
              firstName: member.firstName,
              lastName: member.lastName,
              email: member.email ?? "",
              phone: member.phone ?? "",
              jobTitle: member.jobTitle,
              departmentId: member.departmentId,
              employmentType: member.employmentType,
              hireDate: member.hireDate,
            }}
          />
        </Panel>

        <div className={styles.aside}>
          <Panel title="Sign-in account" actions={<Badge tone={account.tone}>{account.label}</Badge>}>
            <StaffAccount
              staffId={member.id}
              state={member.accountState}
              role={member.accountRole}
              email={member.email}
              isActiveStaff={member.status === "active"}
              activatedAtLabel={
                member.accountActivatedAt ? formatTimestamp(member.accountActivatedAt, hospital.timezone) : null
              }
            />
          </Panel>

          <Panel title="Employment status" flush>
            <DescriptionList items={[{ term: "Current status", value: status.label }, ...employmentItems]} />
          </Panel>

          <Panel title="Change status" description="Suspend, terminate or reactivate this staff record.">
            <StaffStatusForm staffId={member.id} currentStatus={member.status} />
          </Panel>
        </div>
      </div>
    </>
  );
}
