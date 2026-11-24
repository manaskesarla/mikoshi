// Seeded synthetic corpus. Same seed => identical corpus. All values are random
// and checksum-valid where needed; none are real identifiers.
//   sample = { id, subset, text, spans: [{ category, start, end }] }
// Subsets: A contextual, B unlabelled, C structured (several fields), D negatives, E OCR-garbled.

import { withVerhoeff, withLuhn } from "./lib/independent-validators.mjs";

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeGenerators(r) {
  const int = (n) => Math.floor(r() * n);
  const pick = (a) => a[int(a.length)];
  const digits = (n, first) => (first ? String(first[int(first.length)]) : String(int(10))) + Array.from({ length: n - 1 }, () => int(10)).join("");
  const letters = (n, set = "ABCDEFGHIJKLMNOPQRSTUVWXYZ") => Array.from({ length: n }, () => set[int(set.length)]).join("");
  const first = ["Asha", "Ravi", "Meera", "Kiran", "Sana", "Arjun"];
  const last = ["Rao", "Iyer", "Shah", "Nair", "Khan", "Das"];
  const gen = {
    aadhaar: () => { const v = withVerhoeff(digits(11, "23456789")); return r() < 0.7 ? `${v.slice(0, 4)} ${v.slice(4, 8)} ${v.slice(8)}` : v; },
    pan: () => letters(3) + pick("ABCFGHLJPT") + letters(1) + digits(4) + letters(1),
    "phone-in": () => { const v = digits(10, "6789"); const f = int(3); return f === 0 ? v : f === 1 ? `+91 ${v.slice(0, 5)} ${v.slice(5)}` : `+91${v}`; },
    email: () => `${pick(first).toLowerCase()}.${pick(last).toLowerCase()}${int(99)}@${pick(["example.com", "mail.example.org", "college.example.edu"])}`,
    "credit-card": () => { const v = withLuhn("4" + digits(14)); return `${v.slice(0, 4)} ${v.slice(4, 8)} ${v.slice(8, 12)} ${v.slice(12)}`; },
    dob: () => `${String(1 + int(28)).padStart(2, "0")}/${String(1 + int(12)).padStart(2, "0")}/${1970 + int(35)}`,
    ifsc: () => pick(["SBIN", "HDFC", "ICIC", "UTIB"]) + "0" + letters(6, "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"),
  };
  return { int, pick, digits, letters, gen };
}

const CONTEXT = {
  aadhaar: (v) => pick2(["Aadhaar: ", "Aadhaar number ", "UID - "]) + v,
  pan: (v) => pick2(["PAN: ", "PAN number ", "Permanent Account Number "]) + v,
  "phone-in": (v) => pick2(["Mobile: ", "Phone ", "Call me on "]) + v,
  email: (v) => pick2(["Email: ", "Write to ", "Contact "]) + v,
  "credit-card": (v) => pick2(["Card number ", "Credit card: ", "Pay with card "]) + v,
  dob: (v) => pick2(["DOB: ", "Date of birth ", "Born on "]) + v,
  ifsc: (v) => pick2(["IFSC ", "IFSC code: ", "Branch IFSC "]) + v,
};
let pick2 = (a) => a[0];

export function generateCorpus({ seed = 20261124, perCategory = 40 } = {}) {
  const r = rng(seed);
  const { int, pick, digits, letters, gen } = makeGenerators(r);
  pick2 = (a) => a[int(a.length)];
  const samples = [];
  const add = (subset, parts) => {
    let text = ""; const spans = [];
    for (const p of parts) {
      if (typeof p === "string") text += p;
      else { const start = text.length; text += p.value; spans.push({ category: p.category, start, end: start + p.value.length }); }
    }
    samples.push({ id: `${subset}-${samples.length}`, subset, text, spans });
  };
  const cats = Object.keys(CONTEXT);
  const lead = ["Please note: ", "Applicant details. ", "", "Form 14B - "];
  const tail = [" thanks.", "", " (verified)", ". Next section follows."];

  for (const category of cats) for (let i = 0; i < perCategory; i++) {
    const v = gen[category]();
    const labelled = CONTEXT[category](v);
    const prefix = labelled.slice(0, labelled.length - v.length);
    add("A", [pick(lead), prefix, { category, value: v }, pick(tail)]);                       // contextual
    add("B", [pick(["Use ", "Details: ", "Please enter ", "Copy "]), { category, value: v }, pick(tail)]); // unlabelled
  }
  for (let i = 0; i < perCategory; i++) {                                                     // structured
    const a = gen.aadhaar(), p = gen.pan(), ph = gen["phone-in"](), e = gen.email();
    add("C", ["Name: ", pick(["Asha", "Ravi"]), " Rao\nAadhaar: ", { category: "aadhaar", value: a }, "\nPAN: ", { category: "pan", value: p }, "\nMobile: ", { category: "phone-in", value: ph }, "\nEmail: ", { category: "email", value: e }]);
  }
  for (let i = 0; i < perCategory * 3; i++) {                                                 // negatives: same shapes, not PII
    const kind = i % 6;
    const t = kind === 0 ? `Order no ${digits(12, "123456789")} shipped`
      : kind === 1 ? `Tracking ID ${digits(10, "12345")} for parcel`
      : kind === 2 ? `Invoice ${letters(5)}${digits(4)}${letters(1)} generated`
      : kind === 3 ? `Version ${int(9)}.${int(20)}.${int(99)} build ${digits(6)}`
      : kind === 4 ? `The meeting is on ${1 + int(28)}/${1 + int(12)}/${2026} at the hall`
      : `Total amount Rs ${digits(7)} paid by transaction ref ${digits(12, "123456789")}`;
    add("D", [t]);
  }
  for (let i = 0; i < perCategory; i++) {                                                     // OCR-garbled
    const v = gen.aadhaar().replace(/0/g, "O").replace(/1/g, "l");
    const w = gen["phone-in"]().replace(/ /g, "").replace(/5/g, "S");
    add("E", ["Aadhaar: ", { category: "aadhaar", value: v }, " Mobile: ", { category: "phone-in", value: w }]);
  }
  return { seed, samples };
}
