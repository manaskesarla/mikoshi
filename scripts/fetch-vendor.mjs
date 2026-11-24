// Downloads the OCR assets into extension/vendor/ from the public npm registry.
//   node scripts/fetch-vendor.mjs
// Versions are pinned in extension/vendor/vendor.lock.json (created on first run from the
// registry's current "latest"). Every tarball is checked against the registry's own sha512
// integrity value before anything is extracted. Re-running is safe.
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const VENDOR = new URL("../extension/vendor/", import.meta.url).pathname;
const LOCK = join(VENDOR, "vendor.lock.json");
const REGISTRY = "https://registry.npmjs.org";
const PACKAGES = [
  { name: "tesseract.js", pick: (f) => /^package\/dist\/(tesseract\.min\.js|worker\.min\.js)$/.test(f) },
  { name: "tesseract.js-core", pick: (f) => /^package\/tesseract-core(-simd)?-lstm\.wasm(\.js)?$/.test(f) },
  { name: "@tesseract.js-data/eng", pick: (f) => /^package\/4\.0\.0_best_int\/eng\.traineddata\.gz$/.test(f) },
];

const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : {};
mkdirSync(VENDOR, { recursive: true });
const work = join(tmpdir(), `mikoshi-vendor-${process.pid}`);
mkdirSync(work, { recursive: true });

async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`); return r.json(); }

for (const pkg of PACKAGES) {
  const enc = pkg.name.replace("/", "%2f");
  const version = lock[pkg.name]?.version ?? (await json(`${REGISTRY}/${enc}/latest`)).version;
  const meta = await json(`${REGISTRY}/${enc}/${version}`);
  const { tarball, integrity } = meta.dist;
  const res = await fetch(tarball);
  if (!res.ok) throw new Error(`${tarball} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const [algo, expected] = String(integrity).split("-");
  const actual = createHash(algo).update(buf).digest("base64");
  if (algo !== "sha512" || actual !== expected) throw new Error(`integrity check FAILED for ${pkg.name}@${version}`);

  const tgz = join(work, basename(tarball));
  writeFileSync(tgz, buf);
  const listing = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  const wanted = listing.filter(pkg.pick);
  if (!wanted.length) throw new Error(`no expected files found in ${pkg.name}@${version}`);
  const out = join(work, pkg.name.replace(/\W+/g, "_"));
  mkdirSync(out, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", out, ...wanted]);
  for (const f of wanted) copyFileSync(join(out, f), join(VENDOR, basename(f)));
  lock[pkg.name] = { version, integrity, files: wanted.map((f) => basename(f)) };
  console.log(`ok  ${pkg.name}@${version}  ${wanted.map((f) => basename(f)).join(", ")}`);
}
writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n");
rmSync(work, { recursive: true, force: true });
const total = readdirSync(VENDOR).filter((f) => f !== "README.md").reduce((n, f) => n + statSync(join(VENDOR, f)).size, 0);
console.log(`done. ${(total / 1e6).toFixed(1)} MB in extension/vendor/`);
