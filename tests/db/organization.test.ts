import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { ids, seedTenants } from "./fixtures.ts";
import { actAs, actAsOwner, affectedRows, createTestDatabase, expectSqlError, inRollback, rows } from "./harness.ts";

const { users, staff, departments, hospitalA, hospitalB } = ids;

let db: PGlite;

before(async () => {
  db = await createTestDatabase();
  await seedTenants(db);
});

after(async () => {
  await db.close();
});

async function visibleStaffIds(tx: Transaction, userId: string): Promise<string[]> {
  await actAs(tx, userId);
  const result = await rows<{ id: string }>(tx, "select id from public.staff order by id");
  return result.map((row) => row.id);
}

describe("staff visibility", () => {
  test("super admins see staff in every hospital", async () => {
    await inRollback(db, async (tx) => {
      assert.equal((await visibleStaffIds(tx, users.superAdmin)).length, 5);
    });
  });

  test("hospital admins see their hospital only", async () => {
    await inRollback(db, async (tx) => {
      assert.deepEqual(
        await visibleStaffIds(tx, users.adminA),
        [staff.headA, staff.nurseA, staff.midwifeA, staff.porterA].sort(),
      );
    });
  });

  test("department heads see their department only", async () => {
    await inRollback(db, async (tx) => {
      assert.deepEqual(await visibleStaffIds(tx, users.headA), [staff.headA, staff.nurseA].sort());
    });
  });

  test("staff see only themselves", async () => {
    await inRollback(db, async (tx) => {
      assert.deepEqual(await visibleStaffIds(tx, users.nurseA), [staff.nurseA]);
    });
  });

  test("reassigning a department head changes access immediately", async () => {
    await inRollback(db, async (tx) => {
      await tx.query("update public.departments set head_staff_id = $1 where id = $2", [staff.midwifeA, departments.emergencyA]);
      assert.deepEqual(await visibleStaffIds(tx, users.headA), [staff.headA]);
      assert.deepEqual(
        await visibleStaffIds(tx, users.midwifeA),
        [staff.headA, staff.nurseA, staff.midwifeA].sort(),
      );
    });
  });

  test("heads of inactive departments lose department access", async () => {
    await inRollback(db, async (tx) => {
      await tx.query("update public.departments set is_active = false where id = $1", [departments.emergencyA]);
      assert.deepEqual(await visibleStaffIds(tx, users.headA), [staff.headA]);
    });
  });
});

describe("staff writes", () => {
  const insertStaff = `
    insert into public.staff
      (hospital_id, department_id, employee_number, first_name, last_name, job_title, employment_type, hire_date)
    values ($1, $2, $3, 'Ama', 'Quaye', 'Pharmacist', 'full_time', '2025-01-06')`;

  test("hospital admins create staff in their hospital only", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      assert.equal(await affectedRows(tx, insertStaff, [hospitalA, departments.maternityA, "KGH-100"]), 1);
      await expectSqlError(tx, insertStaff, { code: "42501", message: "row-level security" }, [
        hospitalB,
        departments.emergencyB,
        "NRH-100",
      ]);
    });
  });

  test("records cannot reference a department or head in another hospital", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.superAdmin);
      await expectSqlError(tx, insertStaff, { code: "23503" }, [hospitalA, departments.emergencyB, "KGH-101"]);
      await expectSqlError(
        tx,
        "update public.departments set head_staff_id = $1 where id = $2",
        { code: "23503" },
        [staff.nurseB, departments.emergencyA],
      );
    });
  });

  test("employee numbers are unique within a hospital", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.superAdmin);
      assert.equal(await affectedRows(tx, insertStaff, [hospitalB, departments.emergencyB, "KGH-002"]), 1);
      await expectSqlError(tx, insertStaff, { code: "23505" }, [hospitalA, departments.emergencyA, "KGH-002"]);
    });
  });

  test("staff and department heads cannot edit staff records", async () => {
    await inRollback(db, async (tx) => {
      const sql = "update public.staff set phone = '+233200000000' where id = $1";
      await actAs(tx, users.nurseA);
      assert.equal(await affectedRows(tx, sql, [staff.nurseA]), 0);
      await actAs(tx, users.headA);
      assert.equal(await affectedRows(tx, sql, [staff.nurseA]), 0);
    });
  });

  test("staff records cannot be deleted", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await expectSqlError(tx, "delete from public.staff where id = $1", { code: "42501", message: "permission denied" }, [
        staff.porterA,
      ]);
    });
  });

  test("terminating a staff member deactivates their account", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await tx.query("select public.change_staff_status($1, 'terminated', 'Resigned at end of contract', '2026-01-31')", [
        staff.nurseA,
      ]);
      await actAsOwner(tx);
      assert.deepEqual(await rows(tx, "select is_active from public.profiles where id = $1", [users.nurseA]), [
        { is_active: false },
      ]);
      assert.deepEqual(await visibleStaffIds(tx, users.nurseA), []);
    });
  });

  test("termination requires a termination date", async () => {
    await inRollback(db, async (tx) => {
      await expectSqlError(tx, "update public.staff set status = 'terminated' where id = $1", { code: "23514" }, [
        staff.porterA,
      ]);
    });
  });

  test("changes are audited with the acting user", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await tx.query("update public.staff set job_title = 'Senior Staff Nurse' where id = $1", [staff.nurseA]);
      await actAsOwner(tx);
      const [entry] = await rows(
        tx,
        `select actor_id, old_data ->> 'job_title' as before, new_data ->> 'job_title' as after
         from public.audit_logs
         where entity_table = 'staff' and entity_id = $1 and action = 'update'
         order by id desc limit 1`,
        [staff.nurseA],
      );
      assert.deepEqual(entry, { actor_id: users.adminA, before: "Staff Nurse", after: "Senior Staff Nurse" });
    });
  });
});

describe("departments", () => {
  test("members read their own hospital's departments", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.nurseA);
      const result = await rows<{ id: string }>(tx, "select id from public.departments order by id");
      assert.deepEqual(result.map((row) => row.id), [departments.emergencyA, departments.maternityA].sort());
    });
  });

  test("only admins create departments", async () => {
    await inRollback(db, async (tx) => {
      const sql = "insert into public.departments (hospital_id, name, code) values ($1, 'Radiology', 'RAD')";
      await actAs(tx, users.headA);
      await expectSqlError(tx, sql, { code: "42501", message: "row-level security" }, [hospitalA]);
      await actAs(tx, users.adminA);
      assert.equal(await affectedRows(tx, sql, [hospitalA]), 1);
    });
  });

  test("department names are unique per hospital regardless of case", async () => {
    await inRollback(db, async (tx) => {
      await expectSqlError(
        tx,
        "insert into public.departments (hospital_id, name, code) values ($1, 'EMERGENCY', 'ER2')",
        { code: "23505" },
        [hospitalA],
      );
    });
  });
});
