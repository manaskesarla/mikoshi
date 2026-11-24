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
  await ev(swS, `await chrome.storage.local.set({"mikoshi:settings": {serverUrl: "http://127.0.0.1:${PROXY}"}}); return true`);

  const openTab = async (url) => {
    const { targetId } = (await cdp("Target.createTarget", { url })).result;
    const sid = await attach(targetId);
    const wantChrome = url.startsWith("chrome-extension://");
    await until(async () => ev(sid, `return location.href.startsWith(${JSON.stringify(url.slice(0, 20))}) && document.readyState==='complete' && ${wantChrome ? "typeof chrome!=='undefined' && !!chrome.runtime && !!document.getElementById('goal')" : "true"}`), 20000, `page ${url}`);
    return { targetId, sid };
  };
  const chromeTabId = async (prefix) => ev(panel.sid, `const t=(await chrome.tabs.query({})).find(t=>t.url&&t.url.startsWith(${JSON.stringify(prefix)})); return t&&t.id`);
  const panel = await openTab(`chrome-extension://${EXT}/panel/panel.html`);
  // ---------- Panel UI (driven through the real DOM)
  const ui = (js) => ev(panel.sid, js);
  const setVal = (id, v) => `{const e=document.getElementById(${JSON.stringify(id)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true}));}`;
  check("panel: renders with three tabs", await ui(`return document.title==='Mikoshi' && document.querySelectorAll('[role=tab]').length===3`));
  await ui(`document.getElementById('tab-profile').click(); return true`);
  check("panel: tab switching shows the profile and hides the task view", await ui(`return !document.getElementById('view-profile').hidden && document.getElementById('view-task').hidden && document.getElementById('tab-profile').getAttribute('aria-selected')==='true'`));
  await ui(`${setVal("pf-aadhaar", "234567890123")} ${setVal("pf-pan", "ABCDE1234F")} document.getElementById('saveProfile').click(); await new Promise(r=>setTimeout(r,200)); return true`);
  const bad = await ui(`return {a:document.getElementById('pf-aadhaar-hint').textContent, p:document.getElementById('pf-pan-hint').textContent, flag:document.getElementById('pf-aadhaar').getAttribute('aria-invalid'), msg:document.getElementById('profileMsg').textContent}`);
  check("panel: an invalid Aadhaar and PAN are rejected with a clear message", /valid Aadhaar/.test(bad.a) && /valid PAN/.test(bad.p) && bad.flag === "true" && /Fix/.test(bad.msg), JSON.stringify(bad));
  check("panel: nothing is saved while the profile has errors", (await ui(`return (await chrome.storage.local.get('mikoshi:profile'))['mikoshi:profile']`)) === undefined);
  const fill = Object.entries({ "pf-full-name": PROFILE["full name"], "pf-dob": PROFILE.dob, "pf-email": PROFILE.email, "pf-phone-in": PROFILE["phone-in"], "pf-aadhaar": AADHAAR, "pf-pan": PROFILE.pan }).map(([id, v]) => setVal(id, v)).join(" ");
  await ui(`${fill} document.getElementById('saveProfile').click(); await new Promise(r=>setTimeout(r,300)); return true`);
  const saved = await ui(`return (await chrome.storage.local.get('mikoshi:profile'))['mikoshi:profile']`);
  check("panel: a valid profile is saved locally", saved?.aadhaar?.value === AADHAAR && saved?.pan?.value === "ABCPE1234F" && saved?.["full name"]?.autofill === true, JSON.stringify(saved));
  await ui(`document.getElementById('tab-settings').click(); document.getElementById('testConn').click(); await new Promise(r=>setTimeout(r,700)); return true`);
  check("panel: 'Test connection' reaches the server", /Connected\. Model: mock/.test(await ui(`return document.getElementById('settingsMsg').textContent`)), await ui(`return document.getElementById('settingsMsg').textContent`));
  await ui(`document.getElementById('tab-task').click(); document.getElementById('start').click(); await new Promise(r=>setTimeout(r,200)); return true`);
  check("panel: starting with no goal is refused politely", /Describe the task/.test(await ui(`return document.getElementById('status').textContent`)));
  await ui(`window.__ev=[];window.__appr=[];window.__auto=true; chrome.runtime.onMessage.addListener(m=>{ if(m.type==='MIKOSHI_EVENT') window.__ev.push(m.event); if(m.type==='MIKOSHI_APPROVAL_REQ'){ window.__appr.push(m.request); if(window.__auto) setTimeout(()=>chrome.runtime.sendMessage({type:'MIKOSHI_APPROVAL_RES',id:m.id,decision:'approve'}),50); } }); return true`);
  const run = async (tabPrefix, goal, mode) => {
    await ev(panel.sid, `window.__ev=[];window.__appr=[];return true`);
    const tabId = await chromeTabId(tabPrefix);
    const r = await ev(panel.sid, `return await chrome.runtime.sendMessage({type:'MIKOSHI_START_TASK',goal:${JSON.stringify(goal)},mode:${JSON.stringify(mode)},tabId:${tabId}})`);
    if (!r?.ok) throw new Error("start failed: " + JSON.stringify(r));
    await until(async () => (await ev(panel.sid, `return __ev.some(e=>e.phase==='result')`)), 90000, "task result").catch(async (e) => {
      console.log("--- task stalled. events:", JSON.stringify((await ev(panel.sid, `return __ev`)).slice(-6)), "\n--- approvals:", JSON.stringify(await ev(panel.sid, `return __appr`)).slice(0, 600), "\n--- state:", JSON.stringify(await ev(panel.sid, `return await chrome.runtime.sendMessage({type:'MIKOSHI_GET_STATE'})`)).slice(0, 600));
      throw e;
    });
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

  check("panel: 'what was sent' shows placeholders and no raw values", await ui(`const t=document.getElementById('sentBody').textContent; return /\\[AADHAAR_1\\]/.test(t) && !t.includes(${JSON.stringify(AADHAAR)}) && !t.includes('ABCPE1234F')`), await ui(`return document.getElementById('sentBody').textContent.slice(0,200)`));
  check("panel: the activity list was populated", (await ui(`return document.querySelectorAll('#activity li').length`)) >= 5);

  // ---------- Approval card in the panel UI: Deny
  await ev(kyc.sid, `location.reload(); return true`); await sleep(1000);
  await ui(`window.__auto=false; window.__ev=[]; window.__appr=[]; document.getElementById('goal').value='Fill my KYC form and submit it'; document.getElementById('tab-task').click(); return true`);
  const tid = await chromeTabId(`${FX}/kyc/`);
  await ev(panel.sid, `return await chrome.runtime.sendMessage({type:'MIKOSHI_START_TASK',goal:'Fill my KYC form and submit it',mode:'act',tabId:${tid}})`);
  const card = await until(async () => { const c = await ui(`const a=document.getElementById('approval'); return a.hidden ? null : a.textContent`); return c; }, 60000, "approval card");
  check("panel: the approval card names the action, risk and masks the value", /submit/i.test(card) && /Risk:/.test(card) && !card.includes("ABCPE1234F") && !card.includes(AADHAAR), card);
  check("panel: CRITICAL-free card offers Approve, Deny and Stop", await ui(`return [...document.querySelectorAll('#approval button')].map(b=>b.textContent).join('|')`) === "Approve once|Deny|Stop task");
  await ui(`[...document.querySelectorAll('#approval button')].find(b=>b.textContent==='Deny').click(); return true`);
  await until(async () => ui(`return __ev.some(e=>e.phase==='result')`), 60000, "result after deny");
  check("panel: denying keeps the form unsent", (await ev(kyc.sid, `return window.__kycSubmitted===true`)) === false);
  check("panel: the result card is shown", await ui(`return !document.getElementById('result').hidden`));

  // ---------- Demo B: portal, read-only ----------
  await ui(`window.__auto=true; return true`);
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
  const storedLog = JSON.stringify(await ui(`return (await chrome.storage.local.get('mikoshi:log'))['mikoshi:log']`));
  check("storage: the persisted activity log (both demos) holds no raw personal values", storedLog.length > 50 && RAW.every((r) => !storedLog.includes(r)), storedLog.slice(0, 120));
} catch (e) { console.log("ERROR", e.stack || e.message); failed++; }
cleanup();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
