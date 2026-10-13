import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { ids, insertAuthUser, seedTenants } from "./fixtures.ts";
import { actAs, actAsOwner, affectedRows, createTestDatabase, expectSqlError, inRollback, rows } from "./harness.ts";

const { users, staff, hospitalA, hospitalB } = ids;

let db: PGlite;

before(async () => {
  db = await createTestDatabase();
  await seedTenants(db);
});

after(async () => {
  await db.close();
});

describe("account provisioning", () => {
  test("creates a profile from app_metadata and links the staff record", async () => {
    const result = await rows(
      db,
      `select p.role, p.hospital_id, p.display_name, s.id as staff_id
       from public.profiles p
       join public.staff s on s.user_id = p.id
       where p.id = $1`,
      [users.nurseA],
    );
    assert.deepEqual(result, [
      { role: "staff", hospital_id: hospitalA, display_name: "Efua Owusu", staff_id: staff.nurseA },
    ]);
  });

  test("rejects accounts created without provisioning metadata", async () => {
    await inRollback(db, async (tx) => {
      await expectSqlError(
        tx,
        `insert into auth.users (id, email, raw_app_meta_data)
         values (gen_random_uuid(), 'self.signup@example.test', '{"provider":"email"}')`,
        { code: "42501", message: "ACCOUNT_PROVISIONING_REQUIRED" },
      );
    });
  });

  test("rejects invalid provisioning combinations", async () => {
    const cases = [
      { metadata: { role: "staff", hospital_id: hospitalA }, message: "STAFF_RECORD_REQUIRED" },
      { metadata: { role: "staff", hospital_id: hospitalA, staff_id: staff.nurseB }, message: "STAFF_RECORD_NOT_AVAILABLE" },
      { metadata: { role: "staff", hospital_id: hospitalA, staff_id: staff.nurseA }, message: "STAFF_RECORD_NOT_AVAILABLE" },
      { metadata: { role: "super_admin", hospital_id: hospitalA }, message: "INVALID_PROVISIONING_METADATA" },
      { metadata: { role: "hospital_admin" }, message: "HOSPITAL_NOT_AVAILABLE" },
    ];

    for (const { metadata, message } of cases) {
      await inRollback(db, async (tx) => {
        await expectSqlError(
          tx,
          "insert into auth.users (id, email, raw_app_meta_data) values (gen_random_uuid(), 'new@example.test', $1)",
          { code: "22023", message },
          [JSON.stringify(metadata)],
        );
      });
    }
  });

  describe("super admin bootstrap", () => {
    const grant = async (tx: Parameters<Parameters<typeof inRollback>[1]>[0], email: string) => {
      await actAs(tx, null, "service_role");
      await tx.query("select public.authorize_super_admin_signup($1, $2)", [email, " Platform Owner "]);
      await actAsOwner(tx);
    };

    test("a service role grant provisions a super admin once", async () => {
      await inRollback(db, async (tx) => {
        await grant(tx, " Owner@Example.test ");
        const userId = "0a000000-0000-4000-8000-0000000000b1";
        await tx.query(
          `insert into auth.users (id, email, raw_app_meta_data)
           values ($1, 'owner@example.test', '{"provider":"email"}')`,
          [userId],
        );
        assert.deepEqual(
          await rows(tx, "select role, hospital_id, display_name from public.profiles where id = $1", [userId]),
          [{ role: "super_admin", hospital_id: null, display_name: "Platform Owner" }],
        );
        assert.deepEqual(await rows(tx, "select email from private.super_admin_grants"), []);
      });
    });

    test("an expired grant is ignored", async () => {
      await inRollback(db, async (tx) => {
        await grant(tx, "late@example.test");
        await tx.query("update private.super_admin_grants set expires_at = now() - interval '1 second'");
        await expectSqlError(
          tx,
          `insert into auth.users (id, email, raw_app_meta_data)
           values (gen_random_uuid(), 'late@example.test', '{"provider":"email"}')`,
          { code: "42501", message: "ACCOUNT_PROVISIONING_REQUIRED" },
        );
      });
    });

    test("rejects an email that already has an account", async () => {
      await inRollback(db, async (tx) => {
        const [{ email }] = await rows<{ email: string }>(tx, "select email from auth.users where id = $1", [users.nurseA]);
        await actAs(tx, null, "service_role");
        await expectSqlError(
          tx,
          "select public.authorize_super_admin_signup($1, 'Someone')",
          { code: "23505", message: "EMAIL_IN_USE" },
          [email.toUpperCase()],
        );
      });
    });

    test("only the service role can create a grant", async () => {
      for (const [userId, role] of [[users.superAdmin, "authenticated"], [null, "anon"]] as const) {
        await inRollback(db, async (tx) => {
          await actAs(tx, userId, role);
          await expectSqlError(
            tx,
            "select public.authorize_super_admin_signup('x@example.test', 'X')",
            { code: "42501", message: "permission denied" },
          );
        });
      }
    });
  });

  test("links an unlinked staff record and uses the staff name", async () => {
    await inRollback(db, async (tx) => {
      const userId = "0a000000-0000-4000-8000-0000000000a5";
      await insertAuthUser(tx, userId, "y.mensah@kgh.example.test", {
        role: "staff",
        hospital_id: hospitalA,
        staff_id: staff.porterA,
        display_name: "ignored when a staff record exists",
      });
      const result = await rows(
        tx,
        "select p.display_name, s.user_id from public.profiles p join public.staff s on s.user_id = p.id where p.id = $1",
        [userId],
      );
      assert.deepEqual(result, [{ display_name: "Yaw Mensah", user_id: userId }]);
    });
  });
});

describe("hospitals", () => {
  test("a super admin sets up the first hospital, which also creates its default settings", async () => {
    const empty = await createTestDatabase();
    try {
      await insertAuthUser(empty, users.superAdmin, "platform.admin@example.test", {
        role: "super_admin",
        display_name: "Platform Admin",
      });
      await inRollback(empty, async (tx) => {
        await actAs(tx, users.superAdmin);
        await tx.query("insert into public.hospitals (name, code, timezone) values ('Cape Coast Teaching Hospital', 'CCTH', 'Africa/Accra')");
        const result = await rows(
          tx,
          `select s.check_out_window_minutes, s.allow_unscheduled_check_in
           from public.hospital_settings s join public.hospitals h on h.id = s.hospital_id
           where h.code = 'CCTH'`,
        );
        assert.deepEqual(result, [{ check_out_window_minutes: 480, allow_unscheduled_check_in: false }]);
      });
    } finally {
      await empty.close();
    }
  });

  test("the system serves one hospital: nobody can add another once it exists", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.superAdmin);
      await expectSqlError(
        tx,
        "insert into public.hospitals (name, code, timezone) values ('Cape Coast Teaching Hospital', 'CCTH', 'Africa/Accra')",
        { code: "42501", message: "row-level security" },
      );
    });
  });

  test("rejects an unknown time zone", async () => {
    await inRollback(db, async (tx) => {
      await expectSqlError(
        tx,
        "insert into public.hospitals (name, code, timezone) values ('Test Hospital', 'TST', 'Mars/Olympus_Mons')",
        { code: "22023", message: "INVALID_TIMEZONE" },
      );
    });
  });

  test("only super admins can create hospitals", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await expectSqlError(
        tx,
        "insert into public.hospitals (name, code, timezone) values ('Rogue Hospital', 'RGE', 'Africa/Accra')",
        { code: "42501", message: "row-level security" },
      );
    });
  });

  test("members only see their own hospital", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.nurseA);
      assert.deepEqual(await rows(tx, "select id from public.hospitals"), [{ id: hospitalA }]);

      await actAs(tx, users.adminB);
      assert.deepEqual(await rows(tx, "select id from public.hospitals"), [{ id: hospitalB }]);

      await actAs(tx, users.superAdmin);
      assert.deepEqual(await rows(tx, "select count(*)::int as count from public.hospitals"), [{ count: 2 }]);
    });
  });

  test("anonymous requests are denied", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, null, "anon");
      await expectSqlError(tx, "select id from public.hospitals", { code: "42501", message: "permission denied" });
    });
  });
});

describe("hospital settings", () => {
  test("hospital admins update only their own hospital", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      const sql = "update public.hospital_settings set min_session_minutes = 15 where hospital_id = $1";
      assert.equal(await affectedRows(tx, sql, [hospitalA]), 1);
      assert.equal(await affectedRows(tx, sql, [hospitalB]), 0);
    });
  });

  test("staff cannot change settings", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.nurseA);
      assert.equal(
        await affectedRows(tx, "update public.hospital_settings set min_session_minutes = 0 where hospital_id = $1", [hospitalA]),
        0,
      );
    });
  });

  test("settings cannot be moved to another hospital", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await expectSqlError(
        tx,
        "update public.hospital_settings set hospital_id = $1 where hospital_id = $2",
        { code: "42501", message: "permission denied" },
        [hospitalB, hospitalA],
      );
    });
  });
});

describe("profiles", () => {
  test("staff see only their own profile", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.nurseA);
      assert.deepEqual(await rows(tx, "select id from public.profiles"), [{ id: users.nurseA }]);
    });
  });

  test("hospital admins see accounts in their hospital only", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      const result = await rows<{ id: string }>(tx, "select id from public.profiles order by id");
      assert.deepEqual(
        result.map((row) => row.id),
        [users.adminA, users.headA, users.nurseA, users.midwifeA].sort(),
      );
    });
  });

  test("users can change their display name but not their role or hospital", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.nurseA);
      assert.equal(
        await affectedRows(tx, "update public.profiles set display_name = 'Nurse Efua' where id = $1", [users.nurseA]),
        1,
      );
      await expectSqlError(
        tx,
        "update public.profiles set role = 'hospital_admin' where id = $1",
        { code: "42501", message: "permission denied" },
        [users.nurseA],
      );
      await expectSqlError(
        tx,
        "update public.profiles set hospital_id = $1 where id = $2",
        { code: "42501", message: "permission denied" },
        [hospitalB, users.nurseA],
      );
    });
  });
});

describe("update_account_access", () => {
  const call = "select public.update_account_access($1, $2, $3, $4)";

  test("deactivation removes access immediately and records the reason", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      await tx.query(call, [users.nurseA, "staff", false, "Suspended pending investigation"]);

      await actAs(tx, users.nurseA);
      assert.deepEqual(await rows(tx, "select id from public.hospitals"), []);
      assert.deepEqual(await rows(tx, "select id from public.staff"), []);

      await actAsOwner(tx);
      const [entry] = await rows<Record<string, unknown>>(
        tx,
        `select actor_id, actor_role, reason, hospital_id,
                old_data ->> 'is_active' as was_active, new_data ->> 'is_active' as is_active
         from public.audit_logs
         where entity_table = 'profiles' and entity_id = $1 and action = 'update'
         order by id desc limit 1`,
        [users.nurseA],
      );
      assert.deepEqual(entry, {
        actor_id: users.adminA,
        actor_role: "hospital_admin",
        reason: "Suspended pending investigation",
        hospital_id: hospitalA,
        was_active: "true",
        is_active: "false",
      });
    });
  });

  test("rejects out-of-policy changes", async () => {
    const cases = [
      { actor: users.adminA, args: [users.nurseA, "super_admin", true, "Promote to platform"], code: "42501", message: "SUPER_ADMIN_CHANGE_NOT_ALLOWED" },
      { actor: users.adminA, args: [users.adminA, "staff", true, "Demote myself"], code: "42501", message: "CANNOT_CHANGE_OWN_ACCESS" },
      { actor: users.adminA, args: [users.nurseB, "staff", false, "Other hospital"], code: "P0002", message: "ACCOUNT_NOT_FOUND" },
      { actor: users.adminA, args: [users.superAdmin, "super_admin", false, "Disable platform admin"], code: "P0002", message: "ACCOUNT_NOT_FOUND" },
      { actor: users.nurseA, args: [users.midwifeA, "hospital_admin", true, "Staff escalation"], code: "P0002", message: "ACCOUNT_NOT_FOUND" },
      { actor: users.adminA, args: [users.nurseA, "staff", false, "  "], code: "22023", message: "REASON_REQUIRED" },
      { actor: users.superAdmin, args: [users.adminA, "staff", true, "No staff record"], code: "22023", message: "STAFF_RECORD_REQUIRED" },
    ];

    for (const { actor, args, code, message } of cases) {
      await inRollback(db, async (tx) => {
        await actAs(tx, actor);
        await expectSqlError(tx, call, { code, message }, args);
      });
    }
  });

  test("super admins can manage accounts in any hospital", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.superAdmin);
      await tx.query(call, [users.nurseB, "hospital_admin", true, "Appointed ward administrator"]);
      await actAsOwner(tx);
      assert.deepEqual(await rows(tx, "select role from public.profiles where id = $1", [users.nurseB]), [
        { role: "hospital_admin" },
      ]);
    });
  });

  test("anonymous callers cannot execute it", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, null, "anon");
      await expectSqlError(
        tx,
        call,
        { code: "42501", message: "permission denied" },
        [users.nurseA, "staff", false, "Anonymous attempt"],
      );
    });
  });
});

describe("audit log", () => {
  test("is append-only, even for the table owner", async () => {
    await inRollback(db, async (tx) => {
      await expectSqlError(tx, "update public.audit_logs set reason = 'tampered'", { code: "42501", message: "APPEND_ONLY_TABLE" });
      await expectSqlError(tx, "delete from public.audit_logs", { code: "42501", message: "APPEND_ONLY_TABLE" });
      await expectSqlError(tx, "truncate public.audit_logs", { code: "42501", message: "APPEND_ONLY_TABLE" });
    });
  });

  test("API roles cannot write audit entries directly", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.superAdmin);
      await expectSqlError(
        tx,
        "insert into public.audit_logs (action, entity_table) values ('forged', 'profiles')",
        { code: "42501", message: "permission denied" },
      );
    });
  });

  test("hospital admins read their hospital's entries; staff read none", async () => {
    await inRollback(db, async (tx) => {
      await actAs(tx, users.adminA);
      const hospitals = await rows(tx, "select distinct hospital_id from public.audit_logs");
      assert.deepEqual(hospitals, [{ hospital_id: hospitalA }]);

      await actAs(tx, users.nurseA);
      assert.deepEqual(await rows(tx, "select count(*)::int as count from public.audit_logs"), [{ count: 0 }]);
    });
  });
});
