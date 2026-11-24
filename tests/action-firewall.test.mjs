import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAction } from "../extension/lib/action-firewall.mjs";
import { verhoeffCheckDigit } from "../extension/lib/pii-checksums.mjs";

const p = "23456789012";
const AADHAAR = p + verhoeffCheckDigit(p);
const origin = "https://portal.example";
const field = (o = {}) => ({ tag: "input", label: "Name", ...o });
const d = (a, ctx) => classifyAction(a, { pageOrigin: origin, ...ctx });

test("non-mutating actions are allowed", () => {
  for (const action of ["wait", "scroll", "done", "ask_user", "extract"]) assert.equal(d({ action }).decision, "ALLOW", action);
});

test("typing an ordinary value into an ordinary field is allowed", () => {
  assert.equal(d({ action: "type", targetId: "n1" }, { targetNode: field(), resolvedValue: "Asha" }).decision, "ALLOW");
});

test("typing restricted PII into a same-origin field is MEDIUM and allowed", () => {
  const r = d({ action: "type" }, { targetNode: field({ label: "Aadhaar" }), resolvedValue: AADHAAR });
  assert.equal(r.risk, "MEDIUM");
  assert.equal(r.decision, "ALLOW");
  assert.ok(!JSON.stringify(r).includes(AADHAAR));
});

test("typing credentials needs approval", () => {
  const r = d({ action: "type" }, { targetNode: field(), resolvedValue: "AKIAIOSFODNN7EXAMPLE" });
  assert.equal(r.decision, "REQUIRE_APPROVAL");
});

test("sensitive value into a cross-origin form is blocked and flagged as exfiltration", () => {
  const r = d({ action: "type" }, { targetNode: field({ formCrossOrigin: true, formOrigin: "https://evil.example" }), resolvedValue: AADHAAR });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.exfil.channel, "cross_origin_form");
});

test("submit: approval; credential or payment: approval; cross-origin: block", () => {
  assert.equal(d({ action: "submit" }, { targetNode: field({ isSubmit: true }) }).decision, "REQUIRE_APPROVAL");
  assert.equal(d({ action: "submit" }, { targetNode: field({ text: "Pay now" }) }).risk, "HIGH");
  assert.equal(d({ action: "submit" }, { targetNode: field({ formCrossOrigin: true, formOrigin: "https://x.example" }) }).decision, "BLOCK");
});

test("click: same-site link allowed, off-site link MEDIUM, payment/destructive/security HIGH", () => {
  assert.equal(d({ action: "click" }, { targetNode: { href: `${origin}/fees`, text: "Fees" } }).decision, "ALLOW");
  assert.equal(d({ action: "click" }, { targetNode: { href: "https://other.example/x", text: "Partner" } }).risk, "MEDIUM");
  assert.equal(d({ action: "click" }, { targetNode: { text: "Pay now" } }).decision, "REQUIRE_APPROVAL");
  assert.equal(d({ action: "click" }, { targetNode: { text: "Delete account" } }).decision, "REQUIRE_APPROVAL");
  assert.equal(d({ action: "click" }, { targetNode: { text: "Change password" } }).decision, "REQUIRE_APPROVAL");
});

test("click: executable download is blocked; link carrying PII is blocked", () => {
  assert.equal(d({ action: "click" }, { targetNode: { href: `${origin}/setup.exe`, text: "Download" } }).decision, "BLOCK");
  const r = d({ action: "click" }, { targetNode: { href: `https://other.example/?aadhaar=${AADHAAR}`, text: "Next" } });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.exfil.channel, "url");
});

test("navigate: same-origin ok; off-site needs approval; low trust or PII blocked", () => {
  assert.equal(d({ action: "navigate", url: `${origin}/results` }).decision, "ALLOW");
  assert.equal(d({ action: "navigate", url: "https://other.example/" }).decision, "REQUIRE_APPROVAL");
  assert.equal(d({ action: "navigate", url: "https://xn--pypal-4ve.zip/" }).decision, "REQUIRE_APPROVAL");
  assert.equal(d({ action: "navigate", url: "http://203.0.113.9/login" }).decision, "BLOCK");
  assert.equal(d({ action: "open_tab", url: `https://other.example/?pan=ABCPE1234F` }).decision, "BLOCK");
  assert.equal(d({ action: "navigate", url: "javascript:alert(1)" }).decision, "BLOCK");
});

test("search: plain query allowed; PII in query blocked", () => {
  assert.equal(d({ action: "search", query: "fee due date" }).decision, "ALLOW");
  const r = d({ action: "search", query: `status for ${AADHAAR}` });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.exfil.channel, "search_query");
});

test("download, upload, clipboard need approval; script execution and unknown actions are blocked", () => {
  assert.equal(d({ action: "upload" }).decision, "REQUIRE_APPROVAL");
  assert.equal(d({ action: "paste" }).decision, "REQUIRE_APPROVAL");
  assert.equal(d({ action: "download", url: `${origin}/f.pdf` }).decision, "REQUIRE_APPROVAL");
  assert.equal(d({ action: "download", url: `${origin}/f.exe` }).decision, "BLOCK");
  assert.equal(d({ action: "execute_script" }).decision, "BLOCK");
  assert.equal(d({ action: "teleport" }).decision, "BLOCK");
  assert.equal(d(undefined).decision, "BLOCK");
});

test("a malicious page raises any acting step to at least approval", () => {
  assert.equal(d({ action: "click" }, { targetNode: { href: `${origin}/x`, text: "Next" }, pageMalicious: true }).decision, "REQUIRE_APPROVAL");
  assert.equal(d({ action: "scroll" }, { pageMalicious: true }).decision, "ALLOW");
});

test("read-only mode blocks anything that changes the page or sends data", () => {
  for (const a of [{ action: "type" }, { action: "submit" }, { action: "select" }, { action: "upload" }]) assert.equal(d(a, { mode: "read_only" }).decision, "BLOCK", a.action);
  assert.equal(d({ action: "click" }, { mode: "read_only", targetNode: { isSubmit: true } }).decision, "BLOCK");
  assert.equal(d({ action: "click" }, { mode: "read_only", targetNode: { href: `${origin}/fees`, text: "Fees" } }).decision, "ALLOW");
  assert.equal(d({ action: "extract" }, { mode: "read_only" }).decision, "ALLOW");
});

test("reasons never contain raw values", () => {
  const r = d({ action: "type" }, { targetNode: field({ formCrossOrigin: true, formOrigin: "https://e.example" }), resolvedValue: `ABCPE1234F ${AADHAAR}` });
  const wire = JSON.stringify(r);
  assert.ok(!wire.includes("ABCPE1234F") && !wire.includes(AADHAAR));
});
