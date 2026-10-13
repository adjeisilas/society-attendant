import { cx } from "@/lib/class-names";
import { formatIsoDate } from "@/lib/dates";
import { rosterCellKey, type RosterWeek } from "../queries";
import { AssignmentChip } from "./assignment-chip";
import styles from "./roster.module.css";

interface RosterGridProps {
  week: RosterWeek;
  /** Today's date in the hospital's time zone. */
  today: string;
  canManage: boolean;
}

export function RosterGrid({ week, today, canManage }: RosterGridProps) {
  return (
    <div className={styles.wrapper}>
      <table className={styles.grid}>
        <caption className="visually-hidden">Weekly roster by staff member</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.staffHeader}>
              Staff
            </th>
            {week.days.map((day) => (
              <th key={day} scope="col" className={cx(styles.dayHeader, day === today && styles.today)}>
                <span className={styles.dayName}>{formatIsoDate(day, "EEE")}</span>
                <span className={styles.dayDate}>{formatIsoDate(day, "d MMM")}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {week.staff.map((member) => (
            <tr key={member.id}>
              <th scope="row" className={styles.staffCell}>
                <span className={styles.staffName}>{member.fullName}</span>
                <span className={styles.staffMeta}>{member.jobTitle}</span>
              </th>
              {week.days.map((day) => {
                const assignments = week.assignmentsByCell[rosterCellKey(member.id, day)] ?? [];
                return (
                  <td key={day} className={cx(styles.cell, day === today && styles.today)}>
                    {assignments.map((assignment) => (
                      <AssignmentChip
                        key={assignment.id}
                        assignment={assignment}
                        staffName={member.fullName}
                        dateLabel={formatIsoDate(day, "EEE d MMM")}
                        canCancel={canManage}
                      />
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
