// Message endpoint inside the page (isolated world). The service worker asks; this answers.
import { perceive } from "./perceiver.mjs";
import { execute, readNodes } from "./executor.mjs";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("MIKOSHI_")) return false;
  try {
    if (msg.type === "MIKOSHI_PING") { sendResponse({ ok: true }); return false; }
    if (msg.type === "MIKOSHI_PERCEIVE") { sendResponse({ ok: true, page: perceive() }); return false; }
    if (msg.type === "MIKOSHI_READ") { sendResponse({ ok: true, texts: readNodes(msg.ids) }); return false; }
    if (msg.type === "MIKOSHI_EXEC") { execute(msg.action, msg.value).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e).slice(0, 80) })); return true; }
  } catch (e) { sendResponse({ ok: false, error: String(e?.message || e).slice(0, 80) }); }
  return false;
});
