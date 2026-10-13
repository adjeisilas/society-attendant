import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { ids, seedTenants } from "./fixtures.ts";
import { actAs, actAsOwner, affectedRows, createTestDatabase, expectSqlError, inRollback, rows } from "./harness.ts";

const { users, staff, hospitalA } = ids;

const shifts = {
  day: "0a000000-0000-4000-8000-0000000005d1",
  evening: "0a000000-0000-4000-8000-0000000005e1",
  twilight: "0a000000-0000-4000-8000-0000000005f1",
  night: "0a000000-0000-4000-8000-0000000005a1",
};

interface AssignmentRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
}

let db: PGlite;

before(async () => {
  db = await createTestDatabase();
  await seedTenants(db);
  await db.exec(`
    insert into public.shifts (id, hospital_id, name, code, start_time, duration_minutes, break_minutes) values
      ('${shifts.day}',      '${hospitalA}', 'Day',      'D', '07:00', 480, 30),
      ('${shifts.evening}',  '${hospitalA}', 'Evening',  'E', '15:00', 480, 30),
      ('${shifts.twilight}', '${hospitalA}', 'Twilight', 'T', '19:00', 480, 30),
      ('${shifts.night}',    '${hospitalA}', 'Night',    'N', '23:00', 480, 30);
  `);
});

after(async () => {
  await db.close();
});

async function assign(tx: Transaction, staffId: string, shiftId: string, workDate: string, hospitalId: string = hospitalA) {
  const [row] = await rows<AssignmentRow>(
    tx,
    `insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date)
     values ($1, $2, $3, $4)
     returning id, starts_at, ends_at`,
    [hospitalId, staffId, shiftId, workDate],
  );
  return row;
}

describe("schedule times", () => {
  test("night shifts cross midnight and end on the following day", async () => {
    await inRollback(db, async (tx) => {
      const flags = await rows(tx, "select code, crosses_midnight from public.shifts where hospital_id = $1 order by code", [
        hospitalA,
      ]);
      assert.deepEqual(flags, [
        { code: "D", crosses_midnight: false },
        { code: "E", crosses_midnight: false },
        { code: "N", crosses_midnight: true },
        { code: "T", crosses_midnight: true },
      ]);

      await actAs(tx, users.adminA);
      const night = await assign(tx, staff.nurseA, shifts.night, "2099-01-10");
      assert.equal(night.starts_at.toISOString(), "2099-01-10T23:00:00.000Z");
      assert.equal(night.ends_at.toISOString(), "2099-01-11T07:00:00.000Z");
    });
  });

  test("times follow wall-clock time in the hospital time zone across DST changes", async () => {
    await inRollback(db, async (tx) => {
      const [{ id: hospitalId }] = await rows<{ id: string }>(
        tx,
        "insert into public.hospitals (name, code, timezone) values ('London Test Hospital', 'LTH', 'Europe/London') returning id",
      );
      const [{ id: departmentId }] = await rows<{ id: string }>(
        tx,
        "insert into public.departments (hospital_id, name, code) values ($1, 'Acute Medicine', 'AMU') returning id",
        [hospitalId],
      );
      const [{ id: staffId }] = await rows<{ id: string }>(
        tx,
        `insert into public.staff (hospital_id, department_id, employee_number, first_name, last_name, job_title, employment_type, hire_date)
         values ($1, $2, 'LTH-001', 'Sam', 'Reid', 'Registrar', 'full_time', '2020-01-01') returning id`,
        [hospitalId, departmentId],
      );
      const [{ id: shiftId }] = await rows<{ id: string }>(
        tx,
        "insert into public.shifts (hospital_id, name, code, start_time, duration_minutes) values ($1, 'Night', 'N', '23:00', 480) returning id",
        [hospitalId],
      );

      // Clocks go back at 02:00 BST on 2026-10-25: 23:00 BST -> 07:00 GMT is nine real hours.
      const row = await assign(tx, staffId, shiftId, "2026-10-24", hospitalId);
      assert.equal(row.starts_at.toISOString(), "2026-10-24T22:00:00.000Z");
      assert.equal(row.ends_at.toISOString(), "2026-10-25T07:00:00.000Z");
    });
  });

  test("schedule times cannot be supplied or edited by the client", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      const [row] = await rows<AssignmentRow>(
        tx,
        `insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date, starts_at, ends_at)
         values ($1, $2, $3, '2099-03-01', '2000-01-01T00:00Z', '2000-01-02T00:00Z')
         returning id, starts_at, ends_at`,
        [hospitalA, staff.nurseA, shifts.day],
      );
      assert.equal(row.starts_at.toISOString(), "2099-03-01T07:00:00.000Z");

      await expectSqlError(
        tx,
        "update public.shift_assignments set starts_at = '2099-03-01T09:00Z' where id = $1",
        { code: "42501", message: "permission denied" },
        [row.id],
      );
    });
  });

  test("changing a shift's timing moves future assignments but not started ones", async () => {
    await inRollback(db, async (tx) => {
      const past = await assign(tx, staff.nurseA, shifts.day, "2020-01-10");
      const future = await assign(tx, staff.nurseA, shifts.day, "2099-01-10");

      await actAs(tx, users.adminA);
      await tx.query("update public.shifts set start_time = '08:00' where id = $1", [shifts.day]);

      await actAsOwner(tx);
      const result = await rows<{ id: string; starts_at: Date }>(
        tx,
        "select id, starts_at from public.shift_assignments where id in ($1, $2)",
        [past.id, future.id],
      );
      const startsById = new Map(result.map((row) => [row.id, row.starts_at.toISOString()]));
      assert.equal(startsById.get(past.id), "2020-01-10T07:00:00.000Z");
      assert.equal(startsById.get(future.id), "2099-01-10T08:00:00.000Z");

      const [entry] = await rows(
        tx,
        `select actor_id, reason from public.audit_logs
         where entity_table = 'shift_assignments' and entity_id = $1 and action = 'update'`,
        [future.id],
      );
      assert.deepEqual(entry, { actor_id: users.adminA, reason: "Shift template timing changed" });
    });
  });
});

describe("roster integrity", () => {
  test("overlapping assignments are rejected; back-to-back and double shifts are allowed", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await assign(tx, staff.nurseA, shifts.day, "2099-01-10");
      await assign(tx, staff.nurseA, shifts.evening, "2099-01-10");
      await assign(tx, staff.nurseA, shifts.night, "2099-01-10");
      await assign(tx, staff.nurseA, shifts.day, "2099-01-11");

      const insert = "insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date) values ($1, $2, $3, $4)";
      await expectSqlError(tx, insert, { code: "23P01" }, [hospitalA, staff.nurseA, shifts.twilight, "2099-01-10"]);
      await expectSqlError(tx, insert, { code: "23P01" }, [hospitalA, staff.nurseA, shifts.night, "2099-01-10"]);
    });
  });

  test("cancelled assignments do not block rostering", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      const first = await assign(tx, staff.nurseA, shifts.night, "2099-01-10");
      await tx.query("update public.shift_assignments set status = 'cancelled' where id = $1", [first.id]);
      await assign(tx, staff.nurseA, shifts.twilight, "2099-01-10");
    });
  });

  test("inactive staff and inactive shifts cannot be rostered", async () => {
    await inRollback(db, async (tx) => {
      await tx.query("update public.staff set status = 'suspended' where id = $1", [staff.midwifeA]);
      await tx.query("update public.shifts set is_active = false where id = $1", [shifts.evening]);

      await actAs(tx, users.adminA);
      const insert = "insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date) values ($1, $2, $3, '2099-01-10')";
      await expectSqlError(tx, insert, { code: "22023", message: "STAFF_NOT_ACTIVE" }, [hospitalA, staff.midwifeA, shifts.day]);
      await expectSqlError(tx, insert, { code: "22023", message: "SHIFT_NOT_ACTIVE" }, [hospitalA, staff.nurseA, shifts.evening]);
    });
  });

  test("assignments cannot mix hospitals", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.superAdmin);
      const insert = "insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date) values ($1, $2, $3, '2099-01-10')";
      await expectSqlError(tx, insert, { code: "23503" }, [hospitalA, staff.nurseB, shifts.day]);

      await actAs(tx, users.adminB);
      await expectSqlError(tx, insert, { code: "22023", message: "STAFF_NOT_ACTIVE" }, [hospitalA, staff.nurseA, shifts.day]);
    });
  });

  test("the hospital time zone is locked once shifts are rostered", async () => {
    await inRollback(db, async (tx) => {
      await assign(tx, staff.nurseA, shifts.day, "2099-01-10");
      await actAs(tx, users.superAdmin);
      await expectSqlError(
        tx,
        "update public.hospitals set timezone = 'Africa/Lagos' where id = $1",
        { code: "22023", message: "TIMEZONE_LOCKED" },
        [hospitalA],
      );
    });
  });
});

describe("roster access", () => {
  async function visibleAssignmentCount(tx: Transaction, userId: string): Promise<number> {
    await actAs(tx, userId);
    const [{ count }] = await rows<{ count: number }>(tx, "select count(*)::int as count from public.shift_assignments");
    return count;
  }

  test("visibility follows role scope", async () => {
    await inRollback(db, async (tx) => {
      await assign(tx, staff.nurseA, shifts.night, "2099-02-01");
      await assign(tx, staff.headA, shifts.day, "2099-02-01");
      await assign(tx, staff.midwifeA, shifts.day, "2099-02-01");

      assert.equal(await visibleAssignmentCount(tx, users.adminA), 3);
      assert.equal(await visibleAssignmentCount(tx, users.headA), 2);
      assert.equal(await visibleAssignmentCount(tx, users.midwifeA), 1);
      assert.equal(await visibleAssignmentCount(tx, users.adminB), 0);
      assert.equal(await visibleAssignmentCount(tx, users.superAdmin), 3);
    });
  });

  test("department heads and staff cannot change the roster", async () => {
    await inRollback(db, async (tx) => {
      const existing = await assign(tx, staff.nurseA, shifts.night, "2099-02-01");

      await actAs(tx, users.headA);
      await expectSqlError(
        tx,
        "insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date) values ($1, $2, $3, '2099-02-02')",
        { code: "42501", message: "row-level security" },
        [hospitalA, staff.nurseA, shifts.day],
      );

      await actAs(tx, users.nurseA);
      assert.equal(
        await affectedRows(tx, "update public.shift_assignments set notes = 'swap please' where id = $1", [existing.id]),
        0,
      );
    });
  });

  test("assignments cannot be deleted", async () => {
    await inRollback(db, async (tx) => {
      const existing = await assign(tx, staff.nurseA, shifts.night, "2099-02-01");
      await actAs(tx, users.adminA);
      await expectSqlError(
        tx,
        "delete from public.shift_assignments where id = $1",
        { code: "42501", message: "permission denied" },
        [existing.id],
      );
    });
  });

  test("shift templates are visible only within their hospital", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminB);
      assert.deepEqual(await rows(tx, "select id from public.shifts where hospital_id = $1", [hospitalA]), []);
      await actAs(tx, users.nurseA);
      assert.equal((await rows(tx, "select id from public.shifts")).length, 4);
    });
  });
});
