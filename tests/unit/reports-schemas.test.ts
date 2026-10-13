import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reportDailySchema, reportSummarySchema } from "../../src/features/reports/schemas.ts";
import { hospitalSettingsSchema } from "../../src/features/settings/schemas.ts";

const summaryRow = {
  staff_id: "0a000000-0000-4000-8000-000000000052",
  staff_name: "Efua Owusu",
  employee_number: "KGH-002",
  department_id: "0a000000-0000-4000-8000-0000000000d1",
  department_name: "Emergency",
  recorded_days: 3,
  present_count: 1,
  late_count: 1,
  absent_count: 1,
  half_day_count: 0,
  worked_minutes: 970,
  overtime_minutes: 30,
  late_minutes: 20,
  missed_check_out_count: 0,
};

describe("report schemas", () => {
  test("accept the shape the database returns", () => {
    assert.equal(reportSummarySchema.parse([summaryRow]).length, 1);
    assert.equal(reportSummarySchema.parse([]).length, 0);
    assert.equal(
      reportDailySchema.parse([
        { work_date: "2026-09-01", present_count: 2, late_count: 0, absent_count: 0, half_day_count: 0 },
      ]).length,
      1,
    );
  });

  test("reject a result that does not match the contract", () => {
    const missingField: Partial<typeof summaryRow> = { ...summaryRow };
    delete missingField.worked_minutes;
    assert.equal(reportSummarySchema.safeParse([missingField]).success, false);
    assert.equal(reportSummarySchema.safeParse([{ ...summaryRow, present_count: "1" }]).success, false);
    assert.equal(reportDailySchema.safeParse([{ work_date: "01/09/2026" }]).success, false);
  });
});

describe("hospitalSettingsSchema", () => {
  const valid = {
    allowUnscheduledCheckIn: false,
    minSessionMinutes: "10",
    checkOutWindowMinutes: "480",
    halfDayThresholdPercent: "50",
  };

  test("accepts numbers submitted as strings by the form", () => {
    const result = hospitalSettingsSchema.parse(valid);
    assert.equal(result.minSessionMinutes, 10);
    assert.equal(result.checkOutWindowMinutes, 480);
  });

  test("keeps the check-out window and half-day threshold within sensible bounds", () => {
    assert.equal(hospitalSettingsSchema.safeParse({ ...valid, checkOutWindowMinutes: "30" }).success, false);
    assert.equal(hospitalSettingsSchema.safeParse({ ...valid, checkOutWindowMinutes: "2000" }).success, false);
    assert.equal(hospitalSettingsSchema.safeParse({ ...valid, halfDayThresholdPercent: "0" }).success, false);
    assert.equal(hospitalSettingsSchema.safeParse({ ...valid, halfDayThresholdPercent: "100" }).success, false);
  });
});
