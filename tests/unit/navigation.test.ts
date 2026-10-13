import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { capabilitiesFor, type AccessProfile } from "../../src/lib/auth/permissions.ts";
import { activeNavigationHref, navigationFor } from "../../src/lib/navigation.ts";

function labelsFor(access: AccessProfile): string[] {
  return navigationFor(capabilitiesFor(access)).flatMap((section) => section.items.map((item) => item.label));
}

const staffMember: AccessProfile = { role: "staff", isActive: true, hasStaffRecord: true, headedDepartmentCount: 0 };

describe("navigationFor", () => {
  test("staff see their own work only", () => {
    assert.deepEqual(labelsFor(staffMember), ["Dashboard", "My attendance"]);
  });

  test("department heads also see department oversight, not administration", () => {
    const labels = labelsFor({ ...staffMember, headedDepartmentCount: 1 });
    // Department heads can read corrections for their departments, but only hospital
    // administrators decide them.
    for (const label of ["Staff", "Roster", "Attendance records", "Corrections", "Reports"]) {
      assert.ok(labels.includes(label), `missing ${label}`);
    }
    for (const label of ["Departments", "Shift templates", "Terminals", "Settings", "Audit log"]) {
      assert.ok(!labels.includes(label), `unexpected ${label}`);
    }
  });

  test("hospital admins without a staff record have no personal attendance section", () => {
    const sections = navigationFor(
      capabilitiesFor({ role: "hospital_admin", isActive: true, hasStaffRecord: false, headedDepartmentCount: 0 }),
    );
    assert.ok(!sections.some((section) => section.label === "My work"));
    const labels = sections.flatMap((section) => section.items.map((item) => item.label));
    assert.ok(labels.includes("Settings"));
    assert.ok(labels.includes("Terminals"));
  });

  test("nobody sees leave, hospital lists or phone check-in", () => {
    const labels = labelsFor({ role: "super_admin", isActive: true, hasStaffRecord: true, headedDepartmentCount: 1 });
    for (const label of ["Hospitals", "My leave", "Leave requests", "Leave types", "Check in / out"]) {
      assert.ok(!labels.includes(label), `unexpected ${label}`);
    }
  });

  test("empty sections are removed", () => {
    for (const section of navigationFor(capabilitiesFor(staffMember))) {
      assert.ok(section.items.length > 0);
    }
  });
});

describe("activeNavigationHref", () => {
  const hrefs = ["/dashboard", "/attendance", "/attendance/records"];

  test("matches the most specific href", () => {
    assert.equal(activeNavigationHref("/attendance/records/123", hrefs), "/attendance/records");
    assert.equal(activeNavigationHref("/attendance", hrefs), "/attendance");
  });

  test("does not match partial path segments", () => {
    assert.equal(activeNavigationHref("/attendance-summary", hrefs), undefined);
  });
});
