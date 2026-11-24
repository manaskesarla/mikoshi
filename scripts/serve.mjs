// Tiny static file server for the demo fixtures. Binds to loopback only.
//   node scripts/serve.mjs [dir=fixtures] [port=4173]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf" };

export function createStaticServer(rootDir) {
  const root = resolve(rootDir);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel;
      try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end("bad request"); return; }
      if (rel.includes("\0")) { res.writeHead(400).end("bad request"); return; }
      let file = resolve(join(root, rel));
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end("forbidden"); return; }
      let st = await stat(file).catch(() => null);
      if (st?.isDirectory()) { file = join(file, "index.html"); st = await stat(file).catch(() => null); }
      if (!st) { res.writeHead(404).end("not found"); return; }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch { res.writeHead(500).end("error"); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dir = process.argv[2] || "fixtures";
  const port = +(process.argv[3] || 4173);
  createStaticServer(dir).listen(port, "127.0.0.1", () => console.log(`serving ${dir} at http://127.0.0.1:${port}/`));
}
