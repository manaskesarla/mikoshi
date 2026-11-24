// Draw solid black boxes over regions. Works on anything with getContext("2d").

export function clampBox(b, width, height, pad = 0) {
  return {
    x0: Math.max(0, Math.floor(b.x0 - pad)), y0: Math.max(0, Math.floor(b.y0 - pad)),
    x1: Math.min(width, Math.ceil(b.x1 + pad)), y1: Math.min(height, Math.ceil(b.y1 + pad)),
  };
}

/** Paints every box black. Returns { masked, area } for the boxes actually painted. */
export function redactCanvas(canvas, boxes, { pad = 2, color = "#000" } = {}) {
  const ctx = canvas.getContext("2d");
  let masked = 0;
  let area = 0;
  ctx.fillStyle = color;
  for (const b of boxes || []) {
    const c = clampBox(b, canvas.width, canvas.height, pad);
    const w = c.x1 - c.x0;
    const h = c.y1 - c.y0;
    if (w <= 0 || h <= 0) continue;
    ctx.fillRect(c.x0, c.y0, w, h);
    masked++;
    area += w * h;
  }
  return { masked, area };
}

export default { clampBox, redactCanvas };
