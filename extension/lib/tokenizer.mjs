// Reversible tokenization and the local vault.
//
// Every real value the browser knows about (profile entries and values detected on
// screen) maps to a stable placeholder such as [AADHAAR_1]. Only the placeholder and
// its category may leave the machine. The reverse map stays local and is used to
//   (a) redact text before it is sent, and
//   (b) resolve a token back to a value right before the executor types it.

import { canonicalCategory } from "./sensitive-fields.mjs";

const PREFIX = {
  aadhaar: "AADHAAR", pan: "PAN", email: "EMAIL", "phone-in": "PHONE", "credit-card": "CARD", cvv: "CVV",
  "card-expiry": "CARDEXP", "bank account information": "BANKACCT", ifsc: "IFSC", "upi-vpa": "UPI", gstin: "GSTIN",
  "voter-id": "VOTERID", "vehicle-reg": "VEHICLE", "passport-in": "PASSPORT", ssn: "SSN", iban: "IBAN", dob: "DOB",
  address: "ADDRESS", "postal code": "PIN", "full name": "NAME", "first name": "FIRSTNAME", "last name": "LASTNAME",
  password: "PASSWORD", username: "USERNAME", otp: "OTP", ipv4: "IP", face: "FACE",
};

export function prefixFor(category) {
  const c = canonicalCategory(category) ?? "pii";
  return PREFIX[c] ?? (String(c).toUpperCase().replace(/[^A-Z0-9]+/g, "") || "PII");
}

const MIN_REDACT_LENGTH = 3;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const collapse = (v) => String(v).replace(/\s+/g, " ").trim();
// Digit-only values compare by their digits, so "2345 6789 0124" equals "234567890124".
const keyOf = (v) => {
  const c = collapse(v);
  const digits = c.replace(/[\s-]/g, "");
  return /^\+?\d{6,}$/.test(digits) ? digits.replace(/^\+/, "") : c.toLowerCase();
};

function patternFor(rec) {
  const compact = rec.value.replace(/[\s-]/g, "");
  if (/^\+?\d{6,}$/.test(compact)) {
    const digits = compact.replace(/^\+/, "").split("").join("[\\s-]*");
    const prefix = rec.category === "phone-in" ? "(?:\\+?91[\\s-]*|0)?" : "";
    return `(?<!\\d)${prefix}${digits}(?!\\d)`;
  }
  let body = esc(collapse(rec.value)).replace(/ /g, "\\s+");
  const first = rec.value.trim()[0];
  const last = rec.value.trim().slice(-1);
  if (/[A-Za-z0-9]/.test(first)) body = "(?<![A-Za-z0-9])" + body;
  if (/[A-Za-z0-9]/.test(last)) body += "(?![A-Za-z0-9])";
  return body;
}

export class Vault {
  constructor() {
    this._byKey = new Map();    // normalized value -> record
    this._byToken = new Map();  // token -> record
    this._counters = new Map(); // prefix -> last number used
  }

  _mint(category) {
    const p = prefixFor(category);
    const n = (this._counters.get(p) || 0) + 1;
    this._counters.set(p, n);
    return `[${p}_${n}]`;
  }

  /** Add one real value. Returns its stable token, or null for empty input. */
  add(value, category, source = "profile") {
    const v = collapse(value ?? "");
    if (!v) return null;
    const key = keyOf(v);
    const existing = this._byKey.get(key);
    if (existing) return existing.token;
    const cat = canonicalCategory(category) ?? "pii";
    const rec = { token: this._mint(cat), category: cat, value: v, source };
    this._byKey.set(key, rec);
    this._byToken.set(rec.token, rec);
    return rec.token;
  }

  /** Load a { category: value } profile. Returns { category: token }. */
  addProfile(profile = {}) {
    const out = {};
    for (const [category, value] of Object.entries(profile || {})) {
      if (value == null || value === "") continue;
      out[category] = this.add(value, category, "profile");
    }
    return out;
  }

  /** Load detector output: [{ category, value, source? }]. */
  addDetections(detections = []) {
    for (const d of detections) if (d && d.value) this.add(d.value, d.category, d.source || "screen");
  }

  tokenForValue(value) { return this._byKey.get(keyOf(value ?? ""))?.token ?? null; }
  resolve(token) { return this._byToken.get(token)?.value ?? null; }
  categoryOf(token) { return this._byToken.get(token)?.category ?? null; }
  has(token) { return this._byToken.has(token); }
  get size() { return this._byToken.size; }

  /** Replace every known value in `text` with its token (longest values first). */
  redactText(text) {
    if (!text) return text;
    let out = String(text);
    const recs = [...this._byToken.values()]
      .filter((r) => r.value.length >= MIN_REDACT_LENGTH)
      .sort((a, b) => b.value.length - a.value.length);
    for (const rec of recs) out = out.replace(new RegExp(patternFor(rec), "gi"), rec.token);
    return out;
  }

  /** LOCAL USE ONLY (e.g. the OCR redactor): every known value. Never send this anywhere. */
  knownValues() { return [...this._byToken.values()].map((r) => ({ value: r.value, category: r.category })); }

  /** Safe to transmit: token -> category. Never values. */
  exportContext() {
    const map = {};
    for (const [token, rec] of this._byToken) map[token] = rec.category;
    return map;
  }

  /** Drop every entry that came from `source` (e.g. "screen" at task end). */
  forgetSource(source) {
    for (const [token, rec] of [...this._byToken]) {
      if (rec.source !== source) continue;
      this._byToken.delete(token);
      this._byKey.delete(keyOf(rec.value));
    }
  }

  /** Display-safe preview of a token's value, e.g. "XXXX XXXX 9012". */
  maskForDisplay(token) {
    const rec = this._byToken.get(token);
    if (!rec) return null;
    const v = rec.value;
    if (rec.category === "email" && v.includes("@")) {
      const [user, domain] = v.split("@");
      return `${user[0]}***@${domain}`;
    }
    const alnum = v.replace(/[^A-Za-z0-9]/g, "");
    if (alnum.length <= 4) return "•".repeat(Math.max(alnum.length, 1));
    return "•".repeat(alnum.length - 4) + alnum.slice(-4);
  }

  serialize() {
    return { v: 1, entries: [...this._byToken.values()], counters: Object.fromEntries(this._counters) };
  }

  static deserialize(data) {
    const vault = new Vault();
    if (!data || data.v !== 1) return vault;
    for (const rec of data.entries || []) {
      vault._byToken.set(rec.token, { ...rec });
      vault._byKey.set(keyOf(rec.value), vault._byToken.get(rec.token));
    }
    for (const [k, n] of Object.entries(data.counters || {})) vault._counters.set(k, n);
    return vault;
  }
}

export default { Vault, prefixFor };
