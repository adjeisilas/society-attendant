import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { ids, seedTenants } from "./fixtures.ts";
import { actAs, actAsOwner, createTestDatabase, expectSqlError, inRollback, rows } from "./harness.ts";

const { users, staff, departments, hospitalA, hospitalB } = ids;

const locations = {
  mainEntranceA: "0a000000-0000-4000-8000-0000000007a1",
  wardA: "0a000000-0000-4000-8000-0000000007a2",
  entranceB: "0b000000-0000-4000-8000-0000000007b1",
};

interface ClockResult {
  ok: boolean;
  code?: string;
  status?: string;
  staff_name?: string;
  shift_name?: string | null;
  late_minutes?: number;
  worked_minutes?: number;
  overtime_minutes?: number;
  early_leave_minutes?: number;
  is_overtime?: boolean;
  is_early_leave?: boolean;
  record_id?: string;
  flags?: string[];
  location_name?: string;
}

interface RegisteredTerminal {
  id: string;
  key: string;
}

let db: PGlite;

before(async () => {
  db = await createTestDatabase();
  await seedTenants(db);
  await db.exec(`
    insert into public.attendance_locations (id, hospital_id, name) values
      ('${locations.mainEntranceA}', '${hospitalA}', 'Main Entrance'),
      ('${locations.wardA}',         '${hospitalA}', 'Maternity Ward'),
      ('${locations.entranceB}',     '${hospitalB}', 'Main Entrance');
  `);
});

after(async () => {
  await db.close();
});

/** Registers a terminal as the hospital administrator and returns its one-time key. */
async function registerTerminal(
  tx: Transaction,
  locationId: string,
  actor: string = users.adminA,
  name = "Front desk PC",
): Promise<RegisteredTerminal> {
  await actAs(tx, actor);
  const [{ result }] = await rows<{ result: { terminal_id: string; key: string } }>(
    tx,
    "select public.register_attendance_terminal($1, $2) as result",
    [locationId, name],
  );
  await actAsOwner(tx);
  return { id: result.terminal_id, key: result.key };
}

/**
 * Rosters a shift that starts `offsetMinutes` from now in the hospital's time zone,
 * so the engine can be tested against the real clock without freezing time.
 */
async function rosterShiftAt(
  tx: Transaction,
  options: {
    staffId: string;
    offsetMinutes: number;
    durationMinutes?: number;
    code: string;
    breakMinutes?: number;
    lateGraceMinutes?: number;
    checkInOpensMinutes?: number;
    overtimeThresholdMinutes?: number;
    earlyLeaveGraceMinutes?: number;
  },
): Promise<{ assignmentId: string; shiftId: string }> {
  const {
    staffId,
    offsetMinutes,
    durationMinutes = 480,
    code,
    breakMinutes = 0,
    lateGraceMinutes = 10,
    checkInOpensMinutes = 60,
    overtimeThresholdMinutes = 30,
    earlyLeaveGraceMinutes = 10,
  } = options;

  const [row] = await rows<{ assignment_id: string; shift_id: string }>(
    tx,
    `with local_start as (
       select date_trunc('minute', (now() + make_interval(mins => $3)) at time zone h.timezone) as at
       from public.hospitals h where h.id = $1
     ),
     new_shift as (
       insert into public.shifts (
         hospital_id, name, code, start_time, duration_minutes, break_minutes,
         late_grace_minutes, early_leave_grace_minutes, overtime_threshold_minutes, check_in_opens_minutes
       )
       select $1, $4, $4, (select at::time from local_start), $5, $6, $7, $8, $9, $10
       returning id
     )
     insert into public.shift_assignments (hospital_id, staff_id, shift_id, work_date)
     select $1, $2, new_shift.id, (select at::date from local_start) from new_shift
     returning id as assignment_id, shift_id`,
    [
      hospitalA,
      staffId,
      offsetMinutes,
      code,
      durationMinutes,
      breakMinutes,
      lateGraceMinutes,
      earlyLeaveGraceMinutes,
      overtimeThresholdMinutes,
      checkInOpensMinutes,
    ],
  );
  return { assignmentId: row.assignment_id, shiftId: row.shift_id };
}

/** Clocks in or out as a signed-in staff member, standing at the terminal with this key. */
async function clock(tx: Transaction, fn: "check_in" | "check_out", actor: string, terminalKey: string): Promise<ClockResult> {
  await actAs(tx, actor);
  const [{ result }] = await rows<{ result: ClockResult }>(tx, `select public.${fn}($1) as result`, [terminalKey]);
  await actAsOwner(tx);
  return result;
}

/**
 * now() is the transaction's start time, so a check-in and check-out in one test share the
 * same instant. Moving the open session back simulates the time that passes between two
 * real requests; the schedule can be moved too, to reach a check-out after the shift ended.
 */
async function backdateOpenSession(
  tx: Transaction,
  minutesAgo: { checkIn: number; scheduledStart?: number; scheduledEnd?: number },
): Promise<void> {
  await tx.query(
    `update public.attendance_records
     set check_in_at = now() - make_interval(mins => $1),
         scheduled_start = case when $2::int is null then scheduled_start else now() - make_interval(mins => $2::int) end,
         scheduled_end = case when $3::int is null then scheduled_end else now() - make_interval(mins => $3::int) end
     where closed_at is null`,
    [minutesAgo.checkIn, minutesAgo.scheduledStart ?? null, minutesAgo.scheduledEnd ?? null],
  );
}

describe("terminals", () => {
  test("registering returns the key once and stores only its hash", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      assert.match(terminal.key, /^t1\.[A-Za-z0-9_-]{43}$/);

      assert.deepEqual(
        await rows(
          tx,
          `select name, created_by, revoked_at,
                  key_hash = encode(extensions.digest($2, 'sha256'), 'hex') as hash_matches,
                  key_hash <> $2 as key_not_stored
           from public.attendance_terminals where id = $1`,
          [terminal.id, terminal.key],
        ),
        [{ name: "Front desk PC", created_by: users.adminA, revoked_at: null, hash_matches: true, key_not_stored: true }],
      );

      const second = await registerTerminal(tx, locations.mainEntranceA, users.adminA, "Front desk PC 2");
      assert.notEqual(second.key, terminal.key);
    });
  });

  test("only administrators of the hospital can register or switch off terminals", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      for (const actor of [users.adminB, users.nurseA, users.headA]) {
        await actAs(tx, actor);
        await expectSqlError(
          tx,
          "select public.register_attendance_terminal($1, 'Rogue PC')",
          { code: "P0002", message: "LOCATION_NOT_FOUND" },
          [locations.mainEntranceA],
        );
        await expectSqlError(
          tx,
          "select public.revoke_attendance_terminal($1)",
          { code: "P0002", message: "TERMINAL_NOT_FOUND" },
          [terminal.id],
        );
      }

      await actAs(tx, null, "anon");
      await expectSqlError(tx, "select public.register_attendance_terminal($1, 'Rogue PC')", {
        code: "42501",
        message: "permission denied",
      }, [locations.mainEntranceA]);
    });
  });

  test("inactive locations cannot register terminals, and names are checked", async () => {
    await inRollback(db, async (tx) => {
      await tx.query("update public.attendance_locations set is_active = false where id = $1", [locations.wardA]);
      await actAs(tx, users.adminA);
      await expectSqlError(
        tx,
        "select public.register_attendance_terminal($1, 'Ward PC')",
        { code: "22023", message: "LOCATION_NOT_ACTIVE" },
        [locations.wardA],
      );
      await expectSqlError(
        tx,
        "select public.register_attendance_terminal($1, ' ')",
        { code: "22023", message: "INVALID_TERMINAL_NAME" },
        [locations.mainEntranceA],
      );
    });
  });

  test("terminals are listed for administrators only, and nobody reads the key hash", async () => {
    await inRollback(db, async (tx) => {
      await registerTerminal(tx, locations.mainEntranceA);

      await actAs(tx, users.adminA);
      assert.deepEqual(await rows(tx, "select name, location_name from public.attendance_terminals_overview"), [
        { name: "Front desk PC", location_name: "Main Entrance" },
      ]);
      await expectSqlError(tx, "select key_hash from public.attendance_terminals", {
        code: "42501",
        message: "permission denied",
      });
      await expectSqlError(tx, "update public.attendance_terminals set revoked_at = now()", {
        code: "42501",
        message: "permission denied",
      });

      await actAs(tx, users.nurseA);
      assert.deepEqual(await rows(tx, "select id from public.attendance_terminals_overview"), []);
      await actAs(tx, users.adminB);
      assert.deepEqual(await rows(tx, "select id from public.attendance_terminals_overview"), []);
    });
  });

  test("the terminal screen can identify itself without a signed-in user", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);

      await actAs(tx, null, "anon");
      assert.deepEqual(
        await rows(tx, "select public.terminal_context($1) as context", [terminal.key]),
        [
          {
            context: {
              terminal_id: terminal.id,
              terminal_name: "Front desk PC",
              location_name: "Main Entrance",
              hospital_name: "Korle General Hospital",
              timezone: "Africa/Accra",
            },
          },
        ],
      );
      assert.deepEqual(await rows(tx, "select public.terminal_context($1) as context", [`t1.${"a".repeat(43)}`]), [
        { context: null },
      ]);

      await actAs(tx, users.adminA);
      await tx.query("select public.revoke_attendance_terminal($1)", [terminal.id]);
      await actAs(tx, null, "anon");
      assert.deepEqual(await rows(tx, "select public.terminal_context($1) as context", [terminal.key]), [{ context: null }]);
    });
  });

  test("a staff ID resolves to the sign-in email only at an active terminal of the same hospital", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      const lookup = async (key: string, employeeNumber: string) => {
        await actAs(tx, null, "anon");
        const [{ email }] = await rows<{ email: string | null }>(tx, "select public.terminal_sign_in_email($1, $2) as email", [
          key,
          employeeNumber,
        ]);
        await actAsOwner(tx);
        return email;
      };

      assert.equal(await lookup(terminal.key, "KGH-002"), "e.owusu@kgh.example.test");
      assert.equal(await lookup(terminal.key, " kgh-002 "), "e.owusu@kgh.example.test", "case and spaces are ignored");
      assert.equal(await lookup(terminal.key, "KGH-004"), null, "staff without an account");
      assert.equal(await lookup(terminal.key, "NRH-001"), null, "staff of another hospital");
      assert.equal(await lookup(`t1.${"a".repeat(43)}`, "KGH-002"), null, "unknown terminal");

      await tx.query("update public.staff set status = 'suspended' where id = $1", [staff.midwifeA]);
      assert.equal(await lookup(terminal.key, "KGH-003"), null, "suspended staff");

      await actAs(tx, users.adminA);
      await tx.query("select public.revoke_attendance_terminal($1)", [terminal.id]);
      assert.equal(await lookup(terminal.key, "KGH-002"), null, "switched-off terminal");
    });
  });
});

describe("clock in", () => {
  test("an on-time clock-in records Present and logs the terminal", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, code: "T1" });

      const result = await clock(tx, "check_in", users.nurseA, terminal.key);
      assert.equal(result.ok, true);
      assert.equal(result.status, "present");
      assert.equal(result.late_minutes, 0);
      assert.equal(result.staff_name, "Efua Owusu");
      assert.equal(result.shift_name, "T1");
      assert.equal(result.location_name, "Main Entrance");

      assert.deepEqual(
        await rows(
          tx,
          `select scan_type, outcome, rejection_code, attendance_record_id is not null as linked, terminal_id, location_id
           from public.attendance_events order by id desc limit 1`,
        ),
        [
          {
            scan_type: "check_in",
            outcome: "accepted",
            rejection_code: null,
            linked: true,
            terminal_id: terminal.id,
            location_id: locations.mainEntranceA,
          },
        ],
      );
      assert.deepEqual(await rows(tx, "select check_in_location_id from public.attendance_records"), [
        { check_in_location_id: locations.mainEntranceA },
      ]);
    });
  });

  test("a clock-in after the grace period records Late with the minutes", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: -30, code: "T2", lateGraceMinutes: 10 });

      const result = await clock(tx, "check_in", users.nurseA, terminal.key);
      assert.equal(result.status, "late");
      assert.equal(result.late_minutes, 30);

      assert.deepEqual(await rows(tx, "select is_late, status from public.attendance_records"), [
        { is_late: true, status: "late" },
      ]);
    });
  });

  test("a second clock-in is rejected and the attempt is logged", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, code: "T4" });

      await clock(tx, "check_in", users.nurseA, terminal.key);
      const second = await clock(tx, "check_in", users.nurseA, terminal.key);
      assert.deepEqual(second, { ok: false, code: "ALREADY_CHECKED_IN" });

      assert.deepEqual(await rows(tx, "select count(*)::int as count from public.attendance_records"), [{ count: 1 }]);
      assert.deepEqual(
        await rows(tx, "select outcome, rejection_code from public.attendance_events order by id desc limit 1"),
        [{ outcome: "rejected", rejection_code: "ALREADY_CHECKED_IN" }],
      );
    });
  });

  test("rejects unknown, switched-off and other hospitals' terminals, and inactive locations", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      const ward = await registerTerminal(tx, locations.wardA, users.adminA, "Ward PC");
      const otherHospital = await registerTerminal(tx, locations.entranceB, users.adminB);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, code: "T5" });

      assert.equal((await clock(tx, "check_in", users.nurseA, "not-a-key")).code, "TERMINAL_NOT_REGISTERED");
      assert.equal((await clock(tx, "check_in", users.nurseA, `t1.${"a".repeat(43)}`)).code, "TERMINAL_NOT_REGISTERED");
      assert.equal((await clock(tx, "check_in", users.nurseA, otherHospital.key)).code, "WRONG_HOSPITAL");

      await tx.query("update public.attendance_locations set is_active = false where id = $1", [locations.wardA]);
      assert.equal((await clock(tx, "check_in", users.nurseA, ward.key)).code, "LOCATION_NOT_ACTIVE");

      await actAs(tx, users.adminA);
      await tx.query("select public.revoke_attendance_terminal($1)", [terminal.id]);
      await actAsOwner(tx);
      assert.equal((await clock(tx, "check_in", users.nurseA, terminal.key)).code, "TERMINAL_REVOKED");

      assert.deepEqual(await rows(tx, "select count(*)::int as count from public.attendance_records"), [{ count: 0 }]);
    });
  });

  test("rejects staff with no shift, unless the hospital allows unscheduled attendance", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);

      assert.equal((await clock(tx, "check_in", users.nurseA, terminal.key)).code, "NO_SHIFT");

      await tx.query("update public.hospital_settings set allow_unscheduled_check_in = true where hospital_id = $1", [
        hospitalA,
      ]);
      const result = await clock(tx, "check_in", users.nurseA, terminal.key);
      assert.equal(result.ok, true);
      assert.deepEqual(result.flags, ["unscheduled"]);
      assert.deepEqual(
        await rows(tx, "select shift_assignment_id, status from public.attendance_records"),
        [{ shift_assignment_id: null, status: "present" }],
      );
    });
  });

  test("rejects a clock-in before the check-in window opens", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 180, code: "T6", checkInOpensMinutes: 60 });

      assert.equal((await clock(tx, "check_in", users.nurseA, terminal.key)).code, "NO_SHIFT");
    });
  });

  test("suspended staff and users without a staff record cannot clock in", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, code: "T7" });
      await tx.query("update public.staff set status = 'suspended' where id = $1", [staff.nurseA]);

      assert.equal((await clock(tx, "check_in", users.nurseA, terminal.key)).code, "STAFF_NOT_ACTIVE");
      assert.equal((await clock(tx, "check_in", users.adminA, terminal.key)).code, "STAFF_NOT_ACTIVE");
    });
  });

  test("a terminal key alone cannot clock anyone in", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await actAs(tx, null, "anon");
      await expectSqlError(tx, "select public.check_in($1)", { code: "42501", message: "permission denied" }, [terminal.key]);
      await expectSqlError(tx, "select public.check_out($1)", { code: "42501", message: "permission denied" }, [terminal.key]);
    });
  });
});

describe("clock out", () => {
  test("records worked time and overtime", async () => {
    await inRollback(db, async (tx) => {
      await tx.query("update public.hospital_settings set min_session_minutes = 0 where hospital_id = $1", [hospitalA]);
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      const ward = await registerTerminal(tx, locations.wardA, users.adminA, "Ward PC");
      await rosterShiftAt(tx, {
        staffId: staff.nurseA,
        offsetMinutes: 0,
        durationMinutes: 60,
        code: "O1",
        overtimeThresholdMinutes: 30,
        lateGraceMinutes: 120,
      });

      await clock(tx, "check_in", users.nurseA, terminal.key);
      // The session began 110 minutes ago on a shift that ended an hour ago.
      await backdateOpenSession(tx, { checkIn: 110, scheduledStart: 120, scheduledEnd: 60 });
      const result = await clock(tx, "check_out", users.nurseA, ward.key);

      assert.equal(result.ok, true);
      assert.equal(result.staff_name, "Efua Owusu");
      assert.equal(result.worked_minutes, 110);
      assert.equal(result.overtime_minutes, 60);
      assert.equal(result.is_overtime, true);
      assert.deepEqual(
        await rows(tx, "select closed_at is not null as closed, check_out_location_id from public.attendance_records"),
        [{ closed: true, check_out_location_id: locations.wardA }],
      );
    });
  });

  test("records early leave when the shift is left before its end", async () => {
    await inRollback(db, async (tx) => {
      await tx.query(
        `update public.hospital_settings
         set min_session_minutes = 0, half_day_threshold_percent = 20 where hospital_id = $1`,
        [hospitalA],
      );
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, {
        staffId: staff.nurseA,
        offsetMinutes: -30,
        durationMinutes: 60,
        code: "O2",
        earlyLeaveGraceMinutes: 10,
        lateGraceMinutes: 60,
      });

      await clock(tx, "check_in", users.nurseA, terminal.key);
      await backdateOpenSession(tx, { checkIn: 25 });
      const result = await clock(tx, "check_out", users.nurseA, terminal.key);
      // The shift runs for another 30 minutes; elapsed minutes are floored, so 29 or 30.
      assert.ok(
        result.early_leave_minutes === 29 || result.early_leave_minutes === 30,
        `expected 29 or 30 early-leave minutes, got ${result.early_leave_minutes}`,
      );
      assert.equal(result.is_early_leave, true);
      assert.equal(result.worked_minutes, 25);
    });
  });

  test("a session far shorter than the shift becomes a half day", async () => {
    await inRollback(db, async (tx) => {
      await tx.query("update public.hospital_settings set min_session_minutes = 0 where hospital_id = $1", [hospitalA]);
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: -30, durationMinutes: 480, code: "O3", lateGraceMinutes: 60 });

      await clock(tx, "check_in", users.nurseA, terminal.key);
      await backdateOpenSession(tx, { checkIn: 30 });
      // 30 minutes worked of a scheduled 8 hours.
      const result = await clock(tx, "check_out", users.nurseA, terminal.key);
      assert.equal(result.status, "half_day");
      assert.equal(result.worked_minutes, 30);
    });
  });

  test("rejects a clock-out without an open session and one that is too soon", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      assert.equal((await clock(tx, "check_out", users.nurseA, terminal.key)).code, "NO_OPEN_SESSION");

      await tx.query("update public.hospital_settings set min_session_minutes = 10 where hospital_id = $1", [hospitalA]);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, code: "O4" });
      await clock(tx, "check_in", users.nurseA, terminal.key);

      assert.equal((await clock(tx, "check_out", users.nurseA, terminal.key)).code, "TOO_SOON");
    });
  });

  test("rejects a clock-out once the window has closed", async () => {
    await inRollback(db, async (tx) => {
      await tx.query(
        "update public.hospital_settings set min_session_minutes = 0, check_out_window_minutes = 60 where hospital_id = $1",
        [hospitalA],
      );
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, durationMinutes: 60, code: "O5" });
      await clock(tx, "check_in", users.nurseA, terminal.key);

      // The shift ended long ago, so the window for clocking out has passed.
      await tx.query(
        "update public.attendance_records set scheduled_end = now() - interval '3 hours' where staff_id = $1",
        [staff.nurseA],
      );
      assert.equal((await clock(tx, "check_out", users.nurseA, terminal.key)).code, "CHECK_OUT_WINDOW_CLOSED");
    });
  });

  test("an overnight shift is clocked out on the next calendar day", async () => {
    await inRollback(db, async (tx) => {
      await tx.query("update public.hospital_settings set min_session_minutes = 0 where hospital_id = $1", [hospitalA]);
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      // Starts 30 minutes ago, runs 8 hours: the session spans midnight in some time zones.
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: -30, durationMinutes: 480, code: "N1", lateGraceMinutes: 60 });

      await clock(tx, "check_in", users.nurseA, terminal.key);
      const [record] = await rows<{ work_date: string; scheduled_start: Date; scheduled_end: Date }>(
        tx,
        "select work_date::text, scheduled_start, scheduled_end from public.attendance_records",
      );
      // The record belongs to the date the shift started, whatever day the clock-out happens.
      assert.equal(
        record.work_date,
        (await rows<{ d: string }>(tx, "select (scheduled_start at time zone 'Africa/Accra')::date::text as d from public.attendance_records"))[0].d,
      );
      assert.equal(record.scheduled_end.getTime() - record.scheduled_start.getTime(), 480 * 60 * 1000);
    });
  });
});

describe("scheduled finalisation", () => {
  test("marks elapsed shifts without a clock-in as absent", async () => {
    await inRollback(db, async (tx) => {
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: -600, durationMinutes: 60, code: "F1" });
      await rosterShiftAt(tx, { staffId: staff.midwifeA, offsetMinutes: 60, durationMinutes: 60, code: "F2" });

      const [{ result }] = await rows<{ result: { absent_created: number; sessions_closed: number } }>(
        tx,
        "select private.finalize_elapsed_shifts() as result",
      );
      assert.equal(result.absent_created, 1);

      assert.deepEqual(
        await rows(tx, "select staff_id, status, closed_at is not null as closed from public.attendance_records"),
        [{ staff_id: staff.nurseA, status: "absent", closed: true }],
      );

      // Running it again changes nothing.
      const [{ result: second }] = await rows<{ result: { absent_created: number } }>(
        tx,
        "select private.finalize_elapsed_shifts() as result",
      );
      assert.equal(second.absent_created, 0);
    });
  });

  test("closes forgotten sessions without inventing a clock-out time", async () => {
    await inRollback(db, async (tx) => {
      await tx.query(
        "update public.hospital_settings set min_session_minutes = 0, check_out_window_minutes = 60 where hospital_id = $1",
        [hospitalA],
      );
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, durationMinutes: 60, code: "F3" });
      await clock(tx, "check_in", users.nurseA, terminal.key);
      await tx.query("update public.attendance_records set scheduled_end = now() - interval '3 hours'");

      const [{ result }] = await rows<{ result: { sessions_closed: number } }>(
        tx,
        "select private.finalize_elapsed_shifts() as result",
      );
      assert.equal(result.sessions_closed, 1);

      assert.deepEqual(
        await rows(tx, "select check_out_at, closed_at is not null as closed, flags::text[] as flags from public.attendance_records"),
        [{ check_out_at: null, closed: true, flags: ["missed_check_out"] }],
      );
    });
  });

  test("a closed session frees the staff member to clock in again", async () => {
    await inRollback(db, async (tx) => {
      await tx.query(
        "update public.hospital_settings set min_session_minutes = 0, check_out_window_minutes = 60 where hospital_id = $1",
        [hospitalA],
      );
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: -30, durationMinutes: 60, code: "F4", lateGraceMinutes: 60 });
      await clock(tx, "check_in", users.nurseA, terminal.key);
      await tx.query("update public.attendance_records set scheduled_end = now() - interval '3 hours'");
      await tx.query("select private.finalize_elapsed_shifts()");

      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 120, durationMinutes: 60, code: "F5", checkInOpensMinutes: 180 });
      const result = await clock(tx, "check_in", users.nurseA, terminal.key);
      assert.equal(result.ok, true);
    });
  });
});

describe("attendance visibility", () => {
  test("records follow role scope and cannot be written by any client role", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, code: "V1" });
      await clock(tx, "check_in", users.nurseA, terminal.key);

      const countFor = async (actor: string) => {
        await actAs(tx, actor);
        const [{ count }] = await rows<{ count: number }>(tx, "select count(*)::int as count from public.attendance_records");
        return count;
      };

      assert.equal(await countFor(users.nurseA), 1, "own record");
      assert.equal(await countFor(users.headA), 1, "department head");
      assert.equal(await countFor(users.adminA), 1, "hospital admin");
      assert.equal(await countFor(users.superAdmin), 1, "super admin");
      assert.equal(await countFor(users.midwifeA), 0, "another department's staff");
      assert.equal(await countFor(users.adminB), 0, "another hospital's admin");

      await actAs(tx, users.adminA);
      await expectSqlError(
        tx,
        "update public.attendance_records set status = 'present', check_in_at = now() - interval '2 hours'",
        { code: "42501", message: "permission denied" },
      );
      await expectSqlError(tx, "delete from public.attendance_records", { code: "42501", message: "permission denied" });
      await expectSqlError(
        tx,
        `insert into public.attendance_records (hospital_id, staff_id, department_id, work_date, status, flags)
         values ($1, $2, $3, current_date, 'present', '{unscheduled}')`,
        { code: "42501", message: "permission denied" },
        [hospitalA, staff.nurseA, departments.emergencyA],
      );
    });
  });

  test("the clock log is append-only and scoped", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, code: "V2" });
      await clock(tx, "check_in", users.nurseA, terminal.key);

      await expectSqlError(tx, "update public.attendance_events set outcome = 'rejected'", {
        code: "42501",
        message: "APPEND_ONLY_TABLE",
      });
      await expectSqlError(tx, "delete from public.attendance_events", { code: "42501", message: "APPEND_ONLY_TABLE" });

      await actAs(tx, users.nurseA);
      assert.equal((await rows(tx, "select id from public.attendance_events")).length, 1);
      await actAs(tx, users.midwifeA);
      assert.deepEqual(await rows(tx, "select id from public.attendance_events"), []);
      await actAs(tx, users.adminB);
      assert.deepEqual(await rows(tx, "select id from public.attendance_events"), []);
    });
  });

  test("the overview applies the same visibility as the tables", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, code: "V3" });
      await clock(tx, "check_in", users.nurseA, terminal.key);

      await actAs(tx, users.headA);
      assert.deepEqual(
        await rows(tx, "select staff_name, department_name, shift_code, check_in_location_name from public.attendance_overview"),
        [
          {
            staff_name: "Efua Owusu",
            department_name: "Emergency",
            shift_code: "V3",
            check_in_location_name: "Main Entrance",
          },
        ],
      );

      await actAs(tx, users.adminB);
      assert.deepEqual(await rows(tx, "select id from public.attendance_overview"), []);

      await actAs(tx, null, "anon");
      await expectSqlError(tx, "select id from public.attendance_overview", { code: "42501", message: "permission denied" });
    });
  });

  test("the terminal overview shows when each terminal was last used", async () => {
    await inRollback(db, async (tx) => {
      const terminal = await registerTerminal(tx, locations.mainEntranceA);
      await actAs(tx, users.adminA);
      assert.deepEqual(await rows(tx, "select last_used_at from public.attendance_terminals_overview"), [
        { last_used_at: null },
      ]);
      await actAsOwner(tx);

      await rosterShiftAt(tx, { staffId: staff.nurseA, offsetMinutes: 0, code: "V4" });
      await clock(tx, "check_in", users.nurseA, terminal.key);

      await actAs(tx, users.adminA);
      assert.deepEqual(await rows(tx, "select last_used_at is not null as used from public.attendance_terminals_overview"), [
        { used: true },
      ]);
    });
  });
});
