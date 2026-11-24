import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSecrets, shannonEntropy, maskSecret } from "../extension/lib/secret-scanner.mjs";

// All values below are synthetic or published documentation examples.
const subtypes = (t) => scanSecrets(t).map((f) => f.subtype);

test("vendor formats", () => {
  assert.deepEqual(subtypes("key AKIAIOSFODNN7EXAMPLE end"), ["aws-access-key"]);
  assert.deepEqual(subtypes("t ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"), ["github-token"]);
  assert.deepEqual(subtypes("sk_test_" + "abcdefghijklmnop1234"), ["stripe-key"]);
  assert.deepEqual(subtypes("xoxb-1234567890-abcdefghij"), ["slack-token"]);
  assert.deepEqual(subtypes("-----BEGIN RSA PRIVATE KEY-----"), ["private-key"]);
  assert.deepEqual(subtypes("postgres://user:pa55word@db.example.com:5432/app"), ["db-connection-string"]);
  assert.deepEqual(subtypes("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"), ["bearer-token"]);
});

test("jwt", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";
  assert.deepEqual(subtypes(jwt), ["jwt"]);
});

test("generic assignment needs high entropy", () => {
  assert.deepEqual(subtypes('api_key = "q8Zr2xLm9TvB4nWc7YdE1sHk"'), ["generic-secret"]);
  assert.deepEqual(subtypes('password = "aaaaaaaaaaaaaaaaaaaa"'), []);
  assert.deepEqual(subtypes("token: short"), []);
});

test("evidence is masked and never contains the full secret", () => {
  const secret = "AKIAIOSFODNN7EXAMPLE";
  const [f] = scanSecrets(`x ${secret} y`);
  assert.ok(!f.evidence.includes(secret));
  assert.ok(f.evidence.startsWith("AKIA"));
  assert.equal(JSON.stringify(f).includes(secret), false);
});

test("actions: vendor keys block, generic requires approval", () => {
  assert.equal(scanSecrets("AKIAIOSFODNN7EXAMPLE")[0].action, "block");
  assert.equal(scanSecrets('secret = "q8Zr2xLm9TvB4nWc7YdE1sHk"')[0].action, "require_approval");
});

test("plain prose has no findings", () => {
  assert.deepEqual(scanSecrets("Please fill the form and submit it by Friday."), []);
});

test("entropy and mask helpers", () => {
  assert.equal(shannonEntropy("aaaa"), 0);
  assert.ok(shannonEntropy("q8Zr2xLm9TvB4nWc") > 3.5);
  assert.equal(maskSecret("abcdefghij"), "abcd…[10 chars]");
});
