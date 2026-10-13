import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { changedFields, entityLabel } from "../../src/features/audit/labels.ts";
import { auditFiltersSchema } from "../../src/features/audit/schemas.ts";

describe("changedFields", () => {
  test("lists only the fields that actually changed", () => {
    const changes = changedFields(
      { job_title: "Staff Nurse", phone: null, updated_at: "2026-09-01T10:00:00Z" },
      { job_title: "Senior Staff Nurse", phone: null, updated_at: "2026-09-02T10:00:00Z" },
    );
    assert.deepEqual(changes, [{ field: "Job title", from: "Staff Nurse", to: "Senior Staff Nurse" }]);
  });

  test("reads booleans, nulls and arrays plainly", () => {
    const changes = changedFields(
      { is_active: true, flags: [], termination_date: null },
      { is_active: false, flags: ["missed_check_out"], termination_date: "2026-09-30" },
    );
    assert.deepEqual(changes, [
      { field: "Is active", from: "Yes", to: "No" },
      { field: "Flags", from: "—", to: "missed_check_out" },
      { field: "Termination date", from: "—", to: "2026-09-30" },
    ]);
  });

  test("has nothing to show for creations and deletions", () => {
    assert.deepEqual(changedFields(null, { job_title: "Porter" }), []);
    assert.deepEqual(changedFields({ job_title: "Porter" }, null), []);
  });
});

describe("entityLabel", () => {
  test("names tables in the words staff use, falling back to the table name", () => {
    assert.equal(entityLabel("attendance_records"), "Attendance record");
    assert.equal(entityLabel("shift_assignments"), "Rostered shift");
    assert.equal(entityLabel("something_new"), "something_new");
  });
});

describe("auditFiltersSchema", () => {
  test("only known tables and actions pass through", () => {
    assert.deepEqual(auditFiltersSchema.parse({ entity: "staff", action: "update", page: "2" }), {
      entity: "staff",
      action: "update",
      page: 2,
    });
    assert.deepEqual(auditFiltersSchema.parse({ entity: "pg_class; drop table", action: "x", page: "-3" }), {
      entity: "all",
      action: "all",
      page: 1,
    });
  });
});
