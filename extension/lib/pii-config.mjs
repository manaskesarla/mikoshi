// Data only: categories, keyword lists, allow-lists and regex rules.
// The engine (pii-rules.mjs) decides what to do with them.

export const CATEGORIES = [
  "aadhaar", "pan", "email", "phone-in", "credit-card", "bank account information",
  "ifsc", "upi-vpa", "gstin", "voter-id", "vehicle-reg", "passport-in",
  "dob", "ipv4", "iban", "ssn",
];

// Words that, when near a value, raise confidence that it is what we think it is.
export const CONTEXT = {
  aadhaar: ["aadhaar", "aadhar", "adhaar", "uidai", "uid", "unique id", "आधार"],
  pan: ["pan", "permanent account", "income tax", "it dept"],
  "phone-in": ["phone", "mobile", "mob", "tel", "contact", "whatsapp", "call", "cell"],
  "credit-card": ["card", "credit", "debit", "visa", "mastercard", "rupay", "amex", "cc"],
  "bank account information": ["account", "a/c", "acct", "acc no", "savings", "current account", "bank"],
  dob: ["dob", "date of birth", "birth", "born", "d.o.b"],
  "voter-id": ["voter", "epic", "election", "electoral"],
  "passport-in": ["passport"],
  "vehicle-reg": ["vehicle", "registration", "reg no", "rc", "number plate"],
  ssn: ["ssn", "social security"],
  ipv4: ["ip", "address", "host"],
  iban: ["iban", "account"],
  gstin: ["gst", "gstin", "tax"],
  ifsc: ["ifsc", "branch", "bank"],
};

// Words that suggest a long digit string is NOT personal data.
export const NEGATIVE_CONTEXT = [
  "order", "tracking", "invoice", "ref", "reference", "transaction", "txn", "ticket",
  "serial", "sku", "barcode", "isbn", "product", "model", "version", "build", "id:", "case no",
];

export const IFSC_BANKS = new Set([
  "SBIN", "HDFC", "ICIC", "UTIB", "PUNB", "BARB", "CNRB", "KKBK", "IDIB", "UBIN", "YESB",
  "INDB", "IOBA", "CBIN", "BKID", "MAHB", "FDRL", "KARB", "SIBL", "RATN", "AUBL", "IDFB",
  "PSIB", "UCBA", "VIJB", "DLXB", "CORP", "ANDB", "ALLA", "ORBC", "SYNB", "TMBL", "CIUB",
]);

export const RTO_STATES = new Set([
  "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ", "HP", "HR", "JH",
  "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD", "OR", "PB", "PY",
  "RJ", "SK", "TN", "TR", "TS", "UK", "UP", "WB",
]);

export const UPI_HANDLES = new Set([
  "okaxis", "okhdfcbank", "okicici", "oksbi", "ybl", "ibl", "axl", "paytm", "upi", "apl",
  "sbi", "icici", "hdfcbank", "axisbank", "kotak", "pnb", "boi", "fbl", "waicici", "wahdfcbank",
]);

// Regex rules. `validate(match)` is optional extra structural checking.
// `needsContext` means the match is only reported when a context keyword is near.
// `base` is the confidence for a structurally-valid match; `ctxBoost` is added with context.
export const REGEX_RULES = [
  { category: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, base: 0.95 },
  { category: "upi-vpa", re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}(?![A-Za-z0-9.-])/g, base: 0.4, ctxBoost: 0.1,
    validate: (m) => UPI_HANDLES.has(m.split("@")[1].toLowerCase()), validBase: 0.9 },
  { category: "pan", re: /(?<![A-Za-z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Za-z0-9])/g, base: 0.45, ctxBoost: 0.4,
    validate: (m) => "ABCFGHLJPT".includes(m[3]), validBase: 0.9 },
  { category: "gstin", re: /(?<![A-Za-z0-9])\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z](?![A-Za-z0-9])/g, base: 0.9 },
  { category: "ifsc", re: /(?<![A-Za-z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Za-z0-9])/g, base: 0.6, ctxBoost: 0.3,
    validate: (m) => IFSC_BANKS.has(m.slice(0, 4)), validBase: 0.9 },
  { category: "voter-id", re: /(?<![A-Za-z0-9])[A-Z]{3}\d{7}(?![A-Za-z0-9])/g, base: 0.35, ctxBoost: 0.55 },
  { category: "passport-in", re: /(?<![A-Za-z0-9])[A-PR-WY][1-9]\d{6}(?![A-Za-z0-9])/g, base: 0.35, ctxBoost: 0.55 },
  { category: "vehicle-reg", re: /(?<![A-Za-z0-9])[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,3}[ -]?\d{4}(?![A-Za-z0-9])/g, base: 0.4, ctxBoost: 0.3,
    validate: (m) => RTO_STATES.has(m.slice(0, 2)), validBase: 0.8 },
  { category: "ssn", re: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, base: 0.45, ctxBoost: 0.45,
    validate: (m) => !(m.startsWith("000") || m.startsWith("666") || m[0] === "9" || m.slice(4, 6) === "00" || m.slice(7) === "0000"), validBase: 0.8 },
  { category: "ipv4", re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g, base: 0.7 },
  { category: "dob", re: /(?<!\d)(?:(?:0?[1-9]|[12]\d|3[01])[/.-](?:0?[1-9]|1[0-2])[/.-](?:19|20)\d{2}|(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))(?!\d)/g,
    base: 0.4, ctxBoost: 0.5 },
  { category: "iban", re: /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])/g, base: 0.2,
    validate: null, checksum: "iban", validBase: 0.92 },
];

export default { CATEGORIES, CONTEXT, NEGATIVE_CONTEXT, IFSC_BANKS, RTO_STATES, UPI_HANDLES, REGEX_RULES };
