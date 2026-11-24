import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault, prefixFor } from "../extension/lib/tokenizer.mjs";

const AADHAAR = "234567890124"; // synthetic

test("prefixes use canonical categories", () => {
  assert.equal(prefixFor("Aadhaar number"), "AADHAAR");
  assert.equal(prefixFor("phone-in"), "PHONE");
  assert.equal(prefixFor("PAN number"), "PAN");
  assert.equal(prefixFor("weird thing!"), "WEIRDTHING");
});

test("add mints stable, per-prefix numbered tokens", () => {
  const v = new Vault();
  assert.equal(v.add("ABCPE1234F", "pan"), "[PAN_1]");
  assert.equal(v.add("asha@example.com", "email"), "[EMAIL_1]");
  assert.equal(v.add("ABCPE1234F", "pan"), "[PAN_1]");        // same value, same token
  assert.equal(v.add("abcpe1234f", "pan"), "[PAN_1]");        // case-insensitive
  assert.equal(v.add("QWERT5678Z", "pan"), "[PAN_2]");
  assert.equal(v.add("", "pan"), null);
});

test("digit values match regardless of spacing", () => {
  const v = new Vault();
  const t = v.add("2345 6789 0124", "aadhaar");
  assert.equal(v.add(AADHAAR, "aadhaar"), t);
  assert.equal(v.tokenForValue("2345-6789-0124"), t);
  assert.equal(v.resolve(t), "2345 6789 0124");
});

test("redactText replaces values in any spacing and keeps other text", () => {
  const v = new Vault();
  v.add(AADHAAR, "aadhaar");
  v.add("ABCPE1234F", "pan");
  assert.equal(v.redactText("id 2345 6789 0124 and abcpe1234f."), "id [AADHAAR_1] and [PAN_1].");
  assert.equal(v.redactText("nothing here"), "nothing here");
});

test("redactText does not touch digits inside longer numbers or words", () => {
  const v = new Vault();
  v.add("123456", "postal code");
  assert.equal(v.redactText("order 9123456 and 123456"), "order 9123456 and [PIN_1]");
  v.add("Asha", "first name");
  assert.equal(v.redactText("Ashanti met Asha"), "Ashanti met [FIRSTNAME_1]");
});

test("phone values are redacted with or without country prefix", () => {
  const v = new Vault();
  v.add("9876543210", "phone-in");
  assert.equal(v.redactText("call +91 98765 43210 or 9876543210 or 09876543210"), "call [PHONE_1] or [PHONE_1] or [PHONE_1]");
});

test("longest value wins when values overlap", () => {
  const v = new Vault();
  v.add("Asha Rao", "full name");
  v.add("Asha", "first name");
  assert.equal(v.redactText("Asha Rao and Asha"), "[NAME_1] and [FIRSTNAME_1]");
});

test("exportContext never contains values", () => {
  const v = new Vault();
  v.add("ABCPE1234F", "pan");
  const ctx = v.exportContext();
  assert.deepEqual(ctx, { "[PAN_1]": "pan" });
  assert.ok(!JSON.stringify(ctx).includes("ABCPE1234F"));
});

test("addProfile and addDetections", () => {
  const v = new Vault();
  const toks = v.addProfile({ pan: "ABCPE1234F", email: "a@b.in", empty: "", missing: null });
  assert.deepEqual(toks, { pan: "[PAN_1]", email: "[EMAIL_1]" });
  v.addDetections([{ category: "phone-in", value: "9876543210" }, { category: "pan", value: "ABCPE1234F" }, null]);
  assert.equal(v.size, 3);
});

test("forgetSource removes only that source and does not reuse numbers", () => {
  const v = new Vault();
  v.add("ABCPE1234F", "pan", "profile");
  const screen = v.add("QWERT5678Z", "pan", "screen");
  v.forgetSource("screen");
  assert.equal(v.resolve(screen), null);
  assert.equal(v.resolve("[PAN_1]"), "ABCPE1234F");
  assert.equal(v.add("LMNOP4321Q", "pan", "screen"), "[PAN_3]");
});

test("serialize / deserialize round trip", () => {
  const v = new Vault();
  v.add("ABCPE1234F", "pan");
  v.add(AADHAAR, "aadhaar", "screen");
  const copy = Vault.deserialize(JSON.parse(JSON.stringify(v.serialize())));
  assert.equal(copy.resolve("[PAN_1]"), "ABCPE1234F");
  assert.equal(copy.tokenForValue("2345 6789 0124"), "[AADHAAR_1]");
  assert.equal(copy.add("NEWPE1111A", "pan"), "[PAN_2]");
  assert.equal(Vault.deserialize(null).size, 0);
  assert.equal(Vault.deserialize({ v: 99 }).size, 0);
});

test("maskForDisplay", () => {
  const v = new Vault();
  const a = v.add(AADHAAR, "aadhaar");
  const e = v.add("asha@example.com", "email");
  assert.equal(v.maskForDisplay(a), "••••••••0124");
  assert.equal(v.maskForDisplay(e), "a***@example.com");
  assert.equal(v.maskForDisplay("[NOPE_1]"), null);
});
