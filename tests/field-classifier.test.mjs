import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySignals } from "../extension/lib/field-classifier.mjs";

const cat = (s) => classifySignals(s).category;

test("autocomplete token wins", () => {
  assert.equal(cat({ autocomplete: "cc-number", name: "x" }), "credit-card");
  assert.equal(cat({ autocomplete: "section-a shipping postal-code" }), "postal code");
  assert.equal(classifySignals({ autocomplete: "email" }).confidence, 0.95);
});

test("input type", () => {
  assert.equal(cat({ type: "password" }), "password");
  assert.equal(cat({ type: "email" }), "email");
  assert.equal(cat({ type: "tel" }), "phone-in");
});

test("keywords in name, id or label", () => {
  assert.equal(cat({ name: "aadhaar_no" }), "aadhaar");
  assert.equal(cat({ label: "Aadhar Number" }), "aadhaar");
  assert.equal(cat({ label: "PAN" }), "pan");
  assert.equal(cat({ label: "Permanent Account Number" }), "pan");
  assert.equal(cat({ id: "cvv" }), "cvv");
  assert.equal(cat({ label: "Card number" }), "credit-card");
  assert.equal(cat({ label: "Expiry date" }), "card-expiry");
  assert.equal(cat({ label: "OTP" }), "otp");
  assert.equal(cat({ label: "IFSC code" }), "ifsc");
  assert.equal(cat({ label: "Account number" }), "bank account information");
  assert.equal(cat({ label: "Date of birth" }), "dob");
  assert.equal(cat({ label: "First name" }), "first name");
  assert.equal(cat({ label: "Surname" }), "last name");
  assert.equal(cat({ label: "Full name" }), "full name");
  assert.equal(cat({ label: "Mobile number" }), "phone-in");
  assert.equal(cat({ label: "PIN code" }), "postal code");
  assert.equal(cat({ label: "Street address" }), "address");
});

test("user name is a username, not a person's full name", () => {
  assert.equal(cat({ label: "User name" }), "username");
  assert.equal(cat({ name: "username" }), "username");
});

test("words that merely contain 'pan' do not match", () => {
  assert.equal(cat({ label: "Company" }), null);
  assert.equal(cat({ label: "Expand section" }), null);
});

test("placeholder is weaker evidence", () => {
  const r = classifySignals({ placeholder: "Enter your email" });
  assert.equal(r.category, "email");
  assert.equal(r.confidence, 0.6);
});

test("no signals", () => {
  assert.equal(cat({}), null);
  assert.equal(cat(undefined), null);
  assert.equal(cat({ label: "Remember me" }), null);
});
