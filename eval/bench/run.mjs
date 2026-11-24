// Scores detectPII on the seeded corpus. Prints a table and writes eval/out/bench.json.
//   node eval/bench/run.mjs [--seed N] [--per N] [--md docs/results/bench-baseline.md]
import { writeFileSync, mkdirSync } from "node:fs";
import { generateCorpus } from "./gen-corpus.mjs";
import { detectPII } from "../../extension/lib/pii-rules.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const seed = +arg("seed", 20261124), per = +arg("per", 40), mdOut = arg("md", null);

const { samples } = generateCorpus({ seed, perCategory: per });
const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const norm = (c) => (c === "bank account information" ? "bank" : c);

const sub = {}; // subset -> counters
const bump = (s) => (sub[s] ??= { gold: 0, found: 0, samples: 0, falsePosSamples: 0, goldChars: 0, leakChars: 0 });
let tp = 0, fp = 0, fn = 0;
const times = [];

for (const s of samples) {
  const t0 = performance.now();
  const preds = detectPII(s.text);
  times.push(performance.now() - t0);
  const c = bump(s.subset); c.samples++;
  if (s.subset === "D") { if (preds.length) c.falsePosSamples++; fp += preds.length; continue; }
  const used = new Set();
  for (const g of s.spans) {
    c.gold++; c.goldChars += g.end - g.start;
    const hit = preds.findIndex((p, i) => !used.has(i) && norm(p.category) === norm(g.category) && overlap(p, g) >= 0.5 * (g.end - g.start));
    if (hit >= 0) { used.add(hit); c.found++; tp++; } else fn++;
    const covered = preds.reduce((n, p) => n + overlap(p, g), 0);
    c.leakChars += Math.max(0, g.end - g.start - covered);
  }
  fp += preds.length - used.size;
}
const pct = (x) => (100 * x).toFixed(1) + "%";
const P = tp / (tp + fp || 1), R = tp / (tp + fn || 1), F = (2 * P * R) / (P + R || 1);
times.sort((a, b) => a - b);
const goldChars = Object.values(sub).reduce((n, c) => n + c.goldChars, 0), leak = Object.values(sub).reduce((n, c) => n + c.leakChars, 0);
const names = { A: "A contextual", B: "B unlabelled", C: "C structured", D: "D negatives", E: "E OCR-garbled" };
const rows = Object.keys(sub).sort().map((k) => k === "D"
  ? `| ${names[k]} | ${sub[k].samples} samples | false-positive rate ${pct(sub[k].falsePosSamples / sub[k].samples)} |`
  : `| ${names[k]} | ${sub[k].gold} spans | recall ${pct(sub[k].found / sub[k].gold)}, char leakage ${pct(sub[k].leakChars / sub[k].goldChars)} |`);
const result = { seed, perCategory: per, samples: samples.length, precision: P, recall: R, f1: F, charLeakage: leak / goldChars, p50ms: times[Math.floor(times.length / 2)], p99ms: times[Math.floor(times.length * 0.99)], subsets: sub };

const md = `# Detection benchmark baseline

Synthetic seeded corpus (seed ${seed}, ${samples.length} samples). All values are random, none are real identifiers.
Command: \`node eval/bench/run.mjs --seed ${seed} --per ${per}\`

**Overall:** precision ${pct(P)} · recall ${pct(R)} · F1 ${pct(F)} · character leakage ${pct(leak / goldChars)} · p50 ${result.p50ms.toFixed(3)} ms · p99 ${result.p99ms.toFixed(3)} ms

| Subset | Size | Result |
|---|---|---|
${rows.join("\n")}

Matching rule: a prediction counts when its category equals the gold category and it covers at least half of the gold span.
Not measured here: OCR accuracy, real-page DOM text, end-to-end latency (these need a real browser).
`;
console.log(md);
mkdirSync("eval/out", { recursive: true });
writeFileSync("eval/out/bench.json", JSON.stringify(result, null, 2));
if (mdOut) writeFileSync(mdOut, md);
