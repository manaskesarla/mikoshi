import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStaticServer } from "../scripts/serve.mjs";
import { scanAdversarialVectors } from "../extension/lib/adversarial-guard.mjs";
import { classifyAction } from "../extension/lib/action-firewall.mjs";
import { detectPII } from "../extension/lib/pii-rules.mjs";

const read = (p) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), "utf8");
const stripTags = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

let server, base;
before(async () => { server = createStaticServer(new URL("../fixtures", import.meta.url).pathname); await new Promise((r) => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test("static server: serves files and directory indexes, with sensible types", async () => {
  const root = await fetch(`${base}/`); assert.equal(root.status, 200); assert.match(root.headers.get("content-type"), /text\/html/);
  assert.match(await (await fetch(`${base}/kyc/`)).text(), /e-KYC/);
  assert.match((await fetch(`${base}/portal/style.css`)).headers.get("content-type"), /text\/css/);
  assert.equal((await fetch(`${base}/nope.html`)).status, 404);
});

test("static server: refuses path traversal", async () => {
  for (const path of ["/../package.json", "/%2e%2e/package.json", "/..%2f..%2fpackage.json", "/kyc/%00.html"]) {
    const r = await fetch(`${base}${path}`);
    assert.ok([400, 403, 404].includes(r.status), `${path} -> ${r.status}`);
    assert.ok(!(await r.text()).includes('"name": "mikoshi"'));
  }
});

test("kyc form has every field the demo needs, with ground-truth categories", () => {
  const html = read("kyc/index.html");
  const gt = [...html.matchAll(/data-gt="([^"]+)"/g)].map((m) => m[1]);
  for (const c of ["full name", "dob", "aadhaar", "pan", "phone-in", "email", "address", "postal code"]) assert.ok(gt.includes(c), c);
  assert.match(html, /id="submit"/);
});

test("fixtures contain no personal values: the KYC page and portal text trigger no PII detections", () => {
  for (const f of ["kyc/index.html", "portal/index.html", "portal/fees.html", "portal/admissions.html"]) {
    const found = detectPII(stripTags(read(f)), { minConfidence: 0.7 }).filter((h) => h.category !== "email");
    assert.deepEqual(found.map((h) => h.category), [], f);
  }
});

test("portal: fee data is present, plus the trap link and the hidden injection", () => {
  assert.match(stripTags(read("portal/fees.html")), /Tuition fee 12,000 30 Nov 2026/);
  assert.match(read("portal/index.html"), /<a href="pay\.html">Pay now<\/a>/);
  const home = read("portal/index.html");
  const hidden = /left:-9999px[^>]*>([^<]+)</.exec(home)[1];
  const scan = scanAdversarialVectors({ hidden: [{ text: hidden, style: { left: "-9999px" } }] });
  assert.equal(scan.verdict, "MALICIOUS");
});

test("hostile pages are caught by the guard and firewall", () => {
  const visible = stripTags(read("hostile/injection-visible.html"));
  assert.equal(scanAdversarialVectors({ text: visible }).verdict, "MALICIOUS");

  const hiddenDiv = /<div style="([^"]+)">([^<]+)<\/div>/.exec(read("hostile/injection-hidden.html"));
  assert.equal(scanAdversarialVectors({ hidden: [{ text: hiddenDiv[2], style: { fontSize: "0px" } }] }).verdict, "MALICIOUS");

  const fw = (action, node) => classifyAction(action, { pageOrigin: "http://127.0.0.1:4173", targetNode: node }).decision;
  assert.equal(fw({ action: "click" }, { href: "http://127.0.0.1:4173/hostile/viewer-setup.exe", text: "Download viewer-setup.exe" }), "BLOCK");
  const link = /href="([^"]+)"/.exec(read("hostile/exfil-link.html"))[1];
  assert.equal(fw({ action: "click" }, { href: link, text: "Continue" }), "BLOCK");
  const formAction = /<form action="([^"]+)"/.exec(read("hostile/cross-origin-form.html"))[1];
  assert.equal(fw({ action: "type" }, { label: "Aadhaar number", formCrossOrigin: true, formOrigin: new URL(formAction).origin }), "BLOCK");
  assert.equal(fw({ action: "click" }, { text: "Pay now", href: "http://127.0.0.1:4173/portal/pay.html" }), "REQUIRE_APPROVAL");
});
