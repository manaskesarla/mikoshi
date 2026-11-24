import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault } from "../extension/lib/tokenizer.mjs";
import { sanitizeText, sanitizeTaskGoal, sanitizeSkeleton, SECRET_MARKER } from "../extension/lib/dlp-sanitizer.mjs";
import { verhoeffCheckDigit } from "../extension/lib/pii-checksums.mjs";

const p = "23456789012";
const AADHAAR = p + verhoeffCheckDigit(p);

test("known profile values and newly detected values both become tokens", () => {
  const v = new Vault();
  v.add("Asha Rao", "full name");
  const r = sanitizeText("Asha Rao, PAN ABCPE1234F, mail asha@example.com", v);
  assert.equal(r.text, "[NAME_1], PAN [PAN_1], mail [EMAIL_1]");
  assert.deepEqual(r.hits.map((h) => h.category).sort(), ["email", "pan"]);
  assert.equal(v.resolve("[PAN_1]"), "ABCPE1234F");
});

test("same value gets the same token across calls", () => {
  const v = new Vault();
  const a = sanitizeText("PAN ABCPE1234F", v).text;
  const b = sanitizeText("again ABCPE1234F", v).text;
  assert.equal(a, "PAN [PAN_1]");
  assert.equal(b, "again [PAN_1]");
});

test("secrets are masked with a marker and never enter the vault", () => {
  const v = new Vault();
  const r = sanitizeText("key AKIAIOSFODNN7EXAMPLE ok", v);
  assert.equal(r.text, `key ${SECRET_MARKER} ok`);
  assert.equal(r.secrets, 1);
  assert.equal(v.size, 0);
});

test("task goal: PII in the user's request is tokenized", () => {
  const v = new Vault();
  const r = sanitizeTaskGoal(`Fill the form using Aadhaar ${AADHAAR} and phone 9876543210`, v);
  assert.ok(!r.text.includes(AADHAAR) && !r.text.includes("9876543210"));
  assert.match(r.text, /\[AADHAAR_1\]/);
  assert.match(r.text, /\[PHONE_1\]/);
});

test("text with nothing sensitive is unchanged", () => {
  const v = new Vault();
  assert.deepEqual(sanitizeText("Open the Fees page", v), { text: "Open the Fees page", hits: [], secrets: 0 });
  assert.equal(sanitizeText("", v).text, "");
});

test("skeleton: values dropped, strings tokenized, input not mutated, counts reported", () => {
  const v = new Vault();
  v.add("Asha Rao", "full name");
  const input = {
    url: "https://portal.example/apply?email=asha@example.com",
    title: "Apply - Asha Rao",
    nodes: [
      { id: "n1", tag: "input", label: "PAN", value: "ABCPE1234F", state: "filled" },
      { id: "n2", tag: "p", text: "Contact 9876543210", bbox: { x: 0, y: 0, w: 1, h: 1 } },
      { id: "n3", tag: "select", options: [{ text: "Asha Rao", value: "1" }] },
    ],
  };
  const snapshot = JSON.stringify(input);
  const { skeleton, counts } = sanitizeSkeleton(input, v);
  assert.equal(JSON.stringify(input), snapshot);
  assert.ok(!("value" in skeleton.nodes[0]));
  assert.equal(skeleton.title, "Apply - [NAME_1]");
  assert.match(skeleton.url, /email=\[EMAIL_1\]/);
  assert.match(skeleton.nodes[1].text, /\[PHONE_1\]/);
  assert.equal(skeleton.nodes[2].options[0].text, "[NAME_1]");
  assert.equal(counts.email, 1);
  assert.equal(counts["phone-in"], 1);
  const wire = JSON.stringify(skeleton);
  for (const raw of ["ABCPE1234F", "9876543210", "asha@example.com", "Asha Rao"]) assert.ok(!wire.includes(raw), raw);
});
