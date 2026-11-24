// Classify a form control into a category from its markup signals.
//   classifySignals({ type, name, id, autocomplete, label, placeholder, ariaLabel, title })
//     -> { category, confidence, reason } | { category: null, confidence: 0, reason: "no match" }
// Categories are canonical (see sensitive-fields.mjs).

const AUTOCOMPLETE = {
  "cc-number": "credit-card", "cc-csc": "cvv", "cc-exp": "card-expiry", "cc-exp-month": "card-expiry", "cc-exp-year": "card-expiry",
  email: "email", tel: "phone-in", "tel-national": "phone-in", "given-name": "first name", "family-name": "last name",
  name: "full name", bday: "dob", "postal-code": "postal code", "street-address": "address", "address-line1": "address",
  "address-line2": "address", "one-time-code": "otp", "current-password": "password", "new-password": "password", username: "username",
};

const TYPE = { password: "password", email: "email", tel: "phone-in" };

// Order matters: first match wins. Tested against name/id/label/aria text.
const KEYWORDS = [
  ["aadhaar", /aadh?aa?r|\buidai\b|\bUID\b|आधार/i],
  ["pan", /\bpan\b|permanent[\s_-]*account/i],
  ["cvv", /\bcvv2?\b|\bcvc\b|security[\s_-]*code|card[\s_-]*verification/i],
  ["card-expiry", /expir|exp[\s_-]*(date|month|year)|valid[\s_-]*(thru|through|till)/i],
  ["credit-card", /card[\s_-]*(number|no)|credit[\s_-]*card|debit[\s_-]*card|\bccnum\b|\bcc[\s_-]*number\b/i],
  ["otp", /\botp\b|one[\s_-]*time|verification[\s_-]*code|\bpasscode\b/i],
  ["password", /pass(word|wd)\b|\bpwd\b/i],
  ["ifsc", /\bifsc\b/i],
  ["bank account information", /account[\s_-]*(number|no|num)|\ba\/c\b|\bacct\b/i],
  ["passport-in", /passport/i],
  ["voter-id", /voter|\bepic\b/i],
  ["gstin", /\bgstin?\b/i],
  ["upi-vpa", /\bupi\b|\bvpa\b/i],
  ["dob", /\bdob\b|date[\s_-]*of[\s_-]*birth|birth[\s_-]*date|birthday|\bd\.o\.b\b/i],
  ["username", /user[\s_-]*(name|id)|login[\s_-]*id/i],
  ["first name", /first[\s_-]*name|given[\s_-]*name|\bfname\b|forename/i],
  ["last name", /last[\s_-]*name|sur[\s_-]*name|family[\s_-]*name|\blname\b/i],
  ["full name", /full[\s_-]*name|\bname\b|applicant[\s_-]*name/i],
  ["email", /e[\s_-]*mail/i],
  ["phone-in", /phone|mobile|\btel\b|contact[\s_-]*(no|number)|whatsapp/i],
  ["postal code", /pin[\s_-]*code|\bpincode\b|zip|postal/i],
  ["address", /address|street|locality|\bcity\b|\bdistrict\b|\bstate\b/i],
];

const miss = { category: null, confidence: 0, reason: "no match" };

export function classifySignals(signals = {}) {
  const s = signals || {};
  // 1. explicit autocomplete token
  const ac = String(s.autocomplete || "").toLowerCase().split(/\s+/).pop();
  if (ac && AUTOCOMPLETE[ac]) return { category: AUTOCOMPLETE[ac], confidence: 0.95, reason: `autocomplete=${ac}` };

  // 2. input type
  const type = String(s.type || "").toLowerCase();
  if (TYPE[type]) return { category: TYPE[type], confidence: 0.9, reason: `type=${type}` };

  // 3. keywords in name / id / label / aria-label / title
  const strong = [s.name, s.id, s.label, s.ariaLabel, s.title].filter(Boolean).join(" | ");
  for (const [category, re] of KEYWORDS) {
    if (re.test(strong)) return { category, confidence: 0.8, reason: `keyword in name/label` };
  }

  // 4. placeholder only (weaker)
  if (s.placeholder) {
    for (const [category, re] of KEYWORDS) {
      if (re.test(String(s.placeholder))) return { category, confidence: 0.6, reason: "keyword in placeholder" };
    }
  }
  return miss;
}

export default { classifySignals };
