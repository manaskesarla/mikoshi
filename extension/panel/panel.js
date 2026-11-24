// Side panel. All text is written with textContent (never innerHTML): event text can be derived from web pages.
import { getSettings, saveSettings, getProfile, saveProfile, clearAll } from "../background/storage.js";
import { verhoeffValid, panValid } from "../lib/pii-checksums.mjs";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

// ---------- tabs
const tabs = ["task", "profile", "settings"];
function showTab(name) {
  for (const t of tabs) { $(`tab-${t}`).setAttribute("aria-selected", String(t === name)); $(`view-${t}`).hidden = t !== name; }
}
for (const t of tabs) $(`tab-${t}`).addEventListener("click", () => showTab(t));

// ---------- activity + task
let running = false;
function setRunning(v) { running = v; $("start").disabled = v; $("stop").disabled = !v; }
function addEvent(e) {
  if (e.phase === "result") return showResult(e);
  const li = el("li", {}, el("span", { className: "ph", textContent: e.phase || "" }), el("span", { className: `st-${e.status || "ok"}`, textContent: `${e.status || ""} ${e.detail || ""}`.trim() }));
  $("activity").append(li);
  $("activity").scrollTop = $("activity").scrollHeight;
  if (e.phase === "egress") refreshSent();
}
function showResult(e) {
  setRunning(false); hideApproval();
  const ok = e.status === "done";
  $("status").textContent = ok ? "Done." : `Stopped: ${e.status}${e.detail ? ` (${e.detail})` : ""}`;
  const box = $("result"); box.hidden = false; box.className = `card ${ok ? "ok" : ""}`;
  box.replaceChildren(el("strong", { textContent: ok ? "Result" : "Task ended" }), el("p", { textContent: e.outcome?.summary || e.detail || e.status }));
}
async function refreshSent() { const s = await send({ type: "MIKOSHI_GET_STATE" }); if (s?.lastPayload) $("sentBody").textContent = s.lastPayload; }

// ---------- approvals
function hideApproval() { $("approval").hidden = true; $("approval").replaceChildren(); }
function showApproval(id, req) {
  const box = $("approval"); box.hidden = false;
  box.className = `card risk-${req.risk || "MEDIUM"}`;
  const title = req.kind === "egress" ? "Mikoshi wants to send data to the AI" : req.kind === "question" ? "Mikoshi has a question" : `Approve: ${req.action?.action || "action"}`;
  const body = [el("strong", { textContent: title })];
  if (req.question) body.push(el("p", { textContent: req.question }));
  if (req.action) body.push(el("p", { textContent: [req.action.targetId && `element ${req.action.targetId}`, req.action.fillToken && `value ${req.action.fillToken}${req.preview ? ` (${req.preview})` : ""}`, req.action.url].filter(Boolean).join(" · ") }));
  if (req.risk) body.push(el("p", { textContent: `Risk: ${req.risk}` }));
  if (req.reasons?.length) body.push(el("ul", {}, ...req.reasons.map((r) => el("li", { textContent: r }))));
  const answer = (decision) => async () => { hideApproval(); await send({ type: "MIKOSHI_APPROVAL_RES", id, decision }); };
  const row = el("div", { className: "row" });
  if (req.risk !== "CRITICAL") row.append(el("button", { className: "primary", textContent: req.kind === "question" ? "Continue" : "Approve once", onclick: answer("approve") }));
  if (req.kind !== "question") row.append(el("button", { textContent: "Deny", onclick: answer("deny") }));
  row.append(el("button", { textContent: "Stop task", onclick: answer("stop") }));
  box.replaceChildren(...body, row);
  box.querySelector("button")?.focus();
}

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "MIKOSHI_EVENT") addEvent(m.event);
  if (m?.type === "MIKOSHI_APPROVAL_REQ") showApproval(m.id, m.request);
});

$("start").addEventListener("click", async () => {
  const goal = $("goal").value.trim();
  if (!goal) { $("status").textContent = "Describe the task first."; return; }
  await saveSettings({ approvalMode: $("approvalMode").value });
  $("activity").replaceChildren(); $("result").hidden = true; hideApproval(); $("sentBody").textContent = "Nothing sent yet.";
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const r = await send({ type: "MIKOSHI_START_TASK", goal, mode: document.querySelector('input[name="mode"]:checked').value, tabId: tab?.id });
  if (!r?.ok) { $("status").textContent = `Could not start: ${r?.error || "unknown error"}`; return; }
  setRunning(true); $("status").textContent = "Working…";
});
$("stop").addEventListener("click", () => send({ type: "MIKOSHI_STOP" }));

// ---------- profile
const FIELDS = [
  { key: "full name", label: "Full name", check: (v) => v.trim().length >= 2 || "Enter your full name." },
  { key: "dob", label: "Date of birth (DD/MM/YYYY)", check: (v) => /^(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(19|20)\d{2}$/.test(v) || "Use DD/MM/YYYY." },
  { key: "email", label: "Email", check: (v) => /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(v) || "Enter a valid email." },
  { key: "phone-in", label: "Mobile number (10 digits)", check: (v) => /^[6-9]\d{9}$/.test(v.replace(/[\s-]/g, "")) || "Enter a 10-digit Indian mobile number." },
  { key: "address", label: "Address", check: () => true },
  { key: "postal code", label: "PIN code", check: (v) => /^\d{6}$/.test(v) || "PIN codes have 6 digits." },
  { key: "aadhaar", label: "Aadhaar number", sensitive: true, check: (v) => (/^\d{12}$/.test(v.replace(/\s/g, "")) && verhoeffValid(v)) || "That is not a valid Aadhaar number (12 digits, with a valid check digit)." },
  { key: "pan", label: "PAN", sensitive: true, check: (v) => panValid(v) || "That is not a valid PAN (e.g. ABCPE1234F)." },
];
const inputs = {};
function buildProfileForm(profile) {
  const form = $("profileForm"); form.replaceChildren();
  for (const f of FIELDS) {
    const id = `pf-${f.key.replace(/\W+/g, "-")}`;
    const input = el("input", { id, type: "text", autocomplete: "off", value: profile[f.key]?.value || "" });
    const auto = el("input", { type: "checkbox", checked: profile[f.key]?.autofill !== false, id: `${id}-auto`, title: "Allow auto-fill" });
    const hint = el("div", { className: "hint", id: `${id}-hint` });
    input.setAttribute("aria-describedby", hint.id);
    const label = el("label", { htmlFor: id, textContent: f.label });
    if (f.sensitive) label.append(el("span", { className: "badge", textContent: "sensitive" }));
    form.append(el("div", { className: "field" }, label, input, el("label", { className: "inline", htmlFor: auto.id }, auto, "auto-fill"), hint));
    inputs[f.key] = { input, auto, hint, f };
  }
}
function validateProfile() {
  const out = {}; let ok = true;
  for (const { input, auto, hint, f } of Object.values(inputs)) {
    const v = input.value.trim();
    hint.textContent = ""; input.removeAttribute("aria-invalid");
    if (!v) continue;
    const r = f.check(v);
    if (r !== true) { ok = false; hint.textContent = r; input.setAttribute("aria-invalid", "true"); continue; }
    out[f.key] = { value: v, autofill: auto.checked };
  }
  return ok ? out : null;
}
$("saveProfile").addEventListener("click", async (e) => {
  e.preventDefault();
  const p = validateProfile();
  $("profileMsg").textContent = p ? "Saved." : "Fix the highlighted fields first.";
  if (p) await saveProfile(p);
});
$("exportProfile").addEventListener("click", async () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(await getProfile(), null, 2)], { type: "application/json" }));
  el("a", { href: url, download: "mikoshi-profile.json" }).click(); URL.revokeObjectURL(url);
});
$("importProfile").addEventListener("change", async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    const keys = new Set(FIELDS.map((f) => f.key));
    await saveProfile(Object.fromEntries(Object.entries(data).filter(([k, v]) => keys.has(k) && v && typeof v.value === "string")));
    buildProfileForm(await getProfile()); $("profileMsg").textContent = "Imported.";
  } catch { $("profileMsg").textContent = "That file is not a Mikoshi profile."; }
});
$("wipe").addEventListener("click", async () => {
  if (!confirm("Delete your profile, settings and activity history from this browser?")) return;
  await clearAll(); buildProfileForm({}); await loadSettings(); $("profileMsg").textContent = "All data deleted.";
});

// ---------- settings
async function loadSettings() {
  const s = await getSettings();
  $("serverUrl").value = s.serverUrl; $("apiKey").value = s.apiKey; $("stepCap").value = s.stepCap;
  $("useScreenshot").checked = s.useScreenshot; $("trusted").value = s.trustedOrigins.join("\n"); $("approvalMode").value = s.approvalMode;
}
$("saveSettings").addEventListener("click", async () => {
  // Chrome only allows capturing a page with broad host access, so screenshots are opt-in: ask first, while the click still counts as a user gesture
  let shots = $("useScreenshot").checked, note = "";
  if (shots && !(await chrome.permissions.contains({ origins: ["<all_urls>"] }))) {
    if (!(await chrome.permissions.request({ origins: ["<all_urls>"] }))) { shots = false; $("useScreenshot").checked = false; note = " Screenshots were not enabled because the browser permission was not granted."; }
  }
  const origins = $("trusted").value.split("\n").map((x) => x.trim()).filter(Boolean);
  try { origins.forEach((o) => { if (new URL(o).origin !== o.replace(/\/$/, "")) throw new Error(); }); } catch { $("settingsMsg").textContent = "Trusted sites must be origins like https://portal.example"; return; }
  await saveSettings({ serverUrl: $("serverUrl").value.trim(), apiKey: $("apiKey").value, stepCap: Math.max(1, Math.min(50, +$("stepCap").value || 12)), useScreenshot: shots, trustedOrigins: origins });
  $("settingsMsg").textContent = `Saved.${note}`;
});
$("testConn").addEventListener("click", async () => {
  $("settingsMsg").textContent = "Testing…";
  await saveSettings({ serverUrl: $("serverUrl").value.trim(), apiKey: $("apiKey").value });
  const r = await send({ type: "MIKOSHI_TEST_CONNECTION" });
  $("settingsMsg").textContent = r?.ok ? `Connected. Model: ${r.health.model} (${r.health.vlm_mode}).` : `Could not connect: ${r?.error || "unknown error"}`;
});

// ---------- boot
(async () => {
  buildProfileForm(await getProfile());
  await loadSettings();
  const s = await send({ type: "MIKOSHI_GET_STATE" });
  if (s?.ok) { setRunning(s.running); (s.events || []).forEach(addEvent); if (s.pending) showApproval(s.pending.id, s.pending.request); if (s.lastPayload) $("sentBody").textContent = s.lastPayload; }
})();
