// End-to-end check in real Chrome: the built extension + the real Python server (mock model)
// + the fixture pages. A recording proxy sits between extension and server so we can check
// exactly what left the browser.
//   node scripts/e2e.mjs        (needs Chrome and server/.venv)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createStaticServer } from "./serve.mjs";
import { verhoeffCheckDigit } from "../extension/lib/pii-checksums.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG = 9332, API = 8765, PROXY = 8766;
const p11 = "23456789012", AADHAAR = p11 + verhoeffCheckDigit(p11);
const PROFILE = { aadhaar: AADHAAR, pan: "ABCPE1234F", "phone-in": "9876543210", email: "asha.rao@example.com", "full name": "Asha Rao", dob: "15/08/1999" };
const RAW = [AADHAAR, `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`, "ABCPE1234F", "9876543210", "asha.rao@example.com", "Asha Rao", "15/08/1999"];

let failed = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  -> " + d}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000, label = "condition") { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t > ms) throw new Error(`timeout waiting for ${label}`); await sleep(150); } }

const procs = [];
const profileDir = mkdtempSync(join(tmpdir(), "mikoshi-e2e-"));
const fx = createStaticServer(ROOT + "fixtures"); await new Promise((r) => fx.listen(0, "127.0.0.1", r));
const FX = `http://127.0.0.1:${fx.address().port}`;
const bodies = [];
const proxy = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  if (req.method === "POST") bodies.push(body.toString());
  const r = await fetch(`http://127.0.0.1:${API}${req.url}`, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "POST" ? body : undefined });
  res.writeHead(r.status, { "content-type": "application/json" }); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => proxy.listen(PROXY, "127.0.0.1", r));
const cleanup = () => { for (const p of procs) try { p.kill(); } catch {} try { fx.close(); proxy.close(); } catch {} try { rmSync(profileDir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);

procs.push(spawn(`${ROOT}server/.venv/bin/python`, ["-m", "uvicorn", "main:app", "--app-dir", "server", "--port", String(API)], { cwd: ROOT, env: { ...process.env, VLM_MODE: "mock" }, stdio: "ignore" }));
await until(async () => (await fetch(`http://127.0.0.1:${API}/health`)).ok, 15000, "server");
// Branded Chrome ignores --load-extension (since v137), so drive it over a debugging pipe and
// use the DevTools command Extensions.loadUnpacked instead.
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", "--window-size=1200,900", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
procs.push(chrome);
const toChrome = chrome.stdio[3], fromChrome = chrome.stdio[4];
let mid = 0; const waiting = new Map(); let buf = "";
fromChrome.on("data", (d) => { buf += d.toString(); let i; while ((i = buf.indexOf("\0")) >= 0) { const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } } });
const cdp = (method, params = {}, sessionId) => new Promise((res) => { const id = ++mid; waiting.set(id, res); toChrome.write(JSON.stringify({ id, method, params, sessionId }) + "\0"); });
const attach = async (targetId) => (await cdp("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
const ev = async (sid, expr) => { const r = await cdp("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }, sid); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result?.result?.value; };
const targets = async () => (await cdp("Target.getTargets")).result.targetInfos;

try {
  const loaded = await cdp("Extensions.loadUnpacked", { path: ROOT + "extension" });
  if (loaded.error) throw new Error("Extensions.loadUnpacked failed: " + JSON.stringify(loaded.error));
  const sw = await until(async () => (await targets()).find((t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://") && t.url.endsWith("/background/index.js")), 8000, "Mikoshi service worker").catch(async (e) => { console.log("targets seen:", (await targets()).map((t) => `${t.type} ${t.url}`)); throw e; });
  if (process.env.DEBUG_E2E) console.log("targets:", (await targets()).map((t) => `${t.type} ${t.url}`));
  const EXT = new URL(sw.url).host;
  check("extension loads and its service worker starts", !!EXT);
  const swS = await attach(sw.targetId);
  await ev(swS, `await chrome.storage.local.set({"mikoshi:profile": ${JSON.stringify(Object.fromEntries(Object.entries(PROFILE).map(([k, v]) => [k, { value: v, autofill: true }])))}, "mikoshi:settings": {serverUrl: "http://127.0.0.1:${PROXY}"}}); return true`);

  const openTab = async (url) => { const { targetId } = (await cdp("Target.createTarget", { url })).result; await sleep(900); return { targetId, sid: await attach(targetId) }; };
  const chromeTabId = async (prefix) => ev(swS, `const t=(await chrome.tabs.query({})).find(t=>t.url&&t.url.startsWith(${JSON.stringify(prefix)})); return t&&t.id`);
  const panel = await openTab(`chrome-extension://${EXT}/panel/panel.html`);
  await ev(panel.sid, `window.__ev=[];window.__appr=[]; chrome.runtime.onMessage.addListener(m=>{ if(m.type==='MIKOSHI_EVENT') window.__ev.push(m.event); if(m.type==='MIKOSHI_APPROVAL_REQ'){ window.__appr.push(m.request); chrome.runtime.sendMessage({type:'MIKOSHI_APPROVAL_RES',id:m.id,decision:'approve'}); } }); return true`);
  const run = async (tabPrefix, goal, mode) => {
    await ev(panel.sid, `window.__ev=[];window.__appr=[];return true`);
    const tabId = await chromeTabId(tabPrefix);
    const r = await ev(panel.sid, `return await chrome.runtime.sendMessage({type:'MIKOSHI_START_TASK',goal:${JSON.stringify(goal)},mode:${JSON.stringify(mode)},tabId:${tabId}})`);
    if (!r?.ok) throw new Error("start failed: " + JSON.stringify(r));
    await until(async () => (await ev(panel.sid, `return __ev.some(e=>e.phase==='result')`)), 90000, "task result");
    return { events: await ev(panel.sid, `return __ev`), approvals: await ev(panel.sid, `return __appr`) };
  };

  // ---------- Demo A: KYC ----------
  const kyc = await openTab(`${FX}/kyc/`);
  bodies.length = 0;
  const a = await run(`${FX}/kyc/`, "Fill my KYC form and submit it", "act");
  const aRes = a.events.find((e) => e.phase === "result");
  check("KYC: task finished", aRes.status === "done", JSON.stringify(aRes).slice(0, 200));
  const vals = await ev(kyc.sid, `const g=i=>document.getElementById(i).value; return {aadhaar:g('aadhaar'),pan:g('pan'),mobile:g('mobile'),email:g('email'),name:g('fullname'),dob:g('dob'),submitted:window.__kycSubmitted===true}`);
  check("KYC: Aadhaar typed with the real value", vals.aadhaar.replace(/\s/g, "") === AADHAAR, vals.aadhaar);
  check("KYC: PAN, mobile, email, name and DOB typed", vals.pan === "ABCPE1234F" && vals.mobile === "9876543210" && vals.email === PROFILE.email && vals.name === "Asha Rao" && vals.dob === "15/08/1999", JSON.stringify(vals));
  check("KYC: form was submitted after approval", vals.submitted && a.approvals.some((r) => r.action?.action === "submit"), JSON.stringify(a.approvals).slice(0, 200));
  check("KYC: the server was called", bodies.length >= 2, String(bodies.length));
  const wire = bodies.join("\n");
  for (const raw of RAW) check(`KYC: "${raw.slice(0, 4)}…" never reached the server`, !wire.includes(raw));
  check("KYC: placeholders were sent instead", /\[AADHAAR_1\]/.test(wire) && /\[PAN_1\]/.test(wire));
  check("KYC: the log has the privacy phases", ["perceive", "verify", "egress", "plan", "execute"].every((ph) => a.events.some((e) => e.phase === ph)));
  const logText = JSON.stringify(a.events);
  check("KYC: the activity log contains no raw values", RAW.every((r) => !logText.includes(r)));

  // ---------- Demo B: portal, read-only ----------
  const portal = await openTab(`${FX}/portal/`);
  bodies.length = 0;
  const b = await run(`${FX}/portal/`, "Tell me the tuition fee due date", "read_only");
  const bRes = b.events.find((e) => e.phase === "result");
  check("Portal: task finished", bRes.status === "done", JSON.stringify(bRes).slice(0, 200));
  check("Portal: the answer has the due date", /30 Nov 2026/.test(bRes.outcome?.summary || ""), bRes.outcome?.summary);
  check("Portal: no 'Pay now' click happened", !b.events.some((e) => /Pay now|pay\.html/i.test(e.detail || "")));
  check("Portal: the hidden injection made the page count as hostile (clicks needed approval)", b.approvals.some((r) => (r.reasons || []).some((x) => /injection/i.test(x))), JSON.stringify(b.approvals).slice(0, 200));
  check("Portal: nothing typed in read-only mode", !b.events.some((e) => e.phase === "execute" && /^type/.test(e.detail || "")));
  check("Portal: nothing personal from the profile was sent", RAW.every((r) => !bodies.join("\n").includes(r)));
} catch (e) { console.log("ERROR", e.stack || e.message); failed++; }
cleanup();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
