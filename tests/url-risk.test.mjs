import { test } from "node:test";
import assert from "node:assert/strict";
import { urlRisk } from "../extension/lib/url-risk.mjs";

test("ordinary https site is trusted by default", () => {
  assert.equal(urlRisk("https://portal.example.edu/fees").trust, 0.8);
});
test("same site as the current page gets a small boost", () => {
  assert.equal(urlRisk("https://portal.example.edu/x", { pageOrigin: "https://portal.example.edu" }).trust, 0.9);
});
test("user-trusted origin is fully trusted, even over http", () => {
  assert.equal(urlRisk("http://intranet.corp/x", { trustedOrigins: ["http://intranet.corp"] }).trust, 1);
});
test("loopback fixtures are fine", () => {
  assert.ok(urlRisk("http://127.0.0.1:4173/kyc/").trust >= 0.9);
  assert.ok(urlRisk("http://localhost:8000").trust >= 0.9);
});
test("risk signals lower trust and are explained", () => {
  const http = urlRisk("http://shop.example.com");
  assert.ok(http.trust < 0.8 && http.reasons.includes("unencrypted http"));
  assert.ok(urlRisk("https://203.0.113.9/login").trust <= 0.5);
  assert.ok(urlRisk("https://xn--pypal-4ve.com").reasons.some((r) => r.includes("punycode")));
  assert.ok(urlRisk("https://user:pw@bank.example").trust <= 0.4);
  assert.ok(urlRisk("https://free-prizes.zip").reasons.some((r) => r.includes("TLD")));
});
test("non-web or invalid URLs have zero trust", () => {
  for (const u of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "not a url", ""]) assert.equal(urlRisk(u).trust, 0, u);
});
test("trust is always within 0..1", () => {
  const t = urlRisk("http://user:pw@xn--a.b.c.d.e.f.zip").trust;
  assert.ok(t >= 0 && t <= 1);
});
