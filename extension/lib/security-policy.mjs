// The one decision point for everything that leaves the browser.
//   classifyPayload(payload, ctx) -> {
//     decision:       "ALLOW" | "SANITIZE" | "BLOCK" | "REQUIRE_APPROVAL"
//     classification: "PUBLIC" | "PERSONAL" | "SENSITIVE" | "SECRET"
//     findings:       [{ type, subtype, category?, confidence, risk, action, path, evidence }]  (evidence masked)
//     sanitized:      copy of payload with offending text replaced
//     reasons:        string[]  (never contain raw values)
//   }
// ctx: { vault?, canaries?, destinationTrust? (0..1), minPiiConfidence? }
//
// Precedence, most severe first:
//   canary                              -> BLOCK
//   secret with action "block"          -> BLOCK
//   restricted PII / restricted token   -> BLOCK
//   secret needing approval             -> REQUIRE_APPROVAL
//   low-trust destination + personal    -> REQUIRE_APPROVAL
//   other PII / known profile value     -> SANITIZE
//   nothing                             -> ALLOW

import { detectPII } from "./pii-rules.mjs";
import { scanSecrets, maskSecret } from "./secret-scanner.mjs";
import { findCanaries } from "./canary.mjs";
import { isRestrictedCategory } from "./sensitive-fields.mjs";
import { Vault } from "./tokenizer.mjs";
import { sanitizeText } from "./dlp-sanitizer.mjs";
import { walkStrings, mapStrings } from "./payload-walk.mjs";

const TOKEN_RE = /\[[A-Z0-9]+_\d+\]/g;
const LOW_TRUST = 0.6;
const RANK = { ALLOW: 0, SANITIZE: 1, REQUIRE_APPROVAL: 2, BLOCK: 3 };

export function classifyPayload(payload, ctx = {}) {
  const { vault = null, canaries = [], destinationTrust = 1, minPiiConfidence = 0.5 } = ctx;
  const findings = [];

  for (const c of findCanaries(payload, canaries)) {
    findings.push({ type: "canary", subtype: "canary", confidence: 1, risk: "critical", action: "block", path: c.path, evidence: maskSecret(c.canary) });
  }

  for (const { path, value } of walkStrings(payload)) {
    for (const s of scanSecrets(value)) {
      findings.push({ type: "secret", subtype: s.subtype, confidence: s.confidence, risk: s.action === "block" ? "critical" : "high", action: s.action, path, evidence: s.evidence });
    }
    for (const h of detectPII(value, { minConfidence: minPiiConfidence })) {
      const restricted = isRestrictedCategory(h.category);
      findings.push({ type: "pii", subtype: h.category, category: h.category, confidence: h.confidence, risk: restricted ? "high" : "medium", action: restricted ? "block" : "sanitize", path, evidence: maskSecret(h.value) });
    }
    if (vault) {
      const before = new Map();
      for (const t of value.match(TOKEN_RE) || []) before.set(t, (before.get(t) || 0) + 1);
      const redacted = vault.redactText(value);
      if (redacted !== value) {
        const after = new Map();
        for (const t of redacted.match(TOKEN_RE) || []) after.set(t, (after.get(t) || 0) + 1);
        for (const [token, n] of after) {
          if (n <= (before.get(token) || 0)) continue;
          const category = vault.categoryOf(token);
          const restricted = isRestrictedCategory(category);
          findings.push({ type: "profile-value", subtype: category, category, confidence: 1, risk: restricted ? "high" : "medium", action: restricted ? "block" : "sanitize", path, evidence: token });
        }
      }
    }
  }

  const has = (pred) => findings.some(pred);
  let decision = "ALLOW";
  const raise = (d) => { if (RANK[d] > RANK[decision]) decision = d; };
  if (has((f) => f.type === "canary")) raise("BLOCK");
  if (has((f) => f.action === "block")) raise("BLOCK");
  if (has((f) => f.action === "require_approval")) raise("REQUIRE_APPROVAL");
  if (destinationTrust < LOW_TRUST && has((f) => f.type === "pii" || f.type === "profile-value" || f.type === "secret")) raise("REQUIRE_APPROVAL");
  if (has((f) => f.action === "sanitize")) raise("SANITIZE");

  const classification = has((f) => f.type === "secret" || f.type === "canary") ? "SECRET"
    : has((f) => f.action === "block") ? "SENSITIVE"
    : findings.length ? "PERSONAL" : "PUBLIC";

  const scratch = vault ?? new Vault();
  const sanitized = findings.length ? mapStrings(payload, (s) => sanitizeText(s, scratch, { source: "egress", minConfidence: minPiiConfidence }).text) : payload;

  const reasons = [...new Set(findings.map((f) => `${f.type}:${f.subtype} at ${f.path || "(root)"}`))];
  return { decision, classification, findings, sanitized, reasons };
}

export default { classifyPayload };
