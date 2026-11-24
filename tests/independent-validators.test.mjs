import { test } from "node:test";
import assert from "node:assert/strict";
import { verhoeffOk, withVerhoeff, luhnOk, withLuhn } from "../eval/bench/lib/independent-validators.mjs";
import { verhoeffValid, luhnValid } from "../extension/lib/pii-checksums.mjs";
import { rng, generateCorpus } from "../eval/bench/gen-corpus.mjs";

test("independent Verhoeff reproduces the published vectors", () => {
  assert.equal(withVerhoeff("236"), "2363");
  assert.equal(withVerhoeff("12345"), "123451");
  assert.equal(withVerhoeff("142857"), "1428570");
});

test("production and independent validators agree on random numbers", () => {
  const r = rng(7);
  for (let i = 0; i < 2000; i++) {
    const s = Array.from({ length: 12 }, () => Math.floor(r() * 10)).join("");
    assert.equal(verhoeffValid(s), verhoeffOk(s), s);
    const c = Array.from({ length: 16 }, () => Math.floor(r() * 10)).join("");
    assert.equal(luhnValid(c), luhnOk(c), c);
  }
  for (let i = 0; i < 200; i++) {
    const v = withVerhoeff(Array.from({ length: 11 }, () => Math.floor(r() * 10)).join(""));
    assert.ok(verhoeffValid(v) && verhoeffOk(v));
    const l = withLuhn("4" + Array.from({ length: 14 }, () => Math.floor(r() * 10)).join(""));
    assert.ok(luhnValid(l) && luhnOk(l));
  }
});

test("corpus is reproducible and spans point at the right text", () => {
  const a = generateCorpus({ seed: 1, perCategory: 3 }), b = generateCorpus({ seed: 1, perCategory: 3 }), c = generateCorpus({ seed: 2, perCategory: 3 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.samples[0].text + a.samples[5].text, c.samples[0].text + c.samples[5].text);
  for (const s of a.samples) for (const g of s.spans) assert.ok(s.text.slice(g.start, g.end).length === g.end - g.start && g.end <= s.text.length);
  assert.ok(new Set(a.samples.map((s) => s.subset)).size === 5);
});
