// Real-browser check of the page code (perceiver + executor) against the fixtures.
// Launches headless Chrome, drives it over the DevTools protocol, prints PASS/FAIL.
//   node scripts/browser-check.mjs [chrome-path]
// Not part of `npm test` because it needs Chrome installed.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticServer } from "./serve.mjs";

const CHROME = process.argv[2] || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT_DEBUG = 9331;
const server = createStaticServer(new URL("..", import.meta.url).pathname);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), "mikoshi-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT_DEBUG}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1200,900", "about:blank"], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch {} server.close(); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);

async function until(fn, ms = 15000) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 150)); } }
const target = await until(async () => (await (await fetch(`http://127.0.0.1:${PORT_DEBUG}/json`)).json()).find((t) => t.type === "page"));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const go = async (path) => { await send("Page.enable"); await send("Page.navigate", { url: base + path }); await new Promise((r) => setTimeout(r, 800)); };
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const MODS = `const P=await import('/extension/content/perceiver.mjs'); const E=await import('/extension/content/executor.mjs');`;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); if (!ok) failed++; };

try {
  await go("/fixtures/kyc/");
  const sk = await ev(`${MODS} return P.perceive().skeleton;`);
  const by = (cat) => sk.nodes.find((n) => n.piiCategory === cat);
  for (const [cat, label] of [["aadhaar", "Aadhaar"], ["pan", "PAN"], ["phone-in", "Mobile"], ["email", "Email"], ["dob", "birth"], ["full name", "name"]]) check(`kyc: ${cat} field found`, !!by(cat), JSON.stringify(sk.nodes.map((n) => n.piiCategory)));
  check("kyc: Aadhaar and PAN fields are censored", by("aadhaar")?.isCensored === true && by("pan")?.isCensored === true);
  check("kyc: label text is attached", /Aadhaar/i.test(by("aadhaar")?.label || ""), by("aadhaar")?.label);
  check("kyc: submit button is marked", sk.nodes.some((n) => n.isSubmit));
  check("kyc: all fields start empty", sk.nodes.filter((n) => n.piiCategory).every((n) => n.state === "empty"));

  const typed = await ev(`${MODS} const s=P.perceive().skeleton; const n=s.nodes.find(x=>x.piiCategory==='aadhaar'); const r=await E.execute({action:'type',targetId:n.id},'234567890124'); const s2=P.perceive().skeleton; const n2=s2.nodes.find(x=>x.piiCategory==='aadhaar'); return {r, state:n2.state, domValue:document.getElementById('aadhaar').value, wire:JSON.stringify(s2)};`);
  check("executor: typed value lands in the field", typed.r.ok && typed.domValue === "234567890124", JSON.stringify(typed.r));
  check("skeleton: filled field reports state 'filled'", typed.state === "filled");
  check("skeleton: the typed value never appears in the skeleton", !typed.wire.includes("234567890124"));

  const blocked = await ev(`${MODS} const s=P.perceive().skeleton; const b=s.nodes.find(x=>x.isSubmit); await E.execute({action:'click',targetId:b.id}); await new Promise(r=>setTimeout(r,200)); return window.__kycSubmitted===true`);
  check("browser: empty required fields still block submit (native validation respected)", blocked === false);
  const submitted = await ev(`${MODS} const vals={'full name':'Asha Rao',dob:'15/08/1999',pan:'ABCPE1234F','phone-in':'9876543210',email:'asha@example.com'}; for (const [cat,v] of Object.entries(vals)) { const n=P.perceive().skeleton.nodes.find(x=>x.piiCategory===cat); const r=await E.execute({action:'type',targetId:n.id},v); if(!r.ok) return 'type failed: '+cat+' '+r.error; } const b=P.perceive().skeleton.nodes.find(x=>x.isSubmit); await E.execute({action:'submit',targetId:b.id}); await new Promise(r=>setTimeout(r,200)); return window.__kycSubmitted===true`);
  check("executor: with every required field filled, submit runs the form handler", submitted === true, String(submitted));

  await go("/fixtures/portal/");
  const portal = await ev(`${MODS} const p=P.perceive(); return {hidden:p.hidden.map(h=>h.text.slice(0,30)), links:p.skeleton.nodes.filter(n=>n.tag==='a').map(n=>n.text), search:p.skeleton.nodes.some(n=>n.role==='textbox'||n.type==='search')};`);
  check("portal: off-screen injection text is detected as hidden", portal.hidden.some((t) => /Ignore all previous/i.test(t)), JSON.stringify(portal.hidden));
  check("portal: nav links and Pay now trap are visible nodes", ["Fees", "Admissions", "Pay now"].every((l) => portal.links.includes(l)), JSON.stringify(portal.links));
  check("portal: search box found", portal.search);

  await go("/fixtures/portal/fees.html");
  const read = await ev(`${MODS} const s=P.perceive().skeleton; const ids=s.nodes.filter(n=>/Tuition/.test(n.text||'')).map(n=>n.id); return {ids, text:E.readNodes(ids).join(' ')};`);
  check("extract: reads the tuition row text", /Tuition fee/.test(read.text) && ids(read), read.text);
  function ids(r) { return r.ids.length > 0; }

  await go("/fixtures/hostile/cross-origin-form.html");
  const hf = await ev(`${MODS} const s=P.perceive().skeleton; return s.nodes.filter(n=>n.formOrigin).map(n=>({o:n.formOrigin,x:n.formCrossOrigin}));`);
  check("hostile: cross-origin form action is flagged on its fields", hf.length > 0 && hf.every((f) => f.x === true && f.o === "https://collect.example"), JSON.stringify(hf));

  await go("/fixtures/hostile/injection-hidden.html");
  const hh = await ev(`${MODS} return P.perceive().hidden.map(h=>h.text.slice(0,25));`);
  check("hostile: zero-size white-on-white text is detected", hh.some((t) => /Ignore all/.test(t)), JSON.stringify(hh));
} catch (e) { console.log("ERROR", e.message); failed++; }
cleanup();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
