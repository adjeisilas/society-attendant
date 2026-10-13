import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { generateTemporaryPassword } from "../../src/features/staff/password.ts";
import { PASSWORD_MIN_LENGTH } from "../../src/features/auth/schemas.ts";
import { staffAccountSchema } from "../../src/features/staff/schemas.ts";

describe("generateTemporaryPassword", () => {
  test("is long enough to pass the password rules and avoids ambiguous characters", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const password = generateTemporaryPassword();
      assert.ok(password.length >= PASSWORD_MIN_LENGTH, password);
      // No 0/O/1/l/I, so the password can be read aloud or copied from a screen.
      assert.match(password, /^[A-HJ-NP-Za-kmnp-z2-9]{4}(-[A-HJ-NP-Za-kmnp-z2-9]{4}){3}$/);
    }
  });

  test("does not repeat", () => {
    const passwords = new Set(Array.from({ length: 50 }, generateTemporaryPassword));
    assert.equal(passwords.size, 50);
  });
});

describe("staffAccountSchema", () => {
  test("a generated password ignores the password field", () => {
    assert.deepEqual(staffAccountSchema.parse({ role: "staff", mode: "generate", password: "" }), {
      role: "staff",
      password: null,
    });
  });

  test("a typed password must meet the minimum length", () => {
    assert.equal(staffAccountSchema.safeParse({ role: "staff", mode: "manual", password: "short" }).success, false);
    assert.deepEqual(staffAccountSchema.parse({ role: "hospital_admin", mode: "manual", password: "correct horse staple" }), {
      role: "hospital_admin",
      password: "correct horse staple",
    });
  });

  test("rejects a role an administrator cannot grant", () => {
    assert.equal(staffAccountSchema.safeParse({ role: "super_admin", mode: "generate", password: "" }).success, false);
  });
});
