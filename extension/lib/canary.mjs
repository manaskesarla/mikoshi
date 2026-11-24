// Canary tokens: unique fake "secrets" planted in test data. If one ever appears
// in an outgoing payload, something leaked, so the payload is blocked.

import { walkStrings } from "./payload-walk.mjs";

export const CANARY_PREFIX = "MKS-CANARY-";
const CANARY_RE = /MKS-CANARY-[A-Z2-7]{12}/g;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function randomBytes(n) {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/** `rand(n)` must return n random bytes; injectable for tests. */
export function generateCanaries(count = 4, rand = randomBytes) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const bytes = rand(12);
    let id = "";
    for (let j = 0; j < 12; j++) id += ALPHABET[bytes[j] % 32];
    out.push(CANARY_PREFIX + id);
  }
  return out;
}

/** Finds known canaries plus anything shaped like one. Returns [{ canary, path }]. */
export function findCanaries(payload, known = []) {
  const found = [];
  for (const { path, value } of walkStrings(payload, { skipKeys: new Set(), minLength: 1 })) {
    const seen = new Set();
    for (const m of value.matchAll(CANARY_RE)) seen.add(m[0]);
    for (const k of known) if (k && value.includes(k)) seen.add(k);
    for (const canary of seen) found.push({ canary, path });
  }
  return found;
}

export class CanaryError extends Error {
  constructor(found) {
    super(`canary token found in outgoing payload at ${found.map((f) => f.path || "(root)").join(", ")}`);
    this.name = "CanaryError";
    this.paths = found.map((f) => f.path);
  }
}

export function assertNoCanaryEgress(payload, known = []) {
  const found = findCanaries(payload, known);
  if (found.length) throw new CanaryError(found);
  return true;
}

export default { generateCanaries, findCanaries, assertNoCanaryEgress, CanaryError, CANARY_PREFIX };
