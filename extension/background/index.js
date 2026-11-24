// Service worker: wires Chrome APIs to the orchestrator. Kept thin; the logic lives in
// orchestrator.js and lib/, which are tested without a browser.
import { createOrchestrator } from "./orchestrator.js";
import { postStep, checkHealth } from "./api-client.js";
import * as store from "./storage.js";
import * as tabsApi from "./tabs.js";
import { makeVision } from "./vision.js";

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
let task = null;                       // { tabId, stop, pending }
const approvals = new Map();           // id -> resolve
let recent = [];
let lastSent = null;
let uid = 0;

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

function broadcast(event) {
  recent = recent.concat([event]).slice(-200);
  // the final answer may contain real values put back for the user: show it, never store it
  const stored = event.phase === "result" ? { ts: event.ts, phase: "result", status: event.status, detail: "" } : event;
  store.appendLog(stored).catch(() => {});
  chrome.runtime.sendMessage({ type: "MIKOSHI_EVENT", event }).catch(() => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(tabId) {
  await sleep(300);
  for (let i = 0; i < 60; i++) { const t = await chrome.tabs.get(tabId).catch(() => null); if (!t || t.status === "complete") return; await sleep(250); }
}

function askUser(request) {
  return new Promise((resolve) => {
    const id = `a${++uid}`;
    const timer = setTimeout(() => { approvals.delete(id); if (task) task.pending = null; resolve("stop"); }, APPROVAL_TIMEOUT_MS);
    approvals.set(id, (decision) => { clearTimeout(timer); approvals.delete(id); if (task) task.pending = null; resolve(decision); });
    if (task) task.pending = { id, request };
    chrome.runtime.sendMessage({ type: "MIKOSHI_APPROVAL_REQ", id, request }).catch(() => {});
  });
}

async function startTask({ goal, mode, tabId }) {
  if (task) throw new Error("a task is already running");
  const tab = tabId ? await chrome.tabs.get(tabId) : await tabsApi.activeTab();
  if (!tab || !tabsApi.isWebUrl(tab.url || "")) throw new Error("open the web page you want Mikoshi to work on first");
  const settings = await store.getSettings();
  const profile = await store.profileForAgent();
  task = { tabId: tab.id, stop: false, pending: null, lastPayload: null };
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);

  const send = (msg) => chrome.tabs.sendMessage(task.tabId, msg);
  const deps = {
    perceive: async () => { await tabsApi.ensureContent(task.tabId); const r = await send({ type: "MIKOSHI_PERCEIVE" }); if (!r?.ok) throw new Error("could not read the page"); return r.page; },
    vision: makeVision(settings, task),
    api: (payload) => postStep(payload, settings),
    execute: async (action, value) => {
      try {
        if (action.action === "navigate") { await tabsApi.navigate(task.tabId, action.url); return { ok: true, navigated: true }; }
        if (action.action === "open_tab") { const t = await tabsApi.openTab(action.url); task.tabId = t.id; return { ok: true, navigated: true }; }
        await tabsApi.ensureContent(task.tabId);
        const res = await send({ type: "MIKOSHI_EXEC", action, value });
        if (res?.navigated) await settle(task.tabId);
        return res || { ok: false, error: "no answer from the page" };
      } catch (e) {
        // a click that navigates can close the message channel before the reply arrives
        if (action.action === "click" && /message port closed|Receiving end|context invalidated/i.test(String(e?.message))) { await settle(task.tabId); return { ok: true, navigated: true }; }
        return { ok: false, error: String(e?.message || e).slice(0, 80) };
      }
    },
    readNodes: async (ids) => { const r = await send({ type: "MIKOSHI_READ", ids }); return r?.texts || []; },
    approve: askUser,
    profile: () => profile,
    emit: broadcast,
    onSend: (payload) => { task.lastPayload = JSON.stringify({ ...payload, screenshot: payload.screenshot ? `[redacted image, ${payload.screenshot.length} chars]` : null }, null, 2); },
    settings: { ...settings, canaries: [] },
    now: () => Date.now(),
    shouldStop: () => task?.stop === true,
  };

  recent = [];
  createOrchestrator(deps)({ goal, mode })
    .then((outcome) => broadcast({ ts: Date.now(), phase: "result", status: outcome.status, detail: outcome.summary || outcome.reason || "", outcome }))
    .catch((e) => broadcast({ ts: Date.now(), phase: "result", status: "failed", detail: String(e?.message || e).slice(0, 120) }))
    .finally(() => { clearInterval(keepAlive); lastSent = task?.lastPayload ?? lastSent; task = null; });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg?.type?.startsWith("MIKOSHI_")) return false;
  (async () => {
    switch (msg.type) {
      case "MIKOSHI_START_TASK": await startTask(msg); return { ok: true };
      case "MIKOSHI_STOP": if (task) { task.stop = true; for (const resolve of approvals.values()) resolve("stop"); } return { ok: true };
      case "MIKOSHI_APPROVAL_RES": approvals.get(msg.id)?.(["approve", "deny", "stop"].includes(msg.decision) ? msg.decision : "deny"); return { ok: true };
      case "MIKOSHI_GET_STATE": return { ok: true, running: !!task, events: recent, pending: task?.pending ?? null, lastPayload: task?.lastPayload ?? lastSent };
      case "MIKOSHI_TEST_CONNECTION": return { ok: true, health: await checkHealth(await store.getSettings()) };
      default: return { ok: false, error: "unknown message" };
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e).slice(0, 160) }));
  return true;
});
