import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assignmentOutcomeSchema, assignShiftsSchema, MAX_ROSTER_DAYS } from "../../src/features/roster/schemas.ts";

const validInput = {
  shiftId: "0a000000-0000-4000-8000-0000000005a1",
  staffIds: ["0a000000-0000-4000-8000-000000000051"],
  startDate: "2026-09-14",
  endDate: "2026-09-20",
  weekdays: [1, 3, 5],
};

describe("assignShiftsSchema", () => {
  test("accepts a valid range", () => {
    const result = assignShiftsSchema.safeParse(validInput);
    assert.equal(result.success, true);
  });

  test("accepts weekdays submitted as strings by the form", () => {
    const result = assignShiftsSchema.safeParse({ ...validInput, weekdays: ["1", "5"] });
    assert.deepEqual(result.data?.weekdays, [1, 5]);
  });

  test("rejects an end date before the start date", () => {
    const result = assignShiftsSchema.safeParse({ ...validInput, startDate: "2026-09-20", endDate: "2026-09-14" });
    assert.equal(result.success, false);
    assert.deepEqual(result.error?.issues.map((issue) => issue.path.join(".")), ["endDate"]);
  });

  test("limits how far ahead one batch can go", () => {
    const result = assignShiftsSchema.safeParse({ ...validInput, startDate: "2026-01-01", endDate: "2026-12-31" });
    assert.equal(result.success, false);
    assert.match(result.error?.issues[0]?.message ?? "", new RegExp(String(MAX_ROSTER_DAYS)));
  });

  test("requires staff and at least one weekday", () => {
    assert.equal(assignShiftsSchema.safeParse({ ...validInput, staffIds: [] }).success, false);
    assert.equal(assignShiftsSchema.safeParse({ ...validInput, weekdays: [] }).success, false);
  });
});

describe("assignmentOutcomeSchema", () => {
  test("parses the database result", () => {
    const outcome = assignmentOutcomeSchema.parse({
      created: 3,
      skipped: [{ staff_id: "0a000000-0000-4000-8000-000000000051", work_date: "2026-09-14", reason: "overlap" }],
    });
    assert.equal(outcome.created, 3);
    assert.equal(outcome.skipped[0]?.reason, "overlap");
  });

  test("rejects an unexpected shape", () => {
    assert.equal(assignmentOutcomeSchema.safeParse({ created: 1 }).success, false);
    assert.equal(
      assignmentOutcomeSchema.safeParse({ created: 1, skipped: [{ staff_id: "x", work_date: "2026-09-14", reason: "overlap" }] })
        .success,
      false,
    );
  });
});
