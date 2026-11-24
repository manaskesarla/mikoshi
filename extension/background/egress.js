// The single egress door. Everything bound for the server passes through here.
// Returns what the caller must do; never performs the network call itself.
//   enforceEgress(payload, ctx) -> { action: "send" | "approve" | "block", payload, result }
import { classifyPayload } from "../lib/security-policy.mjs";

export function enforceEgress(payload, ctx = {}) {
  const result = classifyPayload(payload, ctx);
  if (result.decision === "BLOCK") return { action: "block", payload: null, result };
  if (result.decision === "REQUIRE_APPROVAL") return { action: "approve", payload: result.sanitized, result };
  return { action: "send", payload: result.decision === "SANITIZE" ? result.sanitized : payload, result };
}
