// Defences against hostile pages. All functions are pure and DOM-free: the page
// script gathers text and style descriptors; this module judges them.
//   detectPromptInjection(text)     -> [{ pattern, severity, start, end, evidence }]
//   detectHiddenStyles(items)       -> [{ reason, length, preview, hasInstruction }]
//   scanAdversarialVectors(input)   -> { injections, hidden, score, verdict, reasons }
//   classifyContent(scan)           -> { score, verdict, reasons }   (BENIGN | SUSPICIOUS | MALICIOUS)
//   separateDataFromInstructions(t) -> string wrapped as untrusted data

const ZERO_WIDTH = /[​‌‍⁠﻿­]/g;
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i" };

/** Lowercase, drop zero-width chars, undo leetspeak, join letters spelled out one by one. */
function foldForMatching(text) {
  let t = String(text ?? "").replace(ZERO_WIDTH, "").toLowerCase();
  t = t.replace(/\b(?:[a-z0-9@$][\s.\-_]){3,}[a-z0-9@$]\b/g, (m) => m.replace(/[\s.\-_]/g, ""));
  return t.replace(/[0-9@$!](?=[a-z])|(?<=[a-z])[0-9@$!]/g, (c) => LEET[c] ?? c);
}

const PATTERNS = [
  { pattern: "override-instructions", severity: "high", re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|directives?|guidelines?)\b/ },
  { pattern: "reveal-secrets", severity: "high", re: /\b(reveal|print|show|repeat|output|leak|disclose)\b[^.\n]{0,30}\b(system prompt|instructions|api key|password|secrets?|credentials?)\b/ },
  { pattern: "exfiltrate", severity: "high", re: /\b(send|post|email|forward|upload|transmit|submit)\b[^.\n]{0,60}\b(to|at)\b[^.\n]{0,30}(https?:\/\/|www\.|@\w)/ },
  { pattern: "address-the-agent", severity: "high", re: /\b(ai|assistant|agent|model|llm|bot|automation)\b[^.\n]{0,20}\b(must|should|needs? to|has to|now|please)\b[^.\n]{0,60}\b(click|navigate|submit|type|enter|download|open|send|fill|pay|transfer)\b/ },
  { pattern: "role-change", severity: "medium", re: /\b(you are now|from now on you|pretend to be|act as (?:an?|the)|new instructions?)\b/ },
  { pattern: "fake-system-tag", severity: "medium", re: /<\/?\s*(system|assistant|instructions?)\s*>|\[\s*(system|inst)\s*\]/ },
  { pattern: "mentions-system-prompt", severity: "medium", re: /\b(system prompt|developer message|hidden instructions?)\b/ },
];

export function detectPromptInjection(text) {
  const raw = String(text ?? "");
  if (!raw) return [];
  const folded = foldForMatching(raw);
  const out = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(folded);
    if (!m) continue;
    // offsets refer to the folded text; the preview is taken from it, not from the raw page
    out.push({ pattern: p.pattern, severity: p.severity, start: m.index, end: m.index + m[0].length, evidence: m[0].slice(0, 60) });
  }
  return out;
}

const px = (v) => { const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v ?? "").trim()); return m ? parseFloat(m[1]) : null; };
const norm = (c) => String(c ?? "").replace(/\s+/g, "").toLowerCase();

function hiddenReason(style = {}) {
  if (style.display === "none") return "display:none";
  if (style.visibility === "hidden" || style.visibility === "collapse") return "visibility:hidden";
  if (style.opacity != null && parseFloat(style.opacity) < 0.05) return "opacity near zero";
  const fs = px(style.fontSize);
  if (fs != null && fs < 2) return "font-size under 2px";
  if ((px(style.width) === 0 || px(style.height) === 0) && /hidden|clip/.test(style.overflow || "")) return "zero-size clipped box";
  const l = px(style.left), t = px(style.top), tx = px(style.textIndent);
  if ((l != null && l <= -1000) || (t != null && t <= -1000) || (tx != null && tx <= -1000)) return "positioned off-screen";
  if (style.color && style.backgroundColor && norm(style.color) === norm(style.backgroundColor)) return "text colour equals background";
  return null;
}

/** items: [{ text, style }]. Short or empty text is ignored. */
export function detectHiddenStyles(items = []) {
  const out = [];
  for (const it of items) {
    const text = String(it?.text ?? "").trim();
    if (text.length < 8) continue;
    const reason = hiddenReason(it.style);
    if (!reason) continue;
    out.push({ reason, length: text.length, preview: text.slice(0, 40), hasInstruction: detectPromptInjection(text).length > 0 });
  }
  return out;
}

export function classifyContent(scan = {}) {
  const injections = scan.injections || [];
  const hidden = scan.hidden || [];
  let score = 0;
  const reasons = [];
  for (const i of injections) { score += i.severity === "high" ? 3 : 1; reasons.push(`${i.severity} injection pattern: ${i.pattern}${i.source ? ` (${i.source})` : ""}`); }
  for (const h of hidden) {
    score += h.hasInstruction ? 3 : 0;
    reasons.push(h.hasInstruction ? `hidden text carries instructions (${h.reason})` : `hidden text (${h.reason})`);
  }
  const anyHigh = injections.some((i) => i.severity === "high") || hidden.some((h) => h.hasInstruction);
  const verdict = anyHigh ? "MALICIOUS" : score >= 2 ? "SUSPICIOUS" : "BENIGN";
  return { score, verdict, reasons };
}

/** input: { text, hidden: [{text, style}], attributes: [string] (alt/title/aria text) } */
export function scanAdversarialVectors(input = {}) {
  const injections = [];
  for (const i of detectPromptInjection(input.text)) injections.push({ ...i, source: "visible text" });
  for (const a of input.attributes || []) for (const i of detectPromptInjection(a)) injections.push({ ...i, source: "attribute" });
  const hidden = detectHiddenStyles(input.hidden || []);
  const { score, verdict, reasons } = classifyContent({ injections, hidden });
  return { injections, hidden, score, verdict, reasons };
}

const OPEN = "<untrusted_page_data>";
const CLOSE = "</untrusted_page_data>";

/** Wrap page-derived text so the model treats it as data. Delimiters inside the text are defused. */
export function separateDataFromInstructions(text, { maxChars = 8000 } = {}) {
  const body = String(text ?? "").slice(0, maxChars).replace(/<(\/?)\s*untrusted_page_data/gi, "&lt;$1untrusted_page_data");
  return `${OPEN}\n${body}\n${CLOSE}`;
}

export default { detectPromptInjection, detectHiddenStyles, classifyContent, scanAdversarialVectors, separateDataFromInstructions };
