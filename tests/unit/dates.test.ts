import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addDaysToIsoDate,
  datesOnWeekdays,
  daysInRange,
  formatIsoDate,
  isIsoDate,
  startOfIsoWeek,
  todayInTimeZone,
  weekDates,
  weekdayOf,
} from "../../src/lib/dates.ts";

describe("ISO date helpers", () => {
  test("recognises real calendar dates only", () => {
    assert.equal(isIsoDate("2026-09-16"), true);
    assert.equal(isIsoDate("2026-02-30"), false);
    assert.equal(isIsoDate("2026-9-16"), false);
    assert.equal(isIsoDate("16/09/2026"), false);
    assert.equal(isIsoDate(undefined), false);
  });

  test("adds days across month and year boundaries", () => {
    assert.equal(addDaysToIsoDate("2026-09-30", 1), "2026-10-01");
    assert.equal(addDaysToIsoDate("2027-01-01", -1), "2026-12-31");
  });

  test("weeks start on Monday", () => {
    assert.equal(startOfIsoWeek("2026-09-16"), "2026-09-14");
    assert.equal(startOfIsoWeek("2026-09-20"), "2026-09-14");
    assert.equal(startOfIsoWeek("2026-09-14"), "2026-09-14");
    assert.deepEqual(weekDates("2026-09-14").at(-1), "2026-09-20");
  });

  test("counts days inclusively", () => {
    assert.equal(daysInRange("2026-09-14", "2026-09-14"), 1);
    assert.equal(daysInRange("2026-09-14", "2026-09-20"), 7);
    assert.equal(daysInRange("2026-09-20", "2026-09-14"), -5);
  });

  test("selects only the chosen weekdays", () => {
    // Weekdays are 0 = Sunday, so Monday to Friday is 1–5.
    const weekdays = datesOnWeekdays("2026-09-14", "2026-09-27", [1, 2, 3, 4, 5]);
    assert.equal(weekdays.length, 10);
    assert.equal(weekdays[0], "2026-09-14");
    assert.ok(!weekdays.includes("2026-09-19"));

    assert.deepEqual(datesOnWeekdays("2026-09-14", "2026-09-20", [0]), ["2026-09-20"]);
    assert.deepEqual(datesOnWeekdays("2026-09-20", "2026-09-14", [1]), []);
  });

  test("reports the weekday of a date", () => {
    assert.equal(weekdayOf("2026-09-14"), 1);
    assert.equal(weekdayOf("2026-09-20"), 0);
  });

  test("formats dates without shifting them", () => {
    assert.equal(formatIsoDate("2026-09-14"), "14 Sep 2026");
    assert.equal(formatIsoDate("2026-09-14", "EEE d MMM"), "Mon 14 Sep");
  });
});

describe("todayInTimeZone", () => {
  test("uses the hospital's calendar day, not the server's", () => {
    const instant = new Date("2026-09-15T23:30:00Z");
    assert.equal(todayInTimeZone("Africa/Accra", instant), "2026-09-15");
    assert.equal(todayInTimeZone("Pacific/Auckland", instant), "2026-09-16");
    assert.equal(todayInTimeZone("America/New_York", instant), "2026-09-15");
  });
});
