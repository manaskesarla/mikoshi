// Runs OCR and screenshot redaction inside the extension (offscreen document).
// Nothing here touches the network: OCR code, WebAssembly core and language data are bundled
// in extension/vendor/ (npm run fetch:vendor).
import { processVision } from "../lib/vision-pipeline.mjs";

let workerPromise = null;
function getWorker() {
  workerPromise ??= Tesseract.createWorker("eng", 1, {
    workerPath: chrome.runtime.getURL("vendor/worker.min.js"),
    corePath: chrome.runtime.getURL("vendor/"),
    langPath: chrome.runtime.getURL("vendor/"),
    workerBlobURL: false,
    gzip: true,
  });
  return workerPromise;
}

/** Normalises tesseract.js output (shape differs between versions) to [{ text, bbox }]. */
function linesOf(data) {
  if (Array.isArray(data.lines) && data.lines.length) return data.lines;
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) out.push(l);
  return out;
}
async function ocr(canvas) {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  return linesOf(data).map((l) => ({ text: String(l.text || "").replace(/\n/g, " ").trim(), bbox: l.bbox })).filter((l) => l.text && l.bbox);
}
const createCanvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
const loadImage = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("image decode failed")); i.src = src; });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "MIKOSHI_VISION") return false;
  processVision({ ...msg.payload, ocr, createCanvas, loadImage })
    .then(sendResponse, (e) => sendResponse({ image: null, verify: { ok: false, reason: "OCR_FAILED" }, error: String(e?.message || e).slice(0, 80) }));
  return true;
});
