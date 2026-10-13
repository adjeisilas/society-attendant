import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { ids, seedTenants } from "./fixtures.ts";
import { actAs, actAsOwner, affectedRows, createTestDatabase, expectSqlError, inRollback, rows } from "./harness.ts";

const { users, staff, hospitalA } = ids;

const shifts = {
  day: "0a000000-0000-4000-8000-0000000005d1",
  night: "0a000000-0000-4000-8000-0000000005a1",
};

/** The Auth service creates invited users without app_metadata roles. */
const INVITED_USER_METADATA = JSON.stringify({ provider: "email", providers: ["email"] });

let db: PGlite;

before(async () => {
  db = await createTestDatabase();
  await seedTenants(db);
  await db.exec(`
    insert into public.shifts (id, hospital_id, name, code, start_time, duration_minutes) values
      ('${shifts.day}',   '${hospitalA}', 'Day',   'D', '07:00', 480),
      ('${shifts.night}', '${hospitalA}', 'Night', 'N', '23:00', 480);
  `);
});

after(async () => {
  await db.close();
});

async function prepareInvitation(tx: Transaction, actor: string, staffId: string, role = "staff"): Promise<string> {
  await actAs(tx, actor);
  const [{ email }] = await rows<{ email: string }>(tx, "select public.prepare_account_invitation($1, $2) as email", [
    staffId,
    role,
  ]);
  await actAsOwner(tx);
  return email;
}

describe("account invitations", () => {
  test("an authorized invitation provisions the account when the Auth service creates the user", async () => {
    await inRollback(db, async (tx) => {
      const email = await prepareInvitation(tx, users.adminA, staff.porterA);
      assert.equal(email, "y.mensah@kgh.example.test");

      const userId = "0a000000-0000-4000-8000-0000000000a9";
      await tx.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
        userId,
        email,
        INVITED_USER_METADATA,
      ]);

      assert.deepEqual(
        await rows(
          tx,
          `select p.role, p.hospital_id, p.activated_at, s.user_id, i.user_id as invitation_user_id
           from public.profiles p
           join public.staff s on s.user_id = p.id
           join public.account_invitations i on i.staff_id = s.id
           where p.id = $1`,
          [userId],
        ),
        [{ role: "staff", hospital_id: hospitalA, activated_at: null, user_id: userId, invitation_user_id: userId }],
      );
    });
  });

  test("expired invitations cannot be used", async () => {
    await inRollback(db, async (tx) => {
      const email = await prepareInvitation(tx, users.adminA, staff.porterA);
      await tx.query("update public.account_invitations set expires_at = now() - interval '1 minute'");
      await expectSqlError(
        tx,
        "insert into auth.users (id, email, raw_app_meta_data) values (gen_random_uuid(), $1, $2)",
        { code: "42501", message: "ACCOUNT_PROVISIONING_REQUIRED" },
        [email, INVITED_USER_METADATA],
      );
    });
  });

  test("an invitation can be resent until the account is activated", async () => {
    await inRollback(db, async (tx) => {
      assert.equal(await prepareInvitation(tx, users.adminA, staff.nurseA), "e.owusu@kgh.example.test");

      await tx.query("update auth.users set email_confirmed_at = now() where id = $1", [users.nurseA]);
      assert.deepEqual(
        await rows(tx, "select activated_at is not null as activated from public.profiles where id = $1", [users.nurseA]),
        [{ activated: true }],
      );

      await actAs(tx, users.adminA);
      await expectSqlError(
        tx,
        "select public.prepare_account_invitation($1, 'staff')",
        { code: "22023", message: "ACCOUNT_ALREADY_ACTIVE" },
        [staff.nurseA],
      );
    });
  });

  describe("administrator-set passwords", () => {
    test("the account must choose its own password at first sign-in", async () => {
      await inRollback(db, async (tx) => {
        await actAs(tx, users.adminA);
        const [{ email }] = await rows<{ email: string }>(
          tx,
          "select public.prepare_account_invitation($1, 'staff', true) as email",
          [staff.porterA],
        );
        await actAsOwner(tx);
        assert.deepEqual(
          await rows(tx, "select requires_password_change from public.account_invitations where email = $1", [email]),
          [{ requires_password_change: true }],
        );

        const userId = "0a000000-0000-4000-8000-0000000000c3";
        await tx.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
          userId,
          email,
          INVITED_USER_METADATA,
        ]);
        assert.deepEqual(await rows(tx, "select must_change_password from public.profiles where id = $1", [userId]), [
          { must_change_password: true },
        ]);

        // The account clears its own flag once it has chosen a password.
        await actAs(tx, userId);
        await tx.query("select public.complete_password_change()");
        await actAsOwner(tx);
        assert.deepEqual(await rows(tx, "select must_change_password from public.profiles where id = $1", [userId]), [
          { must_change_password: false },
        ]);
      });
    });

    test("an emailed invitation does not force a password change", async () => {
      await inRollback(db, async (tx) => {
        const email = await prepareInvitation(tx, users.adminA, staff.porterA);
        const userId = "0a000000-0000-4000-8000-0000000000c4";
        await tx.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
          userId,
          email,
          INVITED_USER_METADATA,
        ]);
        assert.deepEqual(await rows(tx, "select must_change_password from public.profiles where id = $1", [userId]), [
          { must_change_password: false },
        ]);
      });
    });

    test("no one can clear another account's password requirement", async () => {
      await inRollback(db, async (tx) => {
        await actAsOwner(tx);
        await tx.query("update public.profiles set must_change_password = true where id = $1", [users.nurseA]);

        await actAs(tx, users.adminA);
        await tx.query("select public.complete_password_change()");
        await actAsOwner(tx);
        assert.deepEqual(
          await rows(tx, "select must_change_password from public.profiles where id = $1", [users.nurseA]),
          [{ must_change_password: true }],
        );
      });
    });

    test("an administrator resets a password and the account must choose a new one", async () => {
      await inRollback(db, async (tx) => {
        await actAs(tx, users.adminA);
        assert.deepEqual(
          await rows(tx, "select public.prepare_password_reset($1) as user_id", [staff.nurseA]),
          [{ user_id: users.nurseA }],
        );

        await tx.query("select public.finish_password_reset($1)", [staff.nurseA]);
        await actAsOwner(tx);
        assert.deepEqual(
          await rows(tx, "select must_change_password from public.profiles where id = $1", [users.nurseA]),
          [{ must_change_password: true }],
        );
      });
    });

    test("rejects resets outside the caller's authority", async () => {
      const cases = [
        { actor: users.adminA, staffId: staff.nurseB, code: "P0002", message: "STAFF_NOT_FOUND" },
        { actor: users.headA, staffId: staff.nurseA, code: "P0002", message: "STAFF_NOT_FOUND" },
        { actor: users.nurseA, staffId: staff.nurseA, code: "P0002", message: "STAFF_NOT_FOUND" },
        { actor: users.adminA, staffId: staff.porterA, code: "P0002", message: "ACCOUNT_NOT_FOUND" },
      ];
      for (const { actor, staffId, code, message } of cases) {
        await inRollback(db, async (tx) => {
          await actAs(tx, actor);
          await expectSqlError(tx, "select public.prepare_password_reset($1)", { code, message }, [staffId]);
        });
      }
    });

    test("an administrator cannot reset their own password here", async () => {
      await inRollback(db, async (tx) => {
        await actAsOwner(tx);
        // Give the admin a staff record of their own, linked to their account.
        await tx.query("update public.staff set user_id = $1 where id = $2", [users.adminA, staff.porterA]);
        await actAs(tx, users.adminA);
        await expectSqlError(
          tx,
          "select public.prepare_password_reset($1)",
          { code: "42501", message: "CANNOT_RESET_OWN_ACCOUNT" },
          [staff.porterA],
        );
      });
    });

    test("a staff member who already has an account cannot be given a password", async () => {
      await inRollback(db, async (tx) => {
        await actAs(tx, users.adminA);
        await expectSqlError(
          tx,
          "select public.prepare_account_invitation($1, 'staff', true)",
          { code: "22023", message: "ACCOUNT_ALREADY_EXISTS" },
          [staff.nurseA],
        );
      });
    });
  });

  test("rejects invitations outside the caller's authority", async () => {
    const cases = [
      { actor: users.adminA, staffId: staff.nurseB, role: "staff", code: "P0002", message: "STAFF_NOT_FOUND" },
      { actor: users.nurseA, staffId: staff.porterA, role: "staff", code: "P0002", message: "STAFF_NOT_FOUND" },
      { actor: users.headA, staffId: staff.nurseA, role: "staff", code: "P0002", message: "STAFF_NOT_FOUND" },
      { actor: users.adminA, staffId: staff.porterA, role: "super_admin", code: "22023", message: "INVALID_ROLE" },
    ];
    for (const { actor, staffId, role, code, message } of cases) {
      await inRollback(db, async (tx) => {
        await actAs(tx, actor);
        await expectSqlError(tx, "select public.prepare_account_invitation($1, $2)", { code, message }, [staffId, role]);
      });
    }
  });

  test("requires an active staff member with an unused email address", async () => {
    const cases = [
      { arrange: "update public.staff set email = null where id = $1", message: "STAFF_EMAIL_REQUIRED" },
      { arrange: "update public.staff set status = 'suspended' where id = $1", message: "STAFF_NOT_ACTIVE" },
      { arrange: "update public.staff set email = 'hr@kgh.example.test' where id = $1", message: "EMAIL_IN_USE" },
    ];
    for (const { arrange, message } of cases) {
      await inRollback(db, async (tx) => {
        await tx.query(arrange, [staff.porterA]);
        await actAs(tx, users.adminA);
        await expectSqlError(tx, "select public.prepare_account_invitation($1, 'staff')", { code: "22023", message }, [
          staff.porterA,
        ]);
      });
    }
  });

  test("invitations are readable by the hospital's admins only and cannot be written directly", async () => {
    await inRollback(db, async (tx) => {
      await prepareInvitation(tx, users.adminA, staff.porterA);

      await actAs(tx, users.adminA);
      assert.equal((await rows(tx, "select id from public.account_invitations")).length, 1);
      await expectSqlError(
        tx,
        `insert into public.account_invitations (hospital_id, staff_id, email, role, invited_by)
         values ($1, $2, 'attacker@example.test', 'hospital_admin', $3)`,
        { code: "42501", message: "permission denied" },
        [hospitalA, staff.porterA, users.adminA],
      );

      await actAs(tx, users.adminB);
      assert.equal((await rows(tx, "select id from public.account_invitations")).length, 0);
      await actAs(tx, users.nurseA);
      assert.equal((await rows(tx, "select id from public.account_invitations")).length, 0);
    });
  });

  test("the email of a staff member with an account cannot be changed", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await expectSqlError(
        tx,
        "update public.staff set email = 'someone.else@example.test' where id = $1",
        { code: "22023", message: "EMAIL_LINKED_TO_ACCOUNT" },
        [staff.nurseA],
      );
      assert.equal(
        await affectedRows(tx, "update public.staff set email = 'yaw.mensah@kgh.example.test' where id = $1", [staff.porterA]),
        1,
      );
    });
  });
});

describe("change_staff_status", () => {
  const call = "select public.change_staff_status($1, $2, $3, $4) as cancelled";

  test("termination deactivates the account, cancels future shifts and records the reason", async () => {
    await inRollback(db, async (tx) => {
      await tx.query(
        `insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date) values
           ($1, $2, $3, '2020-01-10'), ($1, $2, $3, '2099-01-10'), ($1, $2, $3, '2099-01-11')`,
        [hospitalA, staff.nurseA, shifts.day],
      );

      await actAs(tx, users.adminA);
      const [{ cancelled }] = await rows<{ cancelled: number }>(tx, call, [
        staff.nurseA,
        "terminated",
        "Resigned at end of contract",
        "2026-01-31",
      ]);
      assert.equal(cancelled, 2);

      await actAsOwner(tx);
      assert.deepEqual(
        await rows(tx, "select work_date::text, status from public.shift_assignments where staff_id = $1 order by work_date", [
          staff.nurseA,
        ]),
        [
          { work_date: "2020-01-10", status: "scheduled" },
          { work_date: "2099-01-10", status: "cancelled" },
          { work_date: "2099-01-11", status: "cancelled" },
        ],
      );
      assert.deepEqual(await rows(tx, "select is_active from public.profiles where id = $1", [users.nurseA]), [
        { is_active: false },
      ]);
      const [entry] = await rows(
        tx,
        `select reason, actor_id from public.audit_logs
         where entity_table = 'staff' and entity_id = $1 and action = 'update'
         order by id desc limit 1`,
        [staff.nurseA],
      );
      assert.deepEqual(entry, { reason: "Resigned at end of contract", actor_id: users.adminA });
    });
  });

  test("reactivation clears the termination date", async () => {
    await inRollback(db, async (tx) => {
      await tx.query("update public.staff set status = 'terminated', termination_date = '2025-12-31' where id = $1", [
        staff.porterA,
      ]);
      await actAs(tx, users.adminA);
      await tx.query(call, [staff.porterA, "active", "Rehired on a new contract", null]);
      await actAsOwner(tx);
      assert.deepEqual(await rows(tx, "select status, termination_date from public.staff where id = $1", [staff.porterA]), [
        { status: "active", termination_date: null },
      ]);
    });
  });

  test("rejects invalid or unauthorized changes", async () => {
    const cases = [
      { actor: users.adminA, args: [staff.porterA, "suspended", "", null], code: "22023", message: "REASON_REQUIRED" },
      { actor: users.adminA, args: [staff.porterA, "active", "Already active", null], code: "22023", message: "STATUS_UNCHANGED" },
      { actor: users.adminA, args: [staff.porterA, "terminated", "Contract ended", null], code: "22023", message: "TERMINATION_DATE_REQUIRED" },
      { actor: users.adminA, args: [staff.porterA, "terminated", "Contract will end", "2099-01-01"], code: "22023", message: "TERMINATION_DATE_IN_FUTURE" },
      { actor: users.adminA, args: [staff.nurseB, "suspended", "Other hospital", null], code: "P0002", message: "STAFF_NOT_FOUND" },
      { actor: users.headA, args: [staff.nurseA, "suspended", "Department head attempt", null], code: "P0002", message: "STAFF_NOT_FOUND" },
    ];
    for (const { actor, args, code, message } of cases) {
      await inRollback(db, async (tx) => {
        await actAs(tx, actor);
        await expectSqlError(tx, call, { code, message }, args);
      });
    }
  });

  test("admins cannot change their own staff status", async () => {
    await inRollback(db, async (tx) => {
      await tx.query("update public.profiles set role = 'hospital_admin' where id = $1", [users.headA]);
      await actAs(tx, users.headA);
      await expectSqlError(tx, call, { code: "42501", message: "CANNOT_CHANGE_OWN_STATUS" }, [
        staff.headA,
        "suspended",
        "Suspending myself",
        null,
      ]);
    });
  });

  test("status and account links cannot be written directly", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await expectSqlError(
        tx,
        "update public.staff set status = 'suspended' where id = $1",
        { code: "42501", message: "permission denied" },
        [staff.porterA],
      );
      await expectSqlError(
        tx,
        "update public.staff set user_id = $1 where id = $2",
        { code: "42501", message: "permission denied" },
        [users.adminA, staff.porterA],
      );
    });
  });
});

describe("directory views", () => {
  test("department_directory shows heads and active staff counts", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      assert.deepEqual(
        await rows(tx, "select code, head_name, active_staff_count from public.department_directory order by code"),
        [
          { code: "ER", head_name: "Kofi Boateng", active_staff_count: 2 },
          { code: "MAT", head_name: null, active_staff_count: 2 },
        ],
      );
    });
  });

  test("staff_directory applies staff visibility and hides account details from department heads", async () => {
    await inRollback(db, async (tx) => {
      const sql = "select id, account_role from public.staff_directory where id = $1";

      await actAs(tx, users.adminA);
      assert.equal((await rows(tx, "select id from public.staff_directory")).length, 4);
      assert.deepEqual(await rows(tx, sql, [staff.nurseA]), [{ id: staff.nurseA, account_role: "staff" }]);

      await actAs(tx, users.headA);
      assert.equal((await rows(tx, "select id from public.staff_directory")).length, 2);
      assert.deepEqual(await rows(tx, sql, [staff.nurseA]), [{ id: staff.nurseA, account_role: null }]);

      await actAs(tx, users.nurseA);
      assert.deepEqual(await rows(tx, "select id from public.staff_directory"), [{ id: staff.nurseA }]);
    });
  });

  test("search text covers name, employee number, email and job title", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      for (const term of ["owusu", "kgh-002", "e.owusu@", "staff nurse"]) {
        const result = await rows<{ id: string }>(tx, "select id from public.staff_directory where search_text like $1", [
          `%${term}%`,
        ]);
        assert.deepEqual(result.map((row) => row.id), [staff.nurseA], `search for ${term}`);
      }
    });
  });

  test("anonymous requests are denied", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, null, "anon");
      await expectSqlError(tx, "select id from public.staff_directory", { code: "42501", message: "permission denied" });
    });
  });
});

describe("create_shift_assignments", () => {
  const call = "select public.create_shift_assignments($1, array[$2, $3]::uuid[], array['2099-01-10', '2099-01-11']::date[]) as result";

  test("creates assignments and reports the overlaps it skipped", async () => {
    await inRollback(db, async (tx) => {
      await tx.query(
        "insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date) values ($1, $2, $3, '2099-01-10')",
        [hospitalA, staff.nurseA, shifts.night],
      );

      await actAs(tx, users.adminA);
      const [{ result }] = await rows<{ result: unknown }>(tx, call, [shifts.night, staff.nurseA, staff.headA]);
      assert.deepEqual(result, {
        created: 3,
        skipped: [{ staff_id: staff.nurseA, work_date: "2099-01-10", reason: "overlap" }],
      });
    });
  });

  test("skips staff who are not active", async () => {
    await inRollback(db, async (tx) => {
      await tx.query("update public.staff set status = 'suspended' where id = $1", [staff.porterA]);
      await actAs(tx, users.adminA);
      const [{ result }] = await rows<{ result: { created: number; skipped: { reason: string }[] } }>(tx, call, [
        shifts.day,
        staff.porterA,
        staff.midwifeA,
      ]);
      assert.equal(result.created, 2);
      assert.deepEqual(
        result.skipped.map((entry) => entry.reason),
        ["staff_not_active", "staff_not_active"],
      );
    });
  });

  test("department heads cannot roster", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.headA);
      await expectSqlError(tx, call, { code: "42501", message: "row-level security" }, [
        shifts.day,
        staff.nurseA,
        staff.headA,
      ]);
    });
  });

  test("limits the size of a batch", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await expectSqlError(
        tx,
        `select public.create_shift_assignments(
           $1,
           array[$2]::uuid[],
           (select array_agg('2099-01-01'::date + offset_days) from generate_series(0, 2000) as offset_days)
         )`,
        { code: "22023", message: "TOO_MANY_ASSIGNMENTS" },
        [shifts.day, staff.nurseA],
      );
    });
  });

  test("hospital admins of another hospital cannot use this hospital's shifts", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminB);
      await expectSqlError(tx, call, { code: "22023", message: "SHIFT_NOT_ACTIVE" }, [
        shifts.day,
        staff.nurseA,
        staff.headA,
      ]);
    });
  });
});
