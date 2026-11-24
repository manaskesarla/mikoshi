// Tab helpers for the task tab: inject the page code, navigate safely, wait for load.
const LOAD_TIMEOUT_MS = 15000;

export async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

export async function ensureContent(tabId) {
  try { const r = await chrome.tabs.sendMessage(tabId, { type: "MIKOSHI_PING" }); if (r?.ok) return; } catch { /* not loaded yet */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/loader.js"] });
  for (let i = 0; i < 20; i++) {
    try { const r = await chrome.tabs.sendMessage(tabId, { type: "MIKOSHI_PING" }); if (r?.ok) return; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("page code did not start (is the site allowed?)");
}

export function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); resolve(); };
    const on = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const t = setTimeout(done, LOAD_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(on);
  });
}

export function isWebUrl(url) {
  try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}

export async function navigate(tabId, url) {
  if (!isWebUrl(url)) throw new Error("only http and https addresses can be opened");
  const loaded = waitForLoad(tabId);
  await chrome.tabs.update(tabId, { url });
  await loaded;
}

export async function openTab(url) {
  if (!isWebUrl(url)) throw new Error("only http and https addresses can be opened");
  const tab = await chrome.tabs.create({ url, active: true });
  await waitForLoad(tab.id);
  return tab;
}
