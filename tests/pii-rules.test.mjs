import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, detectPII } from "../extension/lib/pii-rules.mjs";
import { verhoeffCheckDigit } from "../extension/lib/pii-checksums.mjs";

// Synthetic, checksum-valid Aadhaar-shaped number (never a real ID).
const payload = "23456789012";
const AADHAAR = payload + verhoeffCheckDigit(payload);
const AADHAAR_GROUPED = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;

const cats = (text, opts) => detectPII(text, opts).map((h) => h.category);

test("normalize: folds digits, dashes, spaces and drops zero-width chars", () => {
  const { text } = normalize("١٢٣ ４５６​–７");
  assert.equal(text, "123 456-7");
});

test("normalize: offsets map back to the original string", () => {
  const original = "ID: ​１２３";
  const { text, map } = normalize(original);
  const i = text.indexOf("123");
  assert.equal(original.slice(map[i][0], map[i + 2][1]), "​１２３".slice(1));
});

test("aadhaar: checksum-valid grouped number is detected with original offsets", () => {
  const text = `Aadhaar: ${AADHAAR_GROUPED} thanks`;
  const hits = detectPII(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].category, "aadhaar");
  assert.equal(hits[0].value, AADHAAR_GROUPED);
  assert.equal(text.slice(hits[0].start, hits[0].end), AADHAAR_GROUPED);
});

test("aadhaar: 12 digits failing the checksum is not reported as aadhaar", () => {
  const bad = AADHAAR.slice(0, 11) + ((+AADHAAR[11] + 1) % 10);
  assert.ok(!cats(`Aadhaar ${bad}`).includes("aadhaar"));
});

test("aadhaar: written with fullwidth digits is still found", () => {
  const full = [...AADHAAR_GROUPED].map((c) => (/\d/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join("");
  assert.deepEqual(cats(`aadhaar ${full}`), ["aadhaar"]);
});

test("aadhaar: negative context lowers confidence below the default threshold when ungrouped", () => {
  assert.ok(!cats(`order tracking ${AADHAAR}`).includes("aadhaar"));
});

test("pan: valid structure is detected, invalid holder type needs context", () => {
  assert.deepEqual(cats("PAN ABCPE1234F"), ["pan"]);
  assert.deepEqual(cats("code ABCDE1234F here"), []);
  assert.deepEqual(cats("PAN number ABCDE1234F"), ["pan"]);
});

test("email and upi", () => {
  assert.deepEqual(cats("mail me at asha.rao+x@example.co.in"), ["email"]);
  assert.deepEqual(cats("pay asha@okaxis now"), ["upi-vpa"]);
  assert.deepEqual(cats("see foo@bar for details"), []);
});

test("phone: indian mobile with and without prefix", () => {
  assert.deepEqual(cats("call +91 98765 43210"), ["phone-in"]);
  assert.deepEqual(cats("mobile 9876543210"), ["phone-in"]);
  assert.deepEqual(cats("mobile 5876543210"), []);
});

test("credit card: luhn + issuer prefix", () => {
  assert.deepEqual(cats("card 4111 1111 1111 1111"), ["credit-card"]);
  assert.deepEqual(cats("card 4111 1111 1111 1112"), []);
});

test("bank account needs context", () => {
  assert.deepEqual(cats("A/c no 123456789012"), ["bank account information"]);
  assert.deepEqual(cats("value 123456789"), []);
});

test("ifsc, gstin, vehicle, ipv4, iban, ssn", () => {
  assert.deepEqual(cats("IFSC SBIN0001234"), ["ifsc"]);
  assert.deepEqual(cats("GSTIN 27AAPFU0939F1ZV"), ["gstin"]);
  assert.deepEqual(cats("vehicle KA 01 AB 1234"), ["vehicle-reg"]);
  assert.deepEqual(cats("host 192.168.1.10"), ["ipv4"]);
  assert.deepEqual(cats("host 999.168.1.10"), []);
  assert.deepEqual(cats("IBAN GB82 WEST 1234 5698 7654 32"), ["iban"]);
  assert.deepEqual(cats("SSN 123-45-6789"), ["ssn"]);
});

test("dob and passport and voter id need context", () => {
  assert.deepEqual(cats("DOB 15/08/1999"), ["dob"]);
  assert.deepEqual(cats("released on 15/08/1999"), []);
  assert.deepEqual(cats("passport no K1234567"), ["passport-in"]);
  assert.deepEqual(cats("ref K1234567"), []);
  assert.deepEqual(cats("voter id ABC1234567"), ["voter-id"]);
});

test("a long number inside an email does not produce a phone hit", () => {
  assert.deepEqual(cats("write to 9876543210@example.com"), ["email"]);
});

test("a date next to a phone number does not hide the phone", () => {
  assert.deepEqual(cats("on 2026-05-12 9876543210 called"), ["phone-in"]);
});

test("minConfidence and categories options", () => {
  const text = "mobile 9876543210 and mail a@b.in";
  assert.deepEqual(cats(text, { categories: ["email"] }), ["email"]);
  assert.deepEqual(cats("9876543210", { minConfidence: 0.9 }), []);
});

test("empty and non-string input", () => {
  assert.deepEqual(detectPII(""), []);
  assert.deepEqual(detectPII(null), []);
});
