// Find the human-readable label for a form control.
//   collectLabelCandidates(el) -> [{ source, text }]   (touches the DOM; browser only)
//   pickLabel(candidates)      -> { label, source }    (pure)
//   labelFor(el)               -> { label, source }
// Priority: aria-labelledby > aria-label > <label for> / el.labels > wrapping <label>
//           > preceding text > placeholder > title > name/id.

const PRIORITY = ["aria-labelledby", "aria-label", "label-for", "wrapping-label", "preceding-text", "placeholder", "title", "name"];
const clean = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

export function pickLabel(candidates = []) {
  const usable = candidates.map((c) => ({ source: c.source, text: clean(c.text) })).filter((c) => c.text);
  for (const source of PRIORITY) {
    const hit = usable.find((c) => c.source === source);
    if (hit) return { label: hit.text, source };
  }
  return { label: "", source: "none" };
}

export function collectLabelCandidates(el) {
  const out = [];
  if (!el || typeof el.getAttribute !== "function") return out;
  const doc = el.ownerDocument;

  const by = el.getAttribute("aria-labelledby");
  if (by && doc?.getElementById) {
    const text = by.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? "").join(" ");
    out.push({ source: "aria-labelledby", text });
  }
  const aria = el.getAttribute("aria-label");
  if (aria) out.push({ source: "aria-label", text: aria });

  if (el.labels && el.labels.length) {
    out.push({ source: "label-for", text: [...el.labels].map((l) => l.textContent).join(" ") });
  } else if (el.id && doc?.querySelector) {
    const l = doc.querySelector(`label[for="${String(el.id).replace(/"/g, '\\"')}"]`);
    if (l) out.push({ source: "label-for", text: l.textContent });
  }

  const wrap = typeof el.closest === "function" ? el.closest("label") : null;
  if (wrap) out.push({ source: "wrapping-label", text: wrap.textContent });

  const prev = el.previousElementSibling;
  if (prev && prev.textContent && prev.textContent.length <= 80) out.push({ source: "preceding-text", text: prev.textContent });

  const ph = el.getAttribute("placeholder");
  if (ph) out.push({ source: "placeholder", text: ph });
  const title = el.getAttribute("title");
  if (title) out.push({ source: "title", text: title });
  const name = el.getAttribute("name") || el.id;
  if (name) out.push({ source: "name", text: name });
  return out;
}

export const labelFor = (el) => pickLabel(collectLabelCandidates(el));

export default { pickLabel, collectLabelCandidates, labelFor };
