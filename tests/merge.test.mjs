import { test } from "node:test";
import assert from "node:assert/strict";
import { iou, containment, mergeDetections, redundancyStats } from "../extension/lib/merge.mjs";

const box = (x0, y0, x1, y1, o = {}) => ({ x0, y0, x1, y1, category: "pan", confidence: 0.8, sources: ["ocr"], ...o });

test("iou and containment", () => {
  assert.equal(iou(box(0, 0, 10, 10), box(0, 0, 10, 10)), 1);
  assert.equal(iou(box(0, 0, 10, 10), box(20, 20, 30, 30)), 0);
  assert.equal(iou(box(0, 0, 10, 10), box(5, 0, 15, 10)), 50 / 150);
  assert.equal(containment(box(0, 0, 100, 100), box(10, 10, 20, 20)), 1);
});

test("overlapping boxes from different sources fuse into one, with both sources", () => {
  const out = mergeDetections([[box(0, 0, 100, 20, { sources: ["ocr"] })], [box(5, 2, 98, 18, { sources: ["dom"], confidence: 0.9, fieldId: "n3" })]]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].sources.sort(), ["dom", "ocr"]);
  assert.equal(out[0].fieldId, "n3");
  assert.ok(out[0].confidence > 0.9 && out[0].confidence < 1);
  assert.deepEqual([out[0].x0, out[0].y0, out[0].x1, out[0].y1], [0, 0, 100, 20]);
});

test("separate boxes stay separate and come back in reading order", () => {
  const out = mergeDetections([[box(0, 50, 10, 60)], [box(0, 0, 10, 10)]]);
  assert.deepEqual(out.map((b) => b.y0), [0, 50]);
});

test("a box that bridges two groups merges all three", () => {
  const out = mergeDetections([[box(0, 0, 40, 10), box(60, 0, 100, 10)], [box(20, 0, 80, 10)]], { iouThreshold: 0.2 });
  assert.equal(out.length, 1);
});

test("empty and degenerate input", () => {
  assert.deepEqual(mergeDetections([]), []);
  assert.deepEqual(mergeDetections([[box(5, 5, 5, 20)], [null]]), []);
});

test("redundancy stats", () => {
  const s = redundancyStats([[box(0, 0, 10, 10, { sources: ["ocr"] }), box(50, 50, 60, 60)], [box(0, 0, 10, 10, { sources: ["dom"] })]]);
  assert.deepEqual(s, { total: 2, multiSource: 1, ratio: 0.5 });
});
