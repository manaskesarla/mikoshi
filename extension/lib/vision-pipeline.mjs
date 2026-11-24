// Screenshot -> find personal data -> black it out -> recheck -> fail closed.
//   processVision({ image, viewport, domBoxes, known, ocr, createCanvas, loadImage })
//     -> { image: dataURL|null, verify: { ok, reason?, ... }, stats? }
// All I/O (canvas, image decoding, OCR) is injected, so the logic runs under Node with fakes
// and in the browser's offscreen document with real ones.
//   image      PNG/JPEG data URL of the visible tab
//   viewport   { w } CSS width of the page, to scale DOM boxes onto the image
//   domBoxes   [{ x, y, w, h, category }] CSS-pixel boxes of fields the page marked sensitive
//   known      [{ value, category }] values the user's vault knows (local only)
//   ocr(canvas) -> [{ text, bbox: { x0, y0, x1, y1 } }]

import { detectPII } from "./pii-rules.mjs";
import { scanSecrets } from "./secret-scanner.mjs";
import { Vault } from "./tokenizer.mjs";
import { mergeDetections } from "./merge.mjs";
import { redactCanvas } from "./redact.mjs";
import { verifyRedaction, spanToBox } from "./redaction-verify.mjs";

const toBox = (b, category, source) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, category, confidence: 0.9, sources: [source] });

export async function processVision({ image, viewport, domBoxes = [], known = [], ocr, createCanvas, loadImage, quality = 0.7 }) {
  let canvas, lines;
  try {
    const img = await loadImage(image);
    canvas = createCanvas(img.width, img.height);
    canvas.getContext("2d").drawImage(img, 0, 0);
    lines = await ocr(canvas);
  } catch (e) {
    return { image: null, verify: { ok: false, reason: "OCR_FAILED", detail: String(e?.message || e).slice(0, 160) } };
  }

  const vault = new Vault();
  for (const k of known) vault.add(k.value, k.category, "known");
  // a line that contains a value the vault knows is masked whole: conservative on purpose
  const knownLines = (ls) => (ls || []).filter((l) => l?.text && l.bbox && vault.redactText(l.text) !== l.text).map((l) => ({ category: "known value", box: l.bbox }));

  const ocrBoxes = [];
  for (const l of lines) {
    if (!l?.text || !l.bbox) continue;
    for (const h of detectPII(l.text, { minConfidence: 0.5 })) ocrBoxes.push(toBox(spanToBox(l, h.start, h.end), h.category, "ocr"));
    for (const s of scanSecrets(l.text)) ocrBoxes.push(toBox(spanToBox(l, s.start, s.end), "secret", "ocr"));
  }
  for (const k of knownLines(lines)) ocrBoxes.push(toBox(k.box, k.category, "ocr-known"));

  const scale = viewport?.w ? canvas.width / viewport.w : 1;
  const dom = domBoxes.map((b) => toBox({ x0: b.x * scale, y0: b.y * scale, x1: (b.x + b.w) * scale, y1: (b.y + b.h) * scale }, b.category || "sensitive field", "dom"));

  const merged = mergeDetections([ocrBoxes, dom]);
  redactCanvas(canvas, merged, { pad: 3 });

  const verify = await verifyRedaction({ canvas, ocr, extraDetect: knownLines });
  if (!verify.ok) return { image: null, verify };
  return { image: canvas.toDataURL("image/jpeg", quality), verify: { ok: true, passes: verify.passes }, stats: { lines: lines.length, boxes: merged.length, extra: verify.added } };
}

export default { processVision };
