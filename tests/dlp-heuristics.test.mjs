import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFieldHeuristics } from "../extension/lib/dlp-heuristics.mjs";

test("markup decides restricted fields and censors them", () => {
  const r = classifyFieldHeuristics({ signals: { label: "Aadhaar number" } });
  assert.equal(r.category, "aadhaar");
  assert.ok(r.restricted && r.sensitive && r.censor);
});

test("profile fields are sensitive but not censored", () => {
  const r = classifyFieldHeuristics({ signals: { label: "Email" } });
  assert.equal(r.category, "email");
  assert.ok(r.sensitive && !r.restricted && !r.censor);
});

test("password inputs are always censored", () => {
  const r = classifyFieldHeuristics({ signals: { type: "password" } });
  assert.equal(r.category, "password");
  assert.ok(r.censor);
});

test("value-based evidence identifies an unlabelled field", () => {
  const r = classifyFieldHeuristics({ signals: { name: "f7" }, value: "ABCPE1234F" });
  assert.equal(r.category, "pan");
  assert.ok(r.censor);
});

test("a confident label keeps its category, but a restricted value still forces censoring", () => {
  const r = classifyFieldHeuristics({ signals: { autocomplete: "name" }, value: "ABCPE1234F" });
  assert.equal(r.category, "full name");
  assert.equal(r.restricted, false);
  assert.equal(r.censor, true);
});

test("a secret in any field forces censoring", () => {
  const r = classifyFieldHeuristics({ signals: { label: "Notes" }, value: "AKIAIOSFODNN7EXAMPLE" });
  assert.equal(r.censor, true);
});

test("unknown field with ordinary value", () => {
  const r = classifyFieldHeuristics({ signals: { label: "Comments" }, value: "please call me" });
  assert.equal(r.category, null);
  assert.ok(!r.sensitive && !r.censor);
});

test("no input", () => {
  assert.equal(classifyFieldHeuristics().category, null);
});
