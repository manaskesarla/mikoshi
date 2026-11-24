import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyRedaction } from "../extension/lib/redaction-verify.mjs";
import { redactCanvas, clampBox } from "../extension/lib/redact.mjs";
import { verhoeffCheckDigit } from "../extension/lib/pii-checksums.mjs";

const p = "23456789012";
const AADHAAR = p + verhoeffCheckDigit(p);

// Fake canvas: a scene of text lines plus the rectangles painted over it.
function makeCanvas(lines, width = 800, height = 200) {
  const fills = [];
  return { width, height, lines, fills, getContext: () => ({ set fillStyle(_) {}, fillRect: (x, y, w, h) => fills.push({ x0: x, y0: y, x1: x + w, y1: y + h }) }) };
}
// Fake OCR: a character is unreadable when a painted rectangle covers its centre.
const fakeOcr = async (canvas) => canvas.lines.map((l) => {
  const n = l.text.length; const cw = (l.bbox.x1 - l.bbox.x0) / n;
  const text = [...l.text].map((ch, i) => {
    const cx = l.bbox.x0 + cw * (i + 0.5); const cy = (l.bbox.y0 + l.bbox.y1) / 2;
    return canvas.fills.some((f) => cx >= f.x0 && cx <= f.x1 && cy >= f.y0 && cy <= f.y1) ? " " : ch;
  }).join("");
  return { text, bbox: l.bbox };
});

const line = (text, y = 10) => ({ text, bbox: { x0: 0, y0: y, x1: text.length * 10, y1: y + 20 } });

test("clean image passes on the first pass", async () => {
  const c = makeCanvas([line("Welcome to the portal")]);
  assert.deepEqual(await verifyRedaction({ canvas: c, ocr: fakeOcr }), { ok: true, passes: 1, residual: [], added: 0 });
});

test("fully masked PII passes", async () => {
  const text = `Aadhaar: ${AADHAAR}`;
  const c = makeCanvas([line(text)]);
  redactCanvas(c, [{ x0: 90, y0: 10, x1: text.length * 10, y1: 30 }]);
  assert.equal((await verifyRedaction({ canvas: c, ocr: fakeOcr })).ok, true);
});

test("a box drawn too small leaves PII readable; the gate grows it and then passes", async () => {
  const text = "mail asha.rao@example.com";
  const c = makeCanvas([line(text)]);
  redactCanvas(c, [{ x0: 50, y0: 10, x1: 100, y1: 30 }], { pad: 0 }); // hides only "asha."
  const r = await verifyRedaction({ canvas: c, ocr: fakeOcr });
  assert.equal(r.ok, true);
  assert.equal(r.passes, 2);
  assert.ok(r.added >= 1);
});

test("known limit: a partly masked number is no longer recognisable, so the gate passes it", async () => {
  const text = `Aadhaar: ${AADHAAR}`;
  const c = makeCanvas([line(text)]);
  redactCanvas(c, [{ x0: 130, y0: 10, x1: 170, y1: 30 }], { pad: 0 }); // hides only middle digits
  const r = await verifyRedaction({ canvas: c, ocr: fakeOcr });
  assert.equal(r.ok, true);
  assert.equal(r.passes, 1); // leading and trailing digits remain visible: full-box redaction must come from the first pass
});

test("unmasked PII that cannot be fixed fails closed without echoing it", async () => {
  const text = `Aadhaar: ${AADHAAR}`;
  const c = makeCanvas([line(text)]);
  const stubbornOcr = async () => [line(text)]; // masks have no effect
  const r = await verifyRedaction({ canvas: c, ocr: stubbornOcr });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "REDACTION_FAILED");
  assert.equal(r.residual[0].category, "aadhaar");
  assert.ok(!JSON.stringify(r).includes(AADHAAR));
});

test("OCR failure fails closed", async () => {
  const r = await verifyRedaction({ canvas: makeCanvas([]), ocr: async () => { throw new Error("worker died"); } });
  assert.deepEqual([r.ok, r.reason], [false, "OCR_FAILED"]);
});

test("secrets in the image are caught too", async () => {
  const c = makeCanvas([line("key AKIAIOSFODNN7EXAMPLE")]);
  const r = await verifyRedaction({ canvas: c, ocr: fakeOcr });
  assert.equal(r.ok, true);          // second pass masks it
  assert.equal(r.passes, 2);
});

test("verification is bounded to two OCR passes", async () => {
  let calls = 0;
  await verifyRedaction({ canvas: makeCanvas([]), ocr: async () => { calls++; return [line(`Aadhaar ${AADHAAR}`)]; } });
  assert.equal(calls, 2);
});

test("redactCanvas clamps to the canvas and skips empty boxes", () => {
  const c = makeCanvas([], 100, 50);
  const r = redactCanvas(c, [{ x0: -20, y0: -20, x1: 30, y1: 30 }, { x0: 500, y0: 500, x1: 600, y1: 600 }, { x0: 5, y0: 5, x1: 5, y1: 9 }], { pad: 0 });
  assert.equal(r.masked, 1);
  assert.deepEqual(c.fills[0], { x0: 0, y0: 0, x1: 30, y1: 30 });
  assert.deepEqual(clampBox({ x0: 1, y0: 1, x1: 2, y1: 2 }, 100, 100, 5), { x0: 0, y0: 0, x1: 7, y1: 7 });
});
