// Fuse detection boxes from several sources (DOM, OCR, vision) into one list.
// Box: { x0, y0, x1, y1, category, confidence, sources: string[], fieldId? }

const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

export function intersection(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a, b) {
  const inter = intersection(a, b);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** Share of the smaller box that lies inside the other (1 = fully contained). */
export function containment(a, b) {
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? intersection(a, b) / smaller : 0;
}

function combine(group) {
  const best = group.reduce((m, b) => (b.confidence > m.confidence ? b : m));
  const miss = group.reduce((p, b) => p * (1 - Math.min(0.99, b.confidence)), 1);
  return {
    x0: Math.min(...group.map((b) => b.x0)), y0: Math.min(...group.map((b) => b.y0)),
    x1: Math.max(...group.map((b) => b.x1)), y1: Math.max(...group.map((b) => b.y1)),
    category: best.category,
    confidence: Math.round((1 - miss) * 100) / 100,
    sources: [...new Set(group.flatMap((b) => b.sources || []))],
    ...(group.find((b) => b.fieldId) ? { fieldId: group.find((b) => b.fieldId).fieldId } : {}),
  };
}

/** lists: array of box arrays. Boxes that overlap enough (IoU or containment) are merged. */
export function mergeDetections(lists, { iouThreshold = 0.3, containThreshold = 0.8 } = {}) {
  const boxes = lists.flat().filter((b) => b && area(b) > 0).map((b) => ({ ...b, sources: b.sources || [] }));
  const groups = [];
  for (const box of boxes) {
    const hits = groups.filter((g) => g.some((m) => iou(m, box) >= iouThreshold || containment(m, box) >= containThreshold));
    if (!hits.length) { groups.push([box]); continue; }
    // the new box may bridge several existing groups
    const merged = [box, ...hits.flat()];
    for (const g of hits) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  return groups.map(combine).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** How many fused boxes were seen by more than one source. */
export function redundancyStats(lists, opts) {
  const fused = mergeDetections(lists, opts);
  const multi = fused.filter((b) => b.sources.length > 1).length;
  return { total: fused.length, multiSource: multi, ratio: fused.length ? multi / fused.length : 0 };
}

export default { iou, containment, intersection, mergeDetections, redundancyStats };
