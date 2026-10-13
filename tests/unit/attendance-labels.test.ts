import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ATTENDANCE_STATUS, clockErrorMessage, formatMinutes } from "../../src/features/attendance/labels.ts";
import { clockResponseSchema } from "../../src/features/attendance/schemas.ts";
import { isEmailIdentifier, terminalClockSchema } from "../../src/features/terminals/schemas.ts";

describe("attendance labels", () => {
  test("every status has a label and a tone", () => {
    for (const status of ["present", "late", "absent", "on_leave", "off_day", "half_day"] as const) {
      assert.ok(ATTENDANCE_STATUS[status].label.length > 0, status);
      assert.ok(ATTENDANCE_STATUS[status].tone.length > 0, status);
    }
  });

  test("clock-in errors explain what to do, with a fallback for unknown codes", () => {
    assert.match(clockErrorMessage("NO_SHIFT"), /no shift/i);
    assert.match(clockErrorMessage("ALREADY_CHECKED_IN"), /already clocked in/i);
    assert.match(clockErrorMessage("TERMINAL_REVOKED"), /switched off/i);
    assert.match(clockErrorMessage("SOMETHING_NEW"), /could not be recorded/i);
  });

  test("formats worked minutes, and shows a dash when there are none", () => {
    assert.equal(formatMinutes(465), "7 h 45 min");
    assert.equal(formatMinutes(0), "0 min");
    assert.equal(formatMinutes(null), "—");
    assert.equal(formatMinutes(undefined), "—");
  });
});

describe("terminal input", () => {
  test("accepts a staff ID or email, a password and an action", () => {
    assert.equal(
      terminalClockSchema.safeParse({ action: "check_in", identifier: " KGH-002 ", password: "secret" }).success,
      true,
    );
    assert.equal(
      terminalClockSchema.safeParse({ action: "check_out", identifier: "e.owusu@kgh.example", password: "secret" }).success,
      true,
    );
  });

  test("rejects missing credentials and unknown actions", () => {
    assert.equal(terminalClockSchema.safeParse({ action: "check_in", identifier: "", password: "secret" }).success, false);
    assert.equal(terminalClockSchema.safeParse({ action: "check_in", identifier: "KGH-002", password: "" }).success, false);
    assert.equal(terminalClockSchema.safeParse({ action: "break", identifier: "KGH-002", password: "secret" }).success, false);
  });

  test("tells a sign-in email from a staff ID", () => {
    assert.equal(isEmailIdentifier("e.owusu@kgh.example"), true);
    assert.equal(isEmailIdentifier("KGH-002"), false);
  });
});

describe("clock response", () => {
  test("parses a successful clock-in", () => {
    const result = clockResponseSchema.parse({
      ok: true,
      record_id: "0a000000-0000-4000-8000-000000000051",
      staff_name: "Efua Owusu",
      status: "late",
      late_minutes: 12,
      shift_name: "Morning",
      location_name: "Main Entrance",
      flags: ["unscheduled"],
    });
    assert.equal(result.ok, true);
  });

  test("parses a rejection", () => {
    const result = clockResponseSchema.parse({ ok: false, code: "NO_SHIFT" });
    assert.equal(result.ok, false);
  });

  test("rejects a response that does not match the contract", () => {
    assert.equal(clockResponseSchema.safeParse({ ok: true, status: "present" }).success, false);
    assert.equal(
      clockResponseSchema.safeParse({ ok: true, record_id: "x", staff_name: "A", status: "present" }).success,
      false,
    );
  });
});
