import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoSensitivePayload, EgressBlockedError } from "../extension/lib/egress-guard.mjs";

test("clean payload passes and returns the policy result", () => {
  const r = assertNoSensitivePayload({ taskGoal: "open fees page" });
  assert.equal(r.decision, "ALLOW");
});

test("sanitizable payload passes with a cleaned copy", () => {
  const r = assertNoSensitivePayload({ t: "mail asha@example.com" });
  assert.equal(r.decision, "SANITIZE");
  assert.ok(!JSON.stringify(r.sanitized).includes("asha@example.com"));
});

test("blocked payload throws an error whose message has no raw value", () => {
  const secret = "AKIAIOSFODNN7EXAMPLE";
  assert.throws(() => assertNoSensitivePayload({ t: secret }), (e) => e instanceof EgressBlockedError && !e.message.includes(secret) && e.reasons.length === 1);
});
