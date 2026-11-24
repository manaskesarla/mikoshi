// Canonical category names and the sets that drive policy.
//   RESTRICTED: never sent to the model; typing needs care (firewall treats as MEDIUM+).
//   PROFILE:    ordinary personal data the user may allow for autofill.
// `canonicalCategory` folds the many spellings used by detectors, classifiers and UI.

import { detectPII } from "./pii-rules.mjs";
import { scanSecrets } from "./secret-scanner.mjs";

export const RESTRICTED_PII_CATEGORIES = new Set([
  "aadhaar", "pan", "credit-card", "cvv", "card-expiry", "bank account information",
  "passport-in", "ssn", "voter-id", "iban", "password", "otp",
]);

export const PROFILE_PII_CATEGORIES = new Set([
  "full name", "first name", "last name", "email", "phone-in", "address", "postal code",
  "dob", "ifsc", "upi-vpa", "gstin", "vehicle-reg", "username",
]);

const ALIASES = new Map(Object.entries({
  "aadhaar number": "aadhaar", aadhar: "aadhaar", uid: "aadhaar",
  "pan number": "pan", "permanent account number": "pan",
  "credit/debit card number": "credit-card", "card number": "credit-card", card: "credit-card",
  "cvv/security code": "cvv", cvc: "cvv", "security code": "cvv",
  "card expiry": "card-expiry", expiry: "card-expiry",
  "phone number": "phone-in", phone: "phone-in", mobile: "phone-in", "mobile number": "phone-in",
  "date of birth": "dob", birthday: "dob",
  "postal/zip code": "postal code", pin: "postal code", "pin code": "postal code", zip: "postal code",
  "passport number": "passport-in", "voter id": "voter-id",
  "bank account": "bank account information", "account number": "bank account information",
  "e-mail": "email", "email address": "email",
  name: "full name", "one-time code": "otp", "one time password": "otp",
}));

export function canonicalCategory(name) {
  if (name == null) return null;
  const key = String(name).trim().toLowerCase();
  if (!key) return null;
  return ALIASES.get(key) ?? key;
}

export const isRestrictedCategory = (c) => RESTRICTED_PII_CATEGORIES.has(canonicalCategory(c));
export const isProfileCategory = (c) => PROFILE_PII_CATEGORIES.has(canonicalCategory(c));
export const isSensitiveCategory = (c) => isRestrictedCategory(c) || isProfileCategory(c);

/** True if `text` contains PII at confidence >= 0.7 or any secret. */
export function isSensitiveText(text) {
  const s = String(text ?? "");
  if (!s) return false;
  return detectPII(s, { minConfidence: 0.7 }).length > 0 || scanSecrets(s).length > 0;
}

export default { RESTRICTED_PII_CATEGORIES, PROFILE_PII_CATEGORIES, canonicalCategory, isRestrictedCategory, isProfileCategory, isSensitiveCategory, isSensitiveText };
