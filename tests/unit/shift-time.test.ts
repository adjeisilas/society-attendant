import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shiftSchema } from "../../src/features/shifts/schemas.ts";
import { durationBetween, formatDuration, formatShiftTimes, minutesToTime, shiftTiming, timeToMinutes } from "../../src/features/shifts/time.ts";

describe("shift times", () => {
  test("parses and formats times of day", () => {
    assert.equal(timeToMinutes("07:00"), 420);
    assert.equal(timeToMinutes("23:45:00"), 1425);
    assert.equal(minutesToTime(1500), "01:00");
    assert.throws(() => timeToMinutes("24:00"));
  });

  test("an end time at or before the start is on the next day", () => {
    assert.equal(durationBetween("07:00", "15:00"), 480);
    assert.equal(durationBetween("23:00", "07:00"), 480);
    assert.equal(durationBetween("08:00", "08:00"), 1440);
  });

  test("describes a shift's timing", () => {
    assert.deepEqual(shiftTiming("23:00:00", 480), { startTime: "23:00", endTime: "07:00", endsNextDay: true });
    assert.deepEqual(shiftTiming("07:00:00", 480), { startTime: "07:00", endTime: "15:00", endsNextDay: false });
    // A shift ending exactly at midnight does not run into the next day.
    assert.deepEqual(shiftTiming("16:00:00", 480), { startTime: "16:00", endTime: "00:00", endsNextDay: false });
    assert.equal(formatShiftTimes("23:00:00", 480), "23:00–07:00 (next day)");
  });

  test("formats durations", () => {
    assert.equal(formatDuration(480), "8 h");
    assert.equal(formatDuration(510), "8 h 30 min");
    assert.equal(formatDuration(45), "45 min");
  });
});

describe("shiftSchema", () => {
  const base = {
    name: "Night",
    code: "n",
    departmentId: "",
    startTime: "23:00",
    endTime: "07:00",
    breakMinutes: 30,
    lateGraceMinutes: 10,
    earlyLeaveGraceMinutes: 10,
    overtimeThresholdMinutes: 30,
    checkInOpensMinutes: 60,
    isActive: true,
  };

  test("derives the duration and normalises the code", () => {
    const result = shiftSchema.parse(base);
    assert.equal(result.durationMinutes, 480);
    assert.equal(result.code, "N");
    assert.equal(result.departmentId, null);
  });

  test("accepts numbers submitted as strings by the form", () => {
    const result = shiftSchema.parse({ ...base, breakMinutes: "45", lateGraceMinutes: "0" });
    assert.equal(result.breakMinutes, 45);
    assert.equal(result.lateGraceMinutes, 0);
  });

  test("rejects a break that is not shorter than the shift", () => {
    const result = shiftSchema.safeParse({ ...base, startTime: "07:00", endTime: "09:00", breakMinutes: 120 });
    assert.equal(result.success, false);
    assert.deepEqual(result.error?.issues.map((issue) => issue.path.join(".")), ["breakMinutes"]);
  });

  test("rejects shifts shorter than 30 minutes", () => {
    const result = shiftSchema.safeParse({ ...base, startTime: "07:00", endTime: "07:20", breakMinutes: 0 });
    assert.equal(result.success, false);
    assert.deepEqual(result.error?.issues.map((issue) => issue.path.join(".")), ["endTime"]);
  });

  test("rejects malformed times without throwing", () => {
    const result = shiftSchema.safeParse({ ...base, startTime: "7am", endTime: "" });
    assert.equal(result.success, false);
  });
});
