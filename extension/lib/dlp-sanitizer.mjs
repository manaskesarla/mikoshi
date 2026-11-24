// Sanitizers: turn text and page skeletons into a form that is safe to send.
//   sanitizeText(text, vault, opts)      -> { text, hits: [{ category, token }], secrets }
//   sanitizeTaskGoal(goal, vault)        -> same, for the user's free-form task text
//   sanitizeSkeleton(skeleton, vault)    -> { skeleton, counts }  (new object; input untouched)
// Secrets are replaced by a fixed marker and are NEVER stored in the vault.

import { detectPII } from "./pii-rules.mjs";
import { scanSecrets } from "./secret-scanner.mjs";

export const SECRET_MARKER = "[REDACTED_SECRET]";
const STRING_FIELDS = ["label", "name", "text", "placeholder", "title", "href", "formOrigin"];
const DROP_FIELDS = ["value", "rawValue", "currentValue"];

export function sanitizeText(input, vault, opts = {}) {
  const { source = "screen", minConfidence = 0.5 } = opts;
  let text = String(input ?? "");
  if (!text) return { text, hits: [], secrets: 0 };

  // 1. secrets first, from the right, so offsets stay valid
  const secrets = scanSecrets(text);
  for (const s of [...secrets].sort((a, b) => b.start - a.start)) text = text.slice(0, s.start) + SECRET_MARKER + text.slice(s.end);

  // 2. values the vault already knows
  text = vault.redactText(text);

  // 3. anything newly detected becomes a token
  const hits = [];
  const found = detectPII(text, { minConfidence });
  for (const h of [...found].sort((a, b) => b.start - a.start)) {
    const token = vault.add(h.value, h.category, source);
    if (!token) continue;
    text = text.slice(0, h.start) + token + text.slice(h.end);
    hits.unshift({ category: h.category, token });
  }
  return { text, hits, secrets: secrets.length };
}

export const sanitizeTaskGoal = (goal, vault) => sanitizeText(goal, vault, { source: "goal", minConfidence: 0.5 });

export function sanitizeSkeleton(skeleton, vault, opts = {}) {
  const counts = {};
  const bump = (res) => { for (const h of res.hits) counts[h.category] = (counts[h.category] || 0) + 1; if (res.secrets) counts.secret = (counts.secret || 0) + res.secrets; };
  const clean = (v) => { const r = sanitizeText(v, vault, opts); bump(r); return r.text; };

  const out = { ...skeleton };
  for (const f of ["url", "title"]) if (typeof out[f] === "string") out[f] = clean(out[f]);
  out.nodes = (skeleton?.nodes || []).map((node) => {
    const n = { ...node };
    for (const f of DROP_FIELDS) delete n[f];
    for (const f of STRING_FIELDS) if (typeof n[f] === "string") n[f] = clean(n[f]);
    if (Array.isArray(n.options)) n.options = n.options.map((o) => ({ ...o, text: typeof o.text === "string" ? clean(o.text) : o.text, label: typeof o.label === "string" ? clean(o.label) : o.label }));
    return n;
  });
  return { skeleton: out, counts };
}

export default { sanitizeText, sanitizeTaskGoal, sanitizeSkeleton, SECRET_MARKER };
