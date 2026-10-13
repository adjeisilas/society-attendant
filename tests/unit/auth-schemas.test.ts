import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emailLinkSchema, setPasswordSchema, signInSchema } from "../../src/features/auth/schemas.ts";

describe("signInSchema", () => {
  test("normalises the email address", () => {
    const result = signInSchema.parse({ email: "  E.Owusu@KGH.example.org ", password: "secret" });
    assert.equal(result.email, "e.owusu@kgh.example.org");
  });

  test("rejects invalid email addresses and empty passwords", () => {
    const result = signInSchema.safeParse({ email: "not-an-email", password: "" });
    assert.equal(result.success, false);
    const paths = result.error?.issues.map((issue) => issue.path.join("."));
    assert.deepEqual(paths?.sort(), ["email", "password"]);
  });
});

describe("setPasswordSchema", () => {
  test("requires at least 12 characters", () => {
    const result = setPasswordSchema.safeParse({ password: "short-pass", confirmPassword: "short-pass" });
    assert.equal(result.success, false);
  });

  test("requires both passwords to match", () => {
    const result = setPasswordSchema.safeParse({
      password: "correct horse battery",
      confirmPassword: "correct horse staple",
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.error?.issues.map((issue) => issue.path.join(".")), ["confirmPassword"]);
  });

  test("accepts a long passphrase", () => {
    const passphrase = "ward seven night rota";
    assert.equal(setPasswordSchema.safeParse({ password: passphrase, confirmPassword: passphrase }).success, true);
  });
});

describe("emailLinkSchema", () => {
  test("accepts only invitation and password recovery links", () => {
    assert.equal(emailLinkSchema.safeParse({ tokenHash: "abc", type: "invite" }).success, true);
    assert.equal(emailLinkSchema.safeParse({ tokenHash: "abc", type: "recovery" }).success, true);
    assert.equal(emailLinkSchema.safeParse({ tokenHash: "abc", type: "signup" }).success, false);
    assert.equal(emailLinkSchema.safeParse({ tokenHash: "", type: "invite" }).success, false);
  });
});
