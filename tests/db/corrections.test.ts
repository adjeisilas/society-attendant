import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { ids, seedTenants } from "./fixtures.ts";
import { actAs, actAsOwner, createTestDatabase, expectSqlError, inRollback, rows } from "./harness.ts";

const { users, staff, departments, hospitalA } = ids;

let db: PGlite;

before(async () => {
  db = await createTestDatabase();
  await seedTenants(db);
});

after(async () => {
  await db.close();
});

/** Creates an absence for a past shift, the way the scheduled job does. */
async function recordAbsence(tx: Transaction, staffId: string, workDate: string): Promise<string> {
  const [{ id }] = await rows<{ id: string }>(
    tx,
    // Mirrors the scheduled job: the record snapshots the shift's policy values.
    `with new_shift as (
       insert into public.shifts (hospital_id, name, code, start_time, duration_minutes)
       values ($1, 'Absence ' || $3, upper(left(md5(random()::text), 6)), '07:00', 480)
       returning id, break_minutes, late_grace_minutes, early_leave_grace_minutes, overtime_threshold_minutes
     ),
     new_assignment as (
       insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date)
       select $1, $2, new_shift.id, $3::date from new_shift
       returning id, shift_id, starts_at, ends_at
     )
     insert into public.attendance_records (
       hospital_id, staff_id, department_id, shift_assignment_id, work_date,
       scheduled_start, scheduled_end, break_minutes, late_grace_minutes, early_leave_grace_minutes,
       overtime_threshold_minutes, half_day_threshold_percent, status, closed_at
     )
     select $1, $2, s.department_id, new_assignment.id, $3::date,
            new_assignment.starts_at, new_assignment.ends_at,
            new_shift.break_minutes, new_shift.late_grace_minutes, new_shift.early_leave_grace_minutes,
            new_shift.overtime_threshold_minutes, hs.half_day_threshold_percent, 'absent', now()
     from new_assignment
     join new_shift on new_shift.id = new_assignment.shift_id
     join public.staff s on s.id = $2
     join public.hospital_settings hs on hs.hospital_id = $1
     returning id`,
    [hospitalA, staffId, workDate],
  );
  return id;
}

describe("attendance corrections", () => {
  test("a staff member requests a correction and administrators are notified", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await recordAbsence(tx, staff.nurseA, "2026-09-10");

      await actAs(tx, users.nurseA);
      const [{ id }] = await rows<{ id: string }>(
        tx,
        `select public.request_attendance_correction($1, 'I worked the shift but the scanner was broken',
           '2026-09-10T07:05:00Z', '2026-09-10T15:02:00Z') as id`,
        [recordId],
      );

      await actAsOwner(tx);
      assert.deepEqual(
        await rows(tx, "select status, staff_id, department_id, requested_by from public.attendance_corrections where id = $1", [id]),
        [{ status: "pending", staff_id: staff.nurseA, department_id: departments.emergencyA, requested_by: users.nurseA }],
      );
      assert.ok(
        (await rows(tx, "select id from public.notifications where type = 'correction_submitted'")).length >= 1,
      );
    });
  });

  test("approving a correction applies the times and recomputes the status", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await recordAbsence(tx, staff.nurseA, "2026-09-10");
      await actAs(tx, users.nurseA);
      const [{ id }] = await rows<{ id: string }>(
        tx,
        `select public.request_attendance_correction($1, 'I worked the shift but the scanner was broken',
           (select scheduled_start + interval '5 minutes' from public.attendance_records where id = $1),
           (select scheduled_end from public.attendance_records where id = $1)) as id`,
        [recordId],
      );

      await actAs(tx, users.adminA);
      await tx.query("select public.review_attendance_correction($1, true, 'Confirmed with the ward manager')", [id]);

      await actAsOwner(tx);
      assert.deepEqual(
        await rows(
          tx,
          `select status, late_minutes, worked_minutes, is_late, last_correction_id, closed_at is not null as closed
           from public.attendance_records where id = $1`,
          [recordId],
        ),
        [{ status: "present", late_minutes: 5, worked_minutes: 475, is_late: false, last_correction_id: id, closed: true }],
      );

      const [entry] = await rows(
        tx,
        `select reason, actor_id from public.audit_logs
         where entity_table = 'attendance_records' and entity_id = $1 order by id desc limit 1`,
        [recordId],
      );
      assert.deepEqual(entry, { reason: "Confirmed with the ward manager", actor_id: users.adminA });
    });
  });

  test("an approved correction clears a missing check-out flag", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await recordAbsence(tx, staff.nurseA, "2026-09-10");
      await tx.query(
        `update public.attendance_records
         set status = 'present', check_in_at = scheduled_start, flags = '{missed_check_out}'
         where id = $1`,
        [recordId],
      );

      await actAs(tx, users.nurseA);
      const [{ id }] = await rows<{ id: string }>(
        tx,
        `select public.request_attendance_correction($1, 'I forgot to scan when leaving the ward', null,
           (select scheduled_end from public.attendance_records where id = $1)) as id`,
        [recordId],
      );
      await actAs(tx, users.adminA);
      await tx.query("select public.review_attendance_correction($1, true, null)", [id]);

      await actAsOwner(tx);
      assert.deepEqual(
        await rows(tx, "select flags::text[] as flags, check_out_at is not null as checked_out from public.attendance_records where id = $1", [
          recordId,
        ]),
        [{ flags: [], checked_out: true }],
      );
    });
  });

  test("rejects impossible corrections and duplicates", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await recordAbsence(tx, staff.nurseA, "2026-09-10");
      await actAs(tx, users.nurseA);

      await expectSqlError(
        tx,
        "select public.request_attendance_correction($1, 'The scanner was broken that morning', null, null)",
        { code: "22023", message: "TIMES_REQUIRED" },
        [recordId],
      );
      await expectSqlError(
        tx,
        "select public.request_attendance_correction($1, 'too short', '2026-09-10T07:05:00Z', null)",
        { code: "22023", message: "REASON_REQUIRED" },
        [recordId],
      );
      await expectSqlError(
        tx,
        "select public.request_attendance_correction($1, 'Recording a future shift somehow', now() + interval '2 days', null)",
        { code: "22023", message: "TIME_IN_FUTURE" },
        [recordId],
      );

      await tx.query(
        "select public.request_attendance_correction($1, 'I worked the shift but the scanner was broken', '2026-09-10T07:05:00Z', null)",
        [recordId],
      );
      await expectSqlError(
        tx,
        "select public.request_attendance_correction($1, 'Second attempt at the same record', '2026-09-10T07:10:00Z', null)",
        { code: "22023", message: "CORRECTION_ALREADY_PENDING" },
        [recordId],
      );
    });
  });

  test("department heads cannot review corrections; administrators can", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await recordAbsence(tx, staff.nurseA, "2026-09-10");
      await actAs(tx, users.nurseA);
      const [{ id }] = await rows<{ id: string }>(
        tx,
        "select public.request_attendance_correction($1, 'I worked the shift but the scanner was broken', '2026-09-10T07:05:00Z', null) as id",
        [recordId],
      );

      for (const actor of [users.headA, users.nurseA, users.adminB]) {
        await actAs(tx, actor);
        await expectSqlError(
          tx,
          "select public.review_attendance_correction($1, true, null)",
          { code: "P0002", message: "REQUEST_NOT_FOUND" },
          [id],
        );
      }

      await actAs(tx, users.adminA);
      await tx.query("select public.review_attendance_correction($1, false, 'No evidence of attendance that day')", [id]);
      await actAsOwner(tx);
      assert.deepEqual(await rows(tx, "select status from public.attendance_corrections where id = $1", [id]), [
        { status: "rejected" },
      ]);
    });
  });

  test("a rejected correction leaves the record untouched", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await recordAbsence(tx, staff.nurseA, "2026-09-10");
      await actAs(tx, users.nurseA);
      const [{ id }] = await rows<{ id: string }>(
        tx,
        "select public.request_attendance_correction($1, 'I worked the shift but the scanner was broken', '2026-09-10T07:05:00Z', null) as id",
        [recordId],
      );
      await actAs(tx, users.adminA);
      await tx.query("select public.review_attendance_correction($1, false, 'No evidence of attendance that day')", [id]);

      await actAsOwner(tx);
      assert.deepEqual(
        await rows(tx, "select status, check_in_at, last_correction_id from public.attendance_records where id = $1", [recordId]),
        [{ status: "absent", check_in_at: null, last_correction_id: null }],
      );
    });
  });

  test("the requester can withdraw a correction while it is pending", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await recordAbsence(tx, staff.nurseA, "2026-09-10");
      await actAs(tx, users.nurseA);
      const [{ id }] = await rows<{ id: string }>(
        tx,
        "select public.request_attendance_correction($1, 'I worked the shift but the scanner was broken', '2026-09-10T07:05:00Z', null) as id",
        [recordId],
      );
      await tx.query("select public.cancel_attendance_correction($1)", [id]);

      await actAsOwner(tx);
      assert.deepEqual(await rows(tx, "select status from public.attendance_corrections where id = $1", [id]), [
        { status: "cancelled" },
      ]);
    });
  });
});

describe("notifications", () => {
  test("recipients read and mark only their own", async () => {
    await inRollback(db, async (tx) => {
      const recordId = await recordAbsence(tx, staff.nurseA, "2026-09-12");
      await actAs(tx, users.nurseA);
      await tx.query("select public.request_attendance_correction($1, 'My clock-in was not recorded that morning', '2026-09-12T07:02:00Z')", [
        recordId,
      ]);

      await actAs(tx, users.adminA);
      const [{ count }] = await rows<{ count: number }>(tx, "select count(*)::int as count from public.notifications");
      assert.equal(count, 1);
      const updated = await tx.query("update public.notifications set read_at = now() where read_at is null");
      assert.equal(updated.affectedRows, 1);

      await actAs(tx, users.nurseB);
      assert.deepEqual(await rows(tx, "select id from public.notifications"), []);

      await actAs(tx, users.adminA);
      await expectSqlError(
        tx,
        "insert into public.notifications (recipient_id, type, title) values ($1, 'correction_submitted', 'Forged')",
        { code: "42501", message: "permission denied" },
        [users.adminA],
      );
      await expectSqlError(
        tx,
        "update public.notifications set title = 'Changed'",
        { code: "42501", message: "permission denied" },
      );
    });
  });
});
