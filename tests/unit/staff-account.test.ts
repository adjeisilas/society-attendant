import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { accountStateOf } from "../../src/features/staff/labels.ts";
import { staffFiltersSchema, staffStatusChangeSchema } from "../../src/features/staff/schemas.ts";

describe("accountStateOf", () => {
  test("describes every account situation", () => {
    assert.equal(accountStateOf({ userId: null, accountIsActive: null, accountActivatedAt: null }), "none");
    assert.equal(accountStateOf({ userId: "u1", accountIsActive: true, accountActivatedAt: null }), "invited");
    assert.equal(
      accountStateOf({ userId: "u1", accountIsActive: true, accountActivatedAt: "2026-09-01T10:00:00Z" }),
      "active",
    );
    assert.equal(accountStateOf({ userId: "u1", accountIsActive: false, accountActivatedAt: null }), "disabled");
  });

  test("reports an account it cannot see as restricted", () => {
    // Department heads can read staff rows but not their profiles.
    assert.equal(accountStateOf({ userId: "u1", accountIsActive: null, accountActivatedAt: null }), "restricted");
  });
});

describe("staffStatusChangeSchema", () => {
  test("requires a termination date only for terminations", () => {
    const terminated = staffStatusChangeSchema.safeParse({ status: "terminated", effectiveDate: "", reason: "Contract ended" });
    assert.equal(terminated.success, false);
    assert.deepEqual(terminated.error?.issues.map((issue) => issue.path.join(".")), ["effectiveDate"]);

    const suspended = staffStatusChangeSchema.safeParse({ status: "suspended", effectiveDate: "", reason: "Under review" });
    assert.equal(suspended.success, true);
    assert.equal(suspended.data?.effectiveDate, null);
  });

  test("requires a meaningful reason", () => {
    const result = staffStatusChangeSchema.safeParse({ status: "suspended", effectiveDate: "", reason: "no" });
    assert.equal(result.success, false);
  });
});

describe("staffFiltersSchema", () => {
  test("falls back to defaults for missing or invalid values", () => {
    assert.deepEqual(staffFiltersSchema.parse({}), { q: "", department: "", status: "active", page: 1 });
    assert.deepEqual(staffFiltersSchema.parse({ status: "retired", department: "not-a-uuid", page: "0" }), {
      q: "",
      department: "",
      status: "active",
      page: 1,
    });
  });

  test("keeps valid filters", () => {
    const filters = staffFiltersSchema.parse({
      q: "  owusu ",
      department: "0a000000-0000-4000-8000-0000000000d1",
      status: "all",
      page: "3",
    });
    assert.deepEqual(filters, {
      q: "owusu",
      department: "0a000000-0000-4000-8000-0000000000d1",
      status: "all",
      page: 3,
    });
  });
});
