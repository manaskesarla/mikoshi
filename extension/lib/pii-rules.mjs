// PII detection engine.
//   normalize(text)  -> { text, map }   fold look-alike characters, keep offsets
//   detectPII(text)  -> [{ category, start, end, value, confidence, source }]
// start/end are offsets into the ORIGINAL text.

import { verhoeffValid, luhnValid, cardIinOk, ibanValid } from "./pii-checksums.mjs";
import { CONTEXT, NEGATIVE_CONTEXT, REGEX_RULES } from "./pii-config.mjs";

// ---- normalization ---------------------------------------------------------
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);
const DASHES = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212]);
// Code points of the digit "0" in common non-ASCII decimal blocks.
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10];

function foldChar(ch) {
  const cp = ch.codePointAt(0);
  if (ZERO_WIDTH.has(cp)) return "";
  if (DASHES.has(cp)) return "-";
  if (cp === 0x00a0 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x3000) return " ";
  for (const z of DIGIT_ZEROS) if (cp >= z && cp <= z + 9) return String(cp - z);
  if (cp >= 0xff01 && cp <= 0xff5e) return String.fromCodePoint(cp - 0xfee0); // fullwidth ASCII
  return ch;
}

/** Returns normalized text plus `map[i] = [origStart, origEnd)` for each normalized char. */
export function normalize(input) {
  const src = String(input ?? "");
  let out = "";
  const map = [];
  let i = 0;
  for (const ch of src) {
    const folded = foldChar(ch);
    for (const f of folded) map.push([i, i + ch.length]);
    out += folded;
    i += ch.length;
  }
  return { text: out, map };
}

// ---- context helpers -------------------------------------------------------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
function compileKeywords(list) {
  return list.map((k) => (/^[\x00-\x7f]+$/.test(k) ? new RegExp(`(?<![a-z0-9])${esc(k)}(?![a-z0-9])`, "i") : new RegExp(esc(k), "i")));
}
const CTX_RE = Object.fromEntries(Object.entries(CONTEXT).map(([k, v]) => [k, compileKeywords(v)]));
const NEG_RE = compileKeywords(NEGATIVE_CONTEXT);

function near(text, start, end, regexes, window = 40) {
  const seg = text.slice(Math.max(0, start - window), Math.min(text.length, end + window));
  return regexes.some((r) => r.test(seg));
}
const hasCtx = (t, s, e, cat) => near(t, s, e, CTX_RE[cat] || []);
const hasNeg = (t, s, e) => near(t, s, e, NEG_RE, 30);

// ---- digit-run classification ---------------------------------------------
const RUN_RE = /(?<![\d])\+?\d(?:[ -]?\d){5,}(?!\d)/g;
const MAX_GROUPS = 10;

function classifyDigits(compact, hasPlus, groups, t, s, e) {
  const found = [];
  const neg = hasNeg(t, s, e);
  const n = compact.length;

  if (n === 12 && /^[2-9]/.test(compact) && verhoeffValid(compact)) {
    let c = 0.55;
    if (hasCtx(t, s, e, "aadhaar")) c += 0.4;
    if (groups.length === 3 && groups.every((g) => g.length === 4)) c += 0.25;
    if (neg) c -= 0.3;
    found.push({ category: "aadhaar", confidence: c, source: "checksum" });
  }
  if (n >= 13 && n <= 19 && luhnValid(compact) && cardIinOk(compact)) {
    let c = 0.8;
    if (hasCtx(t, s, e, "credit-card")) c += 0.15;
    if (neg) c -= 0.2;
    found.push({ category: "credit-card", confidence: c, source: "checksum" });
  }
  const phone = /^(?:(91)|0)?([6-9]\d{9})$/.exec(compact);
  if (phone) {
    let c = 0.55;
    if (phone[1] || hasPlus) c = 0.75;
    if (hasPlus && phone[1]) c = 0.85;
    if (hasCtx(t, s, e, "phone-in")) c += 0.3;
    if (neg) c -= 0.3;
    found.push({ category: "phone-in", confidence: c, source: "regex" });
  }
  if (n >= 9 && n <= 18 && hasCtx(t, s, e, "bank account information")) {
    found.push({ category: "bank account information", confidence: neg ? 0.5 : 0.8, source: "context" });
  }
  return found;
}

function detectDigitRuns(t) {
  const out = [];
  for (const m of t.matchAll(RUN_RE)) {
    const runStart = m.index;
    // split into digit groups, remembering where each group sits in the text
    const groups = [];
    for (const g of m[0].matchAll(/\d+/g)) groups.push({ text: g[0], start: runStart + g.index, end: runStart + g.index + g[0].length });
    const limit = Math.min(groups.length, MAX_GROUPS);
    for (let i = 0; i < limit; i++) {
      for (let j = i; j < limit; j++) {
        const slice = groups.slice(i, j + 1);
        const compact = slice.map((g) => g.text).join("");
        if (compact.length < 9 || compact.length > 19) continue;
        const s = slice[0].start;
        const e = slice[slice.length - 1].end;
        const hasPlus = i === 0 && m[0][0] === "+";
        const start = hasPlus ? runStart : s;
        for (const f of classifyDigits(compact, hasPlus, slice.map((g) => g.text), t, start, e)) out.push({ ...f, start, end: e });
      }
    }
  }
  return out;
}

// ---- regex rules -----------------------------------------------------------
function detectRegex(t) {
  const out = [];
  for (const rule of REGEX_RULES) {
    for (const m of t.matchAll(rule.re)) {
      const s = m.index;
      const e = s + m[0].length;
      let c = rule.base;
      if (rule.checksum === "iban") {
        if (!ibanValid(m[0])) continue;
        c = rule.validBase;
      } else if (rule.validate) {
        if (rule.validate(m[0])) c = rule.validBase ?? c;
      }
      if (rule.ctxBoost) {
        if (hasCtx(t, s, e, rule.category)) c += rule.ctxBoost;
        else if (hasNeg(t, s, e)) c -= 0.45; // "Invoice AAAPA1234A": shaped like a PAN, but labelled as something else
      }
      out.push({ category: rule.category, start: s, end: e, confidence: c, source: "regex" });
    }
  }
  return out;
}

// ---- public API ------------------------------------------------------------
export function detectPII(input, opts = {}) {
  const { minConfidence = 0.5, categories = null } = opts;
  const original = String(input ?? "");
  if (!original) return [];
  const { text: t, map } = normalize(original);
  let cands = [...detectDigitRuns(t), ...detectRegex(t)]
    .map((c) => ({ ...c, confidence: Math.min(0.99, Math.round(c.confidence * 100) / 100) }))
    .filter((c) => c.confidence >= minConfidence && (!categories || categories.includes(c.category)));

  // greedy non-overlapping selection: highest confidence, then longest
  cands.sort((a, b) => b.confidence - a.confidence || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const c of cands) if (!kept.some((k) => c.start < k.end && k.start < c.end)) kept.push(c);
  kept.sort((a, b) => a.start - b.start);

  return kept.map((c) => {
    const start = map[c.start][0];
    const end = map[c.end - 1][1];
    return { category: c.category, start, end, value: original.slice(start, end), confidence: c.confidence, source: c.source };
  });
}

export default { normalize, detectPII };
