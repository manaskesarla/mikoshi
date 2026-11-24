import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCanaries, findCanaries, assertNoCanaryEgress, CanaryError, CANARY_PREFIX } from "../extension/lib/canary.mjs";

test("generates distinct, well-formed canaries", () => {
  const c = generateCanaries(5);
  assert.equal(new Set(c).size, 5);
  for (const x of c) assert.match(x, /^MKS-CANARY-[A-Z2-7]{12}$/);
});

test("generation is deterministic with an injected byte source", () => {
  const fixed = () => new Uint8Array(12).fill(1);
  assert.deepEqual(generateCanaries(2, fixed), [CANARY_PREFIX + "BBBBBBBBBBBB", CANARY_PREFIX + "BBBBBBBBBBBB"]);
});

test("finds known and canary-shaped strings anywhere, including skipped keys", () => {
  const [known] = generateCanaries(1);
  const payload = { goal: `hello ${known}`, nodes: [{ id: "n1", text: "x MKS-CANARY-ABCDEFGHIJKL y" }], screenshot: "data:...", id: "MKS-CANARY-ZZZZZZZZZZZZ" };
  const found = findCanaries(payload, [known]);
  assert.deepEqual(found.map((f) => f.path).sort(), ["goal", "id", "nodes[0].text"]);
});

test("clean payload passes; dirty payload throws with paths only", () => {
  assert.equal(assertNoCanaryEgress({ a: "nothing" }), true);
  const [k] = generateCanaries(1);
  assert.throws(() => assertNoCanaryEgress({ a: { b: k } }, [k]), (e) => e instanceof CanaryError && e.paths[0] === "a.b" && !e.message.includes(k));
});
