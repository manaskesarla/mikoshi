import { test } from "node:test";
import assert from "node:assert/strict";
import { processVision } from "../extension/lib/vision-pipeline.mjs";
import { verifyRedaction } from "../extension/lib/redaction-verify.mjs";
import { Vault } from "../extension/lib/tokenizer.mjs";
import { verhoeffCheckDigit } from "../extension/lib/pii-checksums.mjs";

const p = "23456789012";
const AADHAAR = p + verhoeffCheckDigit(p);

// Fakes: a "screen" of text lines; painted rectangles hide the characters beneath them.
const line = (text, y = 10) => ({ text, bbox: { x0: 0, y0: y, x1: text.length * 10, y1: y + 20 } });
function fakes(lines, { width = 800, height = 300 } = {}) {
  const made = [];
  const createCanvas = (w, h) => { const fills = []; const c = { width: w, height: h, fills, lines, getContext: () => ({ drawImage() {}, set fillStyle(_) {}, fillRect: (x, y, ww, hh) => fills.push({ x0: x, y0: y, x1: x + ww, y1: y + hh }) }), toDataURL: (type) => `data:${type};base64,FAKE` }; made.push(c); return c; };
  const loadImage = async () => ({ width, height });
  const ocr = async (canvas) => canvas.lines.map((l) => {
    const cw = (l.bbox.x1 - l.bbox.x0) / l.text.length;
    const text = [...l.text].map((ch, i) => { const cx = l.bbox.x0 + cw * (i + 0.5), cy = (l.bbox.y0 + l.bbox.y1) / 2; return canvas.fills.some((f) => cx >= f.x0 && cx <= f.x1 && cy >= f.y0 && cy <= f.y1) ? " " : ch; }).join("");
    return { text, bbox: l.bbox };
  });
  return { createCanvas, loadImage, ocr, made };
}
const run = (lines, extra = {}) => { const f = fakes(lines); return processVision({ image: "data:image/png;base64,AAAA", viewport: { w: 800 }, ocr: f.ocr, createCanvas: f.createCanvas, loadImage: f.loadImage, ...extra }).then((r) => ({ ...r, f })); };

test("personal data in the screenshot is blacked out, rechecked and returned as a JPEG", async () => {
  const r = await run([line("Welcome to the portal"), line(`Aadhaar: ${AADHAAR}`, 50), line("write to asha@example.com", 90)]);
  assert.equal(r.verify.ok, true);
  assert.match(r.image, /^data:image\/jpeg/);
  assert.ok(r.stats.boxes >= 2);
  const covered = (y) => r.f.made[0].fills.some((f) => f.y0 <= y + 10 && f.y1 >= y + 10);
  assert.ok(covered(50) && covered(90) && !covered(10));
});

test("a field the page marked sensitive is masked even when OCR sees nothing there", async () => {
  const r = await run([line("Name:")], { domBoxes: [{ x: 100, y: 100, w: 200, h: 30, category: "aadhaar" }] });
  assert.ok(r.f.made[0].fills.some((f) => f.x0 <= 100 && f.x1 >= 300 && f.y0 <= 100 && f.y1 >= 130));
});

test("DOM boxes are scaled from CSS pixels to image pixels", async () => {
  const f = fakes([], { width: 1600, height: 600 });
  await processVision({ image: "x", viewport: { w: 800 }, domBoxes: [{ x: 100, y: 50, w: 100, h: 20 }], ocr: f.ocr, createCanvas: f.createCanvas, loadImage: f.loadImage });
  const fill = f.made[0].fills[0];
  assert.ok(fill.x0 <= 200 && fill.x1 >= 400 && fill.y0 <= 100 && fill.y1 >= 140);
});

test("values the vault knows are masked even if no pattern matches them", async () => {
  const r = await run([line("Dear Asha Rao, your form", 30)], { known: [{ value: "Asha Rao", category: "full name" }] });
  assert.equal(r.verify.ok, true);
  assert.ok(r.f.made[0].fills.length >= 1);
});

test("fails closed: unrecognised leak that masking cannot fix, OCR crash, undecodable image", async () => {
  const f = fakes([line(`Aadhaar ${AADHAAR}`)]);
  const stubborn = await processVision({ image: "x", viewport: { w: 800 }, ocr: async () => [line(`Aadhaar ${AADHAAR}`)], createCanvas: f.createCanvas, loadImage: f.loadImage });
  assert.deepEqual([stubborn.image, stubborn.verify.ok, stubborn.verify.reason], [null, false, "REDACTION_FAILED"]);
  const crash = await processVision({ image: "x", ocr: async () => { throw new Error("boom"); }, createCanvas: f.createCanvas, loadImage: f.loadImage });
  assert.deepEqual([crash.image, crash.verify.reason], [null, "OCR_FAILED"]);
  const bad = await processVision({ image: "x", ocr: f.ocr, createCanvas: f.createCanvas, loadImage: async () => { throw new Error("decode"); } });
  assert.deepEqual([bad.image, bad.verify.reason], [null, "OCR_FAILED"]);
});

test("the result never contains recognised text", async () => {
  const r = await run([line(`Aadhaar: ${AADHAAR}`)]);
  assert.ok(!JSON.stringify({ v: r.verify, s: r.stats }).includes(AADHAAR));
});

test("verifyRedaction: extra detectors can force masking", async () => {
  const f = fakes([line("secret nickname Tiger")]);
  const canvas = f.createCanvas(800, 300);
  const extra = (ls) => ls.filter((l) => /Tiger/.test(l.text)).map((l) => ({ category: "known value", box: l.bbox }));
  const r = await verifyRedaction({ canvas, ocr: f.ocr, extraDetect: extra });
  assert.equal(r.ok, true);
  assert.equal(r.passes, 2);
});

test("Vault.knownValues lists values for local use; exportContext still hides them", () => {
  const v = new Vault();
  v.add("ABCPE1234F", "pan");
  assert.deepEqual(v.knownValues(), [{ value: "ABCPE1234F", category: "pan" }]);
  assert.ok(!JSON.stringify(v.exportContext()).includes("ABCPE1234F"));
});
