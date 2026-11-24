// Dependency-free validators used by the PII detector.
// Pure functions: string in, boolean (or digit) out.

const digitsOnly = (s) => String(s ?? "").replace(/[\s-]/g, "");

// ---- Verhoeff (used by Aadhaar) -------------------------------------------
const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const V_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffValid(value) {
  const s = digitsOnly(value);
  if (!/^\d{2,}$/.test(s)) return false;
  let c = 0;
  const rev = [...s].reverse();
  for (let i = 0; i < rev.length; i++) c = V_D[c][V_P[i % 8][+rev[i]]];
  return c === 0;
}

/** Check digit to append to `payload` so the result passes verhoeffValid. */
export function verhoeffCheckDigit(payload) {
  const s = digitsOnly(payload);
  let c = 0;
  const rev = [...s].reverse();
  for (let i = 0; i < rev.length; i++) c = V_D[c][V_P[(i + 1) % 8][+rev[i]]];
  return V_INV[c];
}

// ---- Luhn (payment cards) --------------------------------------------------
export function luhnValid(value) {
  const s = digitsOnly(value);
  if (!/^\d{12,19}$/.test(s)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = +s[i];
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Plausible issuer prefix and length for a card number. */
export function cardIinOk(value) {
  const s = digitsOnly(value);
  if (!/^\d{13,19}$/.test(s)) return false;
  const n2 = +s.slice(0, 2);
  const n3 = +s.slice(0, 3);
  const n4 = +s.slice(0, 4);
  if (s[0] === "4") return [13, 16, 19].includes(s.length);                                // Visa
  if ((n2 >= 51 && n2 <= 55) || (n4 >= 2221 && n4 <= 2720)) return s.length === 16;        // Mastercard
  if (n2 === 34 || n2 === 37) return s.length === 15;                                      // Amex
  if (n2 === 36 || n2 === 38 || (n3 >= 300 && n3 <= 305)) return s.length >= 14 && s.length <= 16; // Diners
  if (n4 === 6011 || n2 === 65 || (n3 >= 644 && n3 <= 649)) return s.length >= 16 && s.length <= 19; // Discover
  if (n2 === 60 || n2 === 81 || n2 === 82 || s.startsWith("508")) return s.length === 16;  // RuPay
  if (n2 === 35) return s.length >= 16 && s.length <= 19;                                  // JCB
  return false;
}

// ---- IBAN (mod 97) ---------------------------------------------------------
export function ibanValid(value) {
  const s = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + +d) % 97;
  }
  return rem === 1;
}

// ---- US SSN structure ------------------------------------------------------
export function ssnValid(value) {
  const m = /^(\d{3})-?(\d{2})-?(\d{4})$/.exec(String(value ?? "").trim());
  if (!m) return false;
  const [, area, group, serial] = m;
  if (area === "000" || area === "666" || area[0] === "9") return false;
  return group !== "00" && serial !== "0000";
}

// ---- Indian PAN structure --------------------------------------------------
// 5 letters, 4 digits, 1 letter. The 4th letter is the holder type.
const PAN_HOLDER_TYPES = "ABCFGHLJPT";
export function panValid(value) {
  const s = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(s) && PAN_HOLDER_TYPES.includes(s[3]);
}

export default { verhoeffValid, verhoeffCheckDigit, luhnValid, cardIinOk, ibanValid, ssnValid, panValid };
