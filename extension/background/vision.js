// Screenshot -> redact -> recheck, via the offscreen OCR document.
// Contract (used by the orchestrator): vision(page, { known }) -> { image, verify, stats? }.
// With screenshots off (the default) nothing image-shaped is produced or sent.
const OFFSCREEN_URL = "offscreen/offscreen.html";

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  // [VERIFY] reasons/justification against the current chrome.offscreen docs
  await chrome.offscreen.createDocument({ url: OFFSCREEN_URL, reasons: ["WORKERS"], justification: "Run OCR locally so personal data can be blacked out of screenshots before anything is sent." });
}

export function makeVision(settings, taskRef) {
  return async function vision(page, { known = [] } = {}) {
    if (!settings.useScreenshot) return { image: null, verify: { ok: true } };
    const tab = await chrome.tabs.get(taskRef.tabId);
    if (!tab.active) await chrome.tabs.update(tab.id, { active: true });   // captureVisibleTab sees the active tab only
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    await ensureOffscreen();
    const domBoxes = page.skeleton.nodes.filter((n) => n.isCensored && n.visible && n.bbox?.w > 0).map((n) => ({ ...n.bbox, category: n.piiCategory }));
    const res = await chrome.runtime.sendMessage({ type: "MIKOSHI_VISION", payload: { image: shot, viewport: page.skeleton.viewport, domBoxes, known } });
    if (!res) return { image: null, verify: { ok: false, reason: "OCR_FAILED" } };
    return res;
  };
}
