// Thin guard used immediately before any network call to the server.
// Throws on BLOCK; otherwise returns the policy result so the caller can
// send `result.sanitized` (SANITIZE) or ask the user (REQUIRE_APPROVAL).

import { classifyPayload } from "./security-policy.mjs";

export class EgressBlockedError extends Error {
  constructor(result) {
    super(`egress blocked: ${result.reasons.join("; ") || "policy"}`);
    this.name = "EgressBlockedError";
    this.reasons = result.reasons;
    this.classification = result.classification;
  }
}

export function assertNoSensitivePayload(payload, ctx = {}) {
  const result = classifyPayload(payload, ctx);
  if (result.decision === "BLOCK") throw new EgressBlockedError(result);
  return result;
}

export default { assertNoSensitivePayload, EgressBlockedError };
