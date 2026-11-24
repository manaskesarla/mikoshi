import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verhoeffValid, verhoeffCheckDigit, luhnValid, cardIinOk, ibanValid, ssnValid, panValid,
} from "../extension/lib/pii-checksums.mjs";

test("verhoeff: published vectors", () => {
  // 236 -> check digit 3; 12345 -> 1; 142857 -> 0 (standard worked examples)
  assert.equal(verhoeffValid("2363"), true);
  assert.equal(verhoeffValid("123451"), true);
  assert.equal(verhoeffValid("1428570"), true);
  assert.equal(verhoeffValid("2364"), false);
});

test("verhoeff: check digit generator agrees with validator", () => {
  for (const payload of ["236", "12345", "142857", "23456789012", "99999999999", "20000000000"]) {
    assert.equal(verhoeffValid(payload + verhoeffCheckDigit(payload)), true, payload);
  }
});

test("verhoeff: every single-digit mutation of a valid number is rejected", () => {
  const payload = "23456789012";
  const valid = payload + verhoeffCheckDigit(payload);
  for (let i = 0; i < valid.length; i++) {
    for (let d = 0; d <= 9; d++) {
      if (String(d) === valid[i]) continue;
      const mutated = valid.slice(0, i) + d + valid.slice(i + 1);
      assert.equal(verhoeffValid(mutated), false, mutated);
    }
  }
});

test("verhoeff: tolerates spaces and hyphens, rejects non-digits", () => {
  const payload = "23456789012";
  const v = payload + verhoeffCheckDigit(payload);
  assert.equal(verhoeffValid(`${v.slice(0, 4)} ${v.slice(4, 8)} ${v.slice(8)}`), true);
  assert.equal(verhoeffValid("23A456"), false);
  assert.equal(verhoeffValid(""), false);
});

test("luhn: known cards", () => {
  assert.equal(luhnValid("4111111111111111"), true);
  assert.equal(luhnValid("5500005555555559"), true);
  assert.equal(luhnValid("378282246310005"), true);
  assert.equal(luhnValid("4111 1111 1111 1111"), true);
  assert.equal(luhnValid("4111111111111112"), false);
  assert.equal(luhnValid("123"), false);
});

test("card IIN and length", () => {
  assert.equal(cardIinOk("4111111111111111"), true);
  assert.equal(cardIinOk("5500005555555559"), true);
  assert.equal(cardIinOk("378282246310005"), true);
  assert.equal(cardIinOk("1111111111111111"), false); // no such issuer
  assert.equal(cardIinOk("411111111111"), false);     // too short
});

test("iban: valid and invalid", () => {
  assert.equal(ibanValid("GB82 WEST 1234 5698 7654 32"), true);
  assert.equal(ibanValid("DE89370400440532013000"), true);
  assert.equal(ibanValid("GB82WEST12345698765433"), false);
  assert.equal(ibanValid("not an iban"), false);
});

test("ssn: structural rules", () => {
  assert.equal(ssnValid("123-45-6789"), true);
  assert.equal(ssnValid("000-12-3456"), false);
  assert.equal(ssnValid("666-12-3456"), false);
  assert.equal(ssnValid("900-12-3456"), false);
  assert.equal(ssnValid("123-00-6789"), false);
  assert.equal(ssnValid("123-45-0000"), false);
});

test("pan: structure and holder type", () => {
  assert.equal(panValid("ABCPE1234F"), true);   // P = individual
  assert.equal(panValid("ABCDE1234F"), false);  // D is not a holder type
  assert.equal(panValid("ABCPE12345"), false);
  assert.equal(panValid("abcpe1234f"), true);
});
