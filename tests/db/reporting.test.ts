import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { ids, seedTenants } from "./fixtures.ts";
import { actAs, actAsOwner, createTestDatabase, expectSqlError, inRollback, rows } from "./harness.ts";

const { users, staff, departments, hospitalA } = ids;

interface SummaryRow {
  staff_id: string;
  staff_name: string;
  department_name: string;
  recorded_days: number;
  present_count: number;
  late_count: number;
  absent_count: number;
  worked_minutes: number;
  overtime_minutes: number;
  missed_check_out_count: number;
}

interface DailyRow {
  work_date: string;
  present_count: number;
  absent_count: number;
}

let db: PGlite;

before(async () => {
  db = await createTestDatabase();
  await seedTenants(db);
});

after(async () => {
  await db.close();
});

/** Writes attendance records directly, standing in for scans on past days. */
async function seedAttendance(tx: Transaction): Promise<void> {
  await tx.query(
    `insert into public.attendance_records
       (hospital_id, staff_id, department_id, work_date, status, check_in_at, check_out_at,
        worked_minutes, overtime_minutes, late_minutes, flags, closed_at)
     values
       ($1, $2, $3, '2026-09-01', 'present', '2026-09-01T07:00Z', '2026-09-01T15:00Z', 480, 0, 0, '{unscheduled}', now()),
       ($1, $2, $3, '2026-09-02', 'late',    '2026-09-02T07:20Z', '2026-09-02T15:30Z', 490, 30, 20, '{unscheduled}', now()),
       ($1, $2, $3, '2026-09-03', 'absent',  null, null, null, 0, 0, '{unscheduled}', now()),
       ($1, $4, $5, '2026-09-01', 'present', '2026-09-01T07:05Z', null, null, 0, 5, '{unscheduled,missed_check_out}', now())`,
    [hospitalA, staff.nurseA, departments.emergencyA, staff.midwifeA, departments.maternityA],
  );
}

async function summaryFor(tx: Transaction, actor: string, departmentId: string | null = null): Promise<SummaryRow[]> {
  await actAs(tx, actor);
  const [{ result }] = await rows<{ result: SummaryRow[] }>(
    tx,
    "select public.report_attendance_summary($1, '2026-09-01', '2026-09-30', $2) as result",
    [hospitalA, departmentId],
  );
  await actAsOwner(tx);
  return result;
}

describe("attendance summary report", () => {
  test("counts each status and totals the minutes", async () => {
    await inRollback(db, async (tx) => {
      await seedAttendance(tx);
      const summary = await summaryFor(tx, users.adminA);

      const nurse = summary.find((row) => row.staff_id === staff.nurseA);
      assert.deepEqual(
        {
          recorded_days: nurse?.recorded_days,
          present_count: nurse?.present_count,
          late_count: nurse?.late_count,
          absent_count: nurse?.absent_count,
          worked_minutes: nurse?.worked_minutes,
          overtime_minutes: nurse?.overtime_minutes,
        },
        { recorded_days: 3, present_count: 1, late_count: 1, absent_count: 1, worked_minutes: 970, overtime_minutes: 30 },
      );

      const midwife = summary.find((row) => row.staff_id === staff.midwifeA);
      assert.equal(midwife?.missed_check_out_count, 1);
      assert.equal(midwife?.department_name, "Maternity");
    });
  });

  test("the report shows only what the caller may see", async () => {
    await inRollback(db, async (tx) => {
      await seedAttendance(tx);

      assert.equal((await summaryFor(tx, users.adminA)).length, 2, "hospital admin sees both");
      assert.deepEqual(
        (await summaryFor(tx, users.headA)).map((row) => row.staff_id),
        [staff.nurseA],
        "department head sees their department",
      );
      assert.deepEqual(
        (await summaryFor(tx, users.nurseA)).map((row) => row.staff_id),
        [staff.nurseA],
        "staff see themselves",
      );
      assert.deepEqual(await summaryFor(tx, users.adminB), [], "another hospital sees nothing");
    });
  });

  test("filters by department", async () => {
    await inRollback(db, async (tx) => {
      await seedAttendance(tx);
      const summary = await summaryFor(tx, users.adminA, departments.maternityA);
      assert.deepEqual(
        summary.map((row) => row.staff_id),
        [staff.midwifeA],
      );
    });
  });

  test("daily totals drive the chart", async () => {
    await inRollback(db, async (tx) => {
      await seedAttendance(tx);
      await actAs(tx, users.adminA);
      const [{ result }] = await rows<{ result: DailyRow[] }>(
        tx,
        "select public.report_attendance_by_day($1, '2026-09-01', '2026-09-30', null) as result",
        [hospitalA],
      );
      assert.deepEqual(
        result.map((row) => ({ date: row.work_date, present: row.present_count, absent: row.absent_count })),
        [
          { date: "2026-09-01", present: 2, absent: 0 },
          { date: "2026-09-02", present: 0, absent: 0 },
          { date: "2026-09-03", present: 0, absent: 1 },
        ],
      );
    });
  });

  test("an empty range returns an empty report, not an error", async () => {
    await inRollback(db, async (tx) => {
      assert.deepEqual(await summaryFor(tx, users.adminA), []);
    });
  });

  test("anonymous callers cannot run reports", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, null, "anon");
      await expectSqlError(
        tx,
        "select public.report_attendance_summary($1, '2026-09-01', '2026-09-30', null)",
        { code: "42501", message: "permission denied" },
        [hospitalA],
      );
    });
  });
});

describe("audit log viewer", () => {
  test("shows entries with the actor's name, scoped to the hospital", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await tx.query("update public.staff set job_title = 'Senior Staff Nurse' where id = $1", [staff.nurseA]);

      const [entry] = await rows<{ actor_name: string; action: string; entity_table: string }>(
        tx,
        `select actor_name, action, entity_table from public.audit_log_entries
         where entity_table = 'staff' and entity_id = $1 order by id desc limit 1`,
        [staff.nurseA],
      );
      assert.deepEqual(entry, { actor_name: "KGH HR Office", action: "update", entity_table: "staff" });

      await actAs(tx, users.adminB);
      assert.deepEqual(await rows(tx, "select id from public.audit_log_entries where hospital_id = $1", [hospitalA]), []);

      await actAs(tx, users.nurseA);
      assert.deepEqual(await rows(tx, "select id from public.audit_log_entries"), []);
    });
  });
});

describe("correction evidence", () => {
  /** An absence the staff member can ask to have corrected. */
  async function absence(tx: Transaction): Promise<string> {
    const [{ id }] = await rows<{ id: string }>(
      tx,
      `insert into public.attendance_records
         (hospital_id, staff_id, department_id, work_date, status, flags, closed_at)
       values ($1, $2, $3, '2026-09-10', 'absent', '{unscheduled}', now())
       returning id`,
      [hospitalA, staff.nurseA, departments.emergencyA],
    );
    return id;
  }

  test("a correction stores evidence from the staff member's own folder", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await absence(tx);
      const evidencePath = `${hospitalA}/${staff.nurseA}/photo.jpg`;

      await actAs(tx, users.nurseA);
      const [{ id }] = await rows<{ id: string }>(
        tx,
        `select public.request_attendance_correction($1, 'The terminal was broken that morning',
           '2026-09-10T07:05:00Z', '2026-09-10T15:00:00Z', $2) as id`,
        [recordId, evidencePath],
      );

      await actAsOwner(tx);
      assert.deepEqual(await rows(tx, "select evidence_path from public.attendance_corrections where id = $1", [id]), [
        { evidence_path: evidencePath },
      ]);
    });
  });

  test("evidence belonging to someone else is refused", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await absence(tx);
      await actAs(tx, users.nurseA);
      await expectSqlError(
        tx,
        `select public.request_attendance_correction($1, 'The terminal was broken that morning',
           '2026-09-10T07:05:00Z', null, $2)`,
        { code: "42501", message: "ATTACHMENT_NOT_ALLOWED" },
        [recordId, `${hospitalA}/${staff.midwifeA}/photo.jpg`],
      );
    });
  });

  test("evidence paths must follow the hospital and staff folder shape", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await absence(tx);
      await expectSqlError(
        tx,
        `insert into public.attendance_corrections
           (hospital_id, attendance_record_id, staff_id, department_id, requested_check_in_at, reason, requested_by, evidence_path)
         values ($1, $2, $3, $4, '2026-09-10T07:05:00Z', 'The terminal was broken', $5, '../secrets.pdf')`,
        { code: "23514" },
        [hospitalA, recordId, staff.nurseA, departments.emergencyA, users.nurseA],
      );
    });
  });
});
