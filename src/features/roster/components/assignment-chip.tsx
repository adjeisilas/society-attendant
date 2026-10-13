"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cx } from "@/lib/class-names";
import { cancelAssignment } from "../actions";
import type { RosterAssignment } from "../queries";
import styles from "./roster.module.css";

interface AssignmentChipProps {
  assignment: RosterAssignment;
  staffName: string;
  dateLabel: string;
  canCancel: boolean;
}

export function AssignmentChip({ assignment, staffName, dateLabel, canCancel }: AssignmentChipProps) {
  const content = (
    <>
      <span className={styles.chipCode}>{assignment.shiftCode}</span>
      <span className={styles.chipTimes}>{assignment.timesLabel}</span>
    </>
  );

  if (!canCancel) {
    return (
      <span className={styles.chip} title={assignment.shiftName}>
        {content}
      </span>
    );
  }

  return (
    <ConfirmDialog
      title="Cancel this rostered shift?"
      description={
        <>
          {staffName} · {assignment.shiftName} ({assignment.timesLabel}) on {dateLabel}. The cancellation is recorded in
          the audit log.
        </>
      }
      confirmLabel="Cancel shift"
      dismissLabel="Keep shift"
      tone="danger"
      onConfirm={async () => {
        const result = await cancelAssignment(assignment.id);
        return result.ok ? null : result.message;
      }}
      renderTrigger={(open) => (
        <button
          type="button"
          className={cx(styles.chip, styles.chipButton)}
          onClick={open}
          aria-label={`${assignment.shiftName}, ${assignment.timesLabel}, ${staffName}, ${dateLabel}. Cancel this shift`}
        >
          {content}
        </button>
      )}
    />
  );
}
