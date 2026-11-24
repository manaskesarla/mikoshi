// Field-level decision: what is this control, and must it be censored?
//   classifyFieldHeuristics({ signals, value }) ->
//     { category, confidence, restricted, sensitive, censor, reason }
// A restricted PII value or a secret inside ANY field forces `censor`, whatever the label says.
// `censor` means: hide the value from screenshots/skeletons regardless of what a
// text detector sees. Values stay local; they are only used to classify.

import { classifySignals } from "./field-classifier.mjs";
import { detectPII } from "./pii-rules.mjs";
import { scanSecrets } from "./secret-scanner.mjs";
import { canonicalCategory, isRestrictedCategory, isSensitiveCategory } from "./sensitive-fields.mjs";

export function classifyFieldHeuristics({ signals = {}, value = "" } = {}) {
  const byMarkup = classifySignals(signals);
  let category = byMarkup.category;
  let confidence = byMarkup.confidence;
  let reason = byMarkup.reason;
  let valueRestricted = false;

  const v = String(value ?? "");
  if (v) {
    const hits = detectPII(v, { minConfidence: 0.7 });
    if (hits.some((h) => isRestrictedCategory(h.category))) valueRestricted = true;
    if (hits.length) {
      const best = hits.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      // value-based evidence beats a weak or missing markup guess
      if (!category || confidence < best.confidence) {
        category = canonicalCategory(best.category);
        confidence = best.confidence;
        reason = "value matches a PII pattern";
      }
    }
    if (scanSecrets(v).length) valueRestricted = true;
    if (scanSecrets(v).length && !category) {
      category = "password";
      confidence = 0.8;
      reason = "value looks like a secret";
    }
  }

  const cat = canonicalCategory(category);
  const restricted = cat ? isRestrictedCategory(cat) : false;
  const sensitive = cat ? isSensitiveCategory(cat) : false;
  const hiddenInput = String(signals.type || "").toLowerCase() === "password";
  return { category: cat, confidence, restricted, sensitive, censor: restricted || hiddenInput || valueRestricted, reason };
}

export default { classifyFieldHeuristics };
