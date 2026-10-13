import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isPublicPath, routes, safeRedirectPath } from "../../src/lib/auth/routes.ts";

describe("safeRedirectPath", () => {
  test("keeps same-origin application paths with query and hash", () => {
    assert.equal(safeRedirectPath("/staff?department=er#top"), "/staff?department=er#top");
  });

  test("falls back for missing, external and protocol-relative targets", () => {
    const unsafe = [
      undefined,
      null,
      42,
      "",
      "staff",
      "https://attacker.example",
      "//attacker.example",
      "/\\attacker.example",
      "/\t/attacker.example",
      "javascript:alert(1)",
    ];
    for (const value of unsafe) {
      assert.equal(safeRedirectPath(value), routes.home, `expected fallback for ${JSON.stringify(value)}`);
    }
  });

  test("never redirects back to public authentication pages", () => {
    assert.equal(safeRedirectPath("/login?next=/staff"), routes.home);
    assert.equal(safeRedirectPath("/auth/confirm?type=invite"), routes.home);
    assert.equal(safeRedirectPath("/terminal"), routes.home);
  });

  test("uses the provided fallback", () => {
    assert.equal(safeRedirectPath("//attacker.example", "/roster"), "/roster");
  });
});

describe("isPublicPath", () => {
  test("matches public paths and their sub-paths only", () => {
    assert.equal(isPublicPath("/login"), true);
    assert.equal(isPublicPath("/forgot-password"), true);
    assert.equal(isPublicPath("/auth/confirm"), true);
    assert.equal(isPublicPath("/terminal"), true);
    assert.equal(isPublicPath("/loginx"), false);
    assert.equal(isPublicPath("/dashboard"), false);
    assert.equal(isPublicPath("/set-password"), false);
    assert.equal(isPublicPath("/"), false);
  });
});
