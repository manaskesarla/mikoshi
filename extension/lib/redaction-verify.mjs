// The recheck. The first redaction pass only masks what the first detection pass
// found, so it cannot see what that pass missed. This gate:
//   1. OCRs the ALREADY-MASKED image (masked pixels read as nothing),
//   2. re-runs PII + secret detection at a paranoid threshold,
//   3. residual hits -> mask them (padded) once more,
//   4. re-checks. Still leaking, or OCR failed -> ok:false. The caller must NOT send.
// Bounded to exactly one extra pass. OCR is injected so this module stays pure.
//
//   verifyRedaction({ canvas, ocr, minConfidence? }) -> Promise<{
//     ok, passes, reason?: "REDACTION_FAILED" | "OCR_FAILED", residual: [{ category }], added }>
// `ocr(canvas)` resolves to lines: [{ text, bbox: { x0, y0, x1, y1 } }].
// Results never contain recognised text.

import { detectPII } from "./pii-rules.mjs";
import { scanSecrets } from "./secret-scanner.mjs";
import { redactCanvas } from "./redact.mjs";

const PARANOID = 0.4;

/** char span inside a line -> pixel box, assuming roughly even character width */
function spanToBox(line, start, end) {
  const { x0, y0, x1, y1 } = line.bbox;
  const n = Math.max(1, (line.text || "").length);
  const w = x1 - x0;
  return { x0: x0 + (w * start) / n, x1: x0 + (w * end) / n, y0, y1 };
}

function residualBoxes(lines, minConfidence) {
  const out = [];
  for (const line of lines || []) {
    const text = line?.text || "";
    if (!text || !line.bbox) continue;
    for (const h of detectPII(text, { minConfidence })) out.push({ category: h.category, box: spanToBox(line, h.start, h.end) });
    for (const s of scanSecrets(text, { minConfidence })) out.push({ category: "secret", box: spanToBox(line, s.start, s.end) });
  }
  return out;
}

export async function verifyRedaction({ canvas, ocr, minConfidence = PARANOID }) {
  let added = 0;
  let residual = [];
  for (let pass = 1; pass <= 2; pass++) {
    let lines;
    try { lines = await ocr(canvas); } catch { return { ok: false, passes: pass, reason: "OCR_FAILED", residual: [], added }; }
    residual = residualBoxes(lines, minConfidence);
    if (!residual.length) return { ok: true, passes: pass, residual: [], added };
    if (pass === 2) break;
    // widen the box more than the first pass did: the first box was evidently too small
    added += redactCanvas(canvas, residual.map((r) => r.box), { pad: 6 }).masked;
  }
  return { ok: false, passes: 2, reason: "REDACTION_FAILED", residual: residual.map((r) => ({ category: r.category })), added };
}

export default { verifyRedaction };
