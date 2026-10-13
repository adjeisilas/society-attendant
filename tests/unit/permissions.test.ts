import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { capabilitiesFor, roleLabel, type AccessProfile } from "../../src/lib/auth/permissions.ts";

const staffMember: AccessProfile = { role: "staff", isActive: true, hasStaffRecord: true, headedDepartmentCount: 0 };
const departmentHead: AccessProfile = { ...staffMember, headedDepartmentCount: 1 };
const hospitalAdmin: AccessProfile = { role: "hospital_admin", isActive: true, hasStaffRecord: false, headedDepartmentCount: 0 };
const superAdmin: AccessProfile = { role: "super_admin", isActive: true, hasStaffRecord: false, headedDepartmentCount: 0 };

describe("capabilitiesFor", () => {
  test("staff members work with their own attendance only", () => {
    const capabilities = capabilitiesFor(staffMember);
    assert.ok(capabilities.has("attendance.viewOwn"));
    assert.ok(capabilities.has("corrections.request"));
    assert.ok(!capabilities.has("staff.viewDepartment"));
    assert.ok(!capabilities.has("staff.manage"));
    assert.ok(!capabilities.has("reports.view"));
  });

  test("department heads add oversight of their department", () => {
    const capabilities = capabilitiesFor(departmentHead);
    assert.ok(capabilities.has("attendance.viewOwn"));
    assert.ok(capabilities.has("staff.viewDepartment"));
    assert.ok(capabilities.has("attendance.viewDepartment"));
    assert.ok(!capabilities.has("corrections.review"));
    assert.ok(!capabilities.has("settings.manage"));
  });

  test("hospital admins manage the hospital and its terminals, but have no own attendance without a staff record", () => {
    const capabilities = capabilitiesFor(hospitalAdmin);
    assert.ok(capabilities.has("staff.manage"));
    assert.ok(capabilities.has("locations.manage"));
    assert.ok(capabilities.has("corrections.review"));
    assert.ok(capabilities.has("audit.view"));
    assert.ok(!capabilities.has("hospitals.manage"));
    assert.ok(!capabilities.has("attendance.viewOwn"));
    assert.ok(capabilitiesFor({ ...hospitalAdmin, hasStaffRecord: true }).has("attendance.viewOwn"));
  });

  test("only super admins set up and edit the hospital", () => {
    assert.ok(capabilitiesFor(superAdmin).has("hospitals.manage"));
    for (const access of [staffMember, departmentHead, hospitalAdmin]) {
      assert.ok(!capabilitiesFor(access).has("hospitals.manage"));
    }
  });

  test("inactive accounts have no capabilities", () => {
    for (const access of [staffMember, departmentHead, hospitalAdmin, superAdmin]) {
      assert.equal(capabilitiesFor({ ...access, isActive: false }).size, 0);
    }
  });
});

describe("roleLabel", () => {
  test("describes department headship for staff accounts", () => {
    assert.equal(roleLabel(staffMember), "Staff");
    assert.equal(roleLabel(departmentHead), "Department Head");
    assert.equal(roleLabel({ ...hospitalAdmin, headedDepartmentCount: 2 }), "Hospital Admin");
    assert.equal(roleLabel(superAdmin), "Super Admin");
  });
});
