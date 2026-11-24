import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPayload } from "../extension/lib/security-policy.mjs";
import { Vault } from "../extension/lib/tokenizer.mjs";
import { generateCanaries } from "../extension/lib/canary.mjs";
import { verhoeffCheckDigit } from "../extension/lib/pii-checksums.mjs";

const p = "23456789012";
const AADHAAR = p + verhoeffCheckDigit(p);

test("clean tokenized payload is allowed and untouched", () => {
  const payload = { taskGoal: "Fill the form with [PAN_1]", skeleton: { nodes: [{ id: "n1", tag: "input", label: "PAN", fillToken: "[PAN_1]" }] }, history: [] };
  const r = classifyPayload(payload);
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.classification, "PUBLIC");
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.sanitized, payload);
});

test("canary -> BLOCK", () => {
  const [c] = generateCanaries(1);
  const r = classifyPayload({ taskGoal: `see ${c}` }, { canaries: [c] });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.classification, "SECRET");
});

test("vendor secret -> BLOCK; generic secret -> REQUIRE_APPROVAL", () => {
  assert.equal(classifyPayload({ note: "key AKIAIOSFODNN7EXAMPLE" }).decision, "BLOCK");
  assert.equal(classifyPayload({ note: 'api_key = "q8Zr2xLm9TvB4nWc7YdE1sHk"' }).decision, "REQUIRE_APPROVAL");
});

test("restricted PII in the payload -> BLOCK", () => {
  const r = classifyPayload({ taskGoal: `Aadhaar ${AADHAAR}` });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.classification, "SENSITIVE");
});

test("non-restricted PII -> SANITIZE with a cleaned copy", () => {
  const payload = { taskGoal: "mail asha@example.com", n: { text: "ok" } };
  const r = classifyPayload(payload);
  assert.equal(r.decision, "SANITIZE");
  assert.equal(r.classification, "PERSONAL");
  assert.ok(!JSON.stringify(r.sanitized).includes("asha@example.com"));
  assert.match(r.sanitized.taskGoal, /\[EMAIL_1\]/);
  assert.equal(payload.taskGoal, "mail asha@example.com"); // input untouched
});

test("a known profile value left in the payload is caught even if no pattern matches", () => {
  const v = new Vault();
  v.add("Asha Rao", "full name");
  const r = classifyPayload({ title: "Welcome Asha Rao" }, { vault: v });
  assert.equal(r.decision, "SANITIZE");
  assert.equal(r.findings[0].type, "profile-value");
  assert.equal(r.sanitized.title, "Welcome [NAME_1]");
});

test("a restricted value from the vault left in the payload -> BLOCK", () => {
  const v = new Vault();
  v.add("Rosebud77", "password");
  assert.equal(classifyPayload({ text: "pw is Rosebud77" }, { vault: v }).decision, "BLOCK");
});

test("tokens already in the payload are not findings", () => {
  const v = new Vault();
  const t = v.add("Asha Rao", "full name");
  assert.equal(classifyPayload({ text: `hello ${t}` }, { vault: v }).decision, "ALLOW");
});

test("low-trust destination turns SANITIZE-level data into REQUIRE_APPROVAL", () => {
  const payload = { text: "mail asha@example.com" };
  assert.equal(classifyPayload(payload, { destinationTrust: 0.2 }).decision, "REQUIRE_APPROVAL");
  assert.equal(classifyPayload(payload, { destinationTrust: 0.9 }).decision, "SANITIZE");
});

test("most severe decision wins", () => {
  const r = classifyPayload({ a: "mail asha@example.com", b: "AKIAIOSFODNN7EXAMPLE" });
  assert.equal(r.decision, "BLOCK");
});

test("screenshots and structural keys are not scanned", () => {
  const r = classifyPayload({ screenshot: `data:image/png;base64,${AADHAAR}`, nodes: [{ id: AADHAAR, tag: "div" }] });
  assert.equal(r.decision, "ALLOW");
});

test("findings and reasons never contain raw values", () => {
  const r = classifyPayload({ a: `Aadhaar ${AADHAAR}`, b: "mail asha@example.com", c: "AKIAIOSFODNN7EXAMPLE" });
  const wire = JSON.stringify({ f: r.findings, r: r.reasons });
  for (const raw of [AADHAAR, "asha@example.com", "AKIAIOSFODNN7EXAMPLE"]) assert.ok(!wire.includes(raw), raw);
});
