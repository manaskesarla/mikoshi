// Secret / credential scanner: vendor token formats + entropy + nearby context.
// Evidence is always masked; raw secret text is never placed in a finding.

export function shannonEntropy(s) {
  const str = String(s ?? "");
  if (!str) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / str.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Reveal only a short prefix and the length. Never the tail. */
export function maskSecret(s) {
  const str = String(s ?? "");
  return `${str.slice(0, 4)}…[${str.length} chars]`;
}

// action: what a policy engine should do on its own — "block" or "require_approval".
const PATTERNS = [
  { subtype: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, confidence: 0.95, action: "block" },
  { subtype: "gcp-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, confidence: 0.95, action: "block" },
  { subtype: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g, confidence: 0.97, action: "block" },
  { subtype: "gitlab-token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, confidence: 0.95, action: "block" },
  { subtype: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, confidence: 0.95, action: "block" },
  { subtype: "stripe-key", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, confidence: 0.95, action: "block" },
  { subtype: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, confidence: 0.85, action: "block" },
  { subtype: "sendgrid-key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, confidence: 0.95, action: "block" },
  { subtype: "twilio-key", re: /\bSK[0-9a-f]{32}\b/g, confidence: 0.8, action: "block" },
  { subtype: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/g, confidence: 0.95, action: "block" },
  { subtype: "private-key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g, confidence: 0.99, action: "block" },
  { subtype: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, confidence: 0.9, action: "block" },
  { subtype: "db-connection-string", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/g, confidence: 0.95, action: "block" },
  { subtype: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, confidence: 0.85, action: "block" },
];

// key = value assignments: reported only when the value looks random.
const ASSIGNMENT = /(api[_-]?key|secret|token|passwd|password|pwd|auth)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-/+=.]{16,})/gi;
const MIN_ENTROPY = 3.6;

export function scanSecrets(input, opts = {}) {
  const { minConfidence = 0.5 } = opts;
  const text = String(input ?? "");
  if (!text) return [];
  const found = [];

  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      found.push({ type: "secret", subtype: p.subtype, start: m.index, end: m.index + m[0].length, confidence: p.confidence, action: p.action, evidence: maskSecret(m[0]) });
    }
  }
  for (const m of text.matchAll(ASSIGNMENT)) {
    const value = m[2];
    if (shannonEntropy(value) < MIN_ENTROPY) continue;
    const start = m.index + m[0].length - value.length;
    found.push({ type: "secret", subtype: "generic-secret", start, end: start + value.length, confidence: 0.7, action: "require_approval", evidence: maskSecret(value) });
  }

  // drop overlaps, preferring higher confidence
  found.sort((a, b) => b.confidence - a.confidence || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const f of found) {
    if (f.confidence < minConfidence) continue;
    if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export default { scanSecrets, shannonEntropy, maskSecret };
