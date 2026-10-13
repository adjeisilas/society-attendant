import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hospitalSchema } from "../../src/features/hospitals/schemas.ts";

const validHospital = {
  name: "  Korle Bu Teaching Hospital ",
  code: " kbth ",
  timezone: "Africa/Accra",
  address: "",
  phone: " ",
  email: " Info@KBTH.example ",
};

describe("hospitalSchema", () => {
  test("normalises the input and turns empty optional fields into null", () => {
    assert.deepEqual(hospitalSchema.parse(validHospital), {
      name: "Korle Bu Teaching Hospital",
      code: "KBTH",
      timezone: "Africa/Accra",
      address: null,
      phone: null,
      email: "info@kbth.example",
    });
  });

  test("rejects codes the database would refuse", () => {
    for (const code of ["K", "KBTH HQ", "A".repeat(21)]) {
      assert.equal(hospitalSchema.safeParse({ ...validHospital, code }).success, false, code);
    }
  });

  test("requires a time zone and a valid email", () => {
    assert.equal(hospitalSchema.safeParse({ ...validHospital, timezone: "" }).success, false);
    assert.equal(hospitalSchema.safeParse({ ...validHospital, email: "not-an-email" }).success, false);
  });

  test("enforces the database length limits", () => {
    assert.equal(hospitalSchema.safeParse({ ...validHospital, name: "X" }).success, false);
    assert.equal(hospitalSchema.safeParse({ ...validHospital, phone: "1".repeat(31) }).success, false);
    assert.equal(hospitalSchema.safeParse({ ...validHospital, address: "a".repeat(501) }).success, false);
  });
});
