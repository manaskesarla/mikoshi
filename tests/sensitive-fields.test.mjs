import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalCategory, isRestrictedCategory, isProfileCategory, isSensitiveCategory, isSensitiveText } from "../extension/lib/sensitive-fields.mjs";

test("canonical names fold common spellings", () => {
  assert.equal(canonicalCategory("Aadhaar number"), "aadhaar");
  assert.equal(canonicalCategory("PAN number"), "pan");
  assert.equal(canonicalCategory("CVV/security code"), "cvv");
  assert.equal(canonicalCategory("Phone Number"), "phone-in");
  assert.equal(canonicalCategory("  Date of Birth "), "dob");
  assert.equal(canonicalCategory("something-else"), "something-else");
  assert.equal(canonicalCategory(null), null);
  assert.equal(canonicalCategory(""), null);
});

test("restricted vs profile sets are disjoint and classified correctly", () => {
  for (const c of ["aadhaar", "pan", "credit-card", "cvv", "password", "otp", "Aadhaar number"]) assert.ok(isRestrictedCategory(c), c);
  for (const c of ["email", "full name", "phone-in", "address", "dob"]) assert.ok(isProfileCategory(c), c);
  for (const c of ["email", "full name"]) assert.ok(!isRestrictedCategory(c), c);
  assert.ok(isSensitiveCategory("pan") && isSensitiveCategory("email"));
  assert.ok(!isSensitiveCategory("favourite colour"));
});

test("isSensitiveText", () => {
  assert.equal(isSensitiveText("write to asha@example.com"), true);
  assert.equal(isSensitiveText("AKIAIOSFODNN7EXAMPLE"), true);
  assert.equal(isSensitiveText("hello world"), false);
  assert.equal(isSensitiveText(""), false);
});
