# 10 — Repository Structure

Target repo: this repository, `main` branch.
Layout is a proposal **[ASSUMPTION]**.

```
Mikoshi/
├── README.md                    # short; links to docs/
├── LICENSE                      # decision pending (Q9)
├── package.json                 # scripts only; no runtime deps in MVP
├── .gitignore
├── docs/                        # these planning docs
├── extension/                   # MV3 extension
│   ├── manifest.json
│   ├── background/              # service worker (ES module)
│   │   ├── index.js             # wiring, message routing
│   │   ├── orchestrator.js      # state machine / loop
│   │   ├── egress.js            # the single egress function
│   │   ├── vault-store.js       # vault load/save in chrome.storage
│   │   ├── api-client.js        # talks to FastAPI only
│   │   └── tabs.js              # navigate / open_tab / tab tracking
│   ├── content/
│   │   ├── perceiver.js         # skeleton + text + adversarial scan
│   │   ├── executor.js          # type/click/select/scroll/submit/search/extract
│   │   └── loader.js            # dynamic import of lib/ modules
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   └── offscreen.js         # OCR + redaction + verify
│   ├── panel/                   # side panel UI
│   │   ├── panel.html · panel.css · panel.js
│   │   └── components/          # approvals.js · activity.js · profile.js · settings.js
│   ├── lib/                     # privacy-core: ONE copy, ESM
│   │   ├── pii-rules.mjs  pii-config.mjs  pii-checksums.mjs
│   │   ├── secret-scanner.mjs  sensitive-fields.mjs  field-classifier.mjs
│   │   ├── label-assoc.mjs  dlp-heuristics.mjs  dlp-sanitizer.mjs
│   │   ├── tokenizer.mjs  redact.mjs  merge.mjs  redaction-verify.mjs
│   │   ├── security-policy.mjs  egress-guard.mjs  canary.mjs
│   │   ├── adversarial-guard.mjs  action-firewall.mjs  url-risk.mjs   # url-risk is NEW
│   │   └── dpdp-audit.mjs
│   └── vendor/                  # gitignored; filled by scripts/fetch-vendor.mjs
├── server/
│   ├── main.py  schema.py  vlm.py
│   ├── prompts/system.md
│   ├── requirements.txt  .env.example
│   └── tests/                   # pytest
├── fixtures/                    # demo + hostile pages
│   ├── kyc/ …                   # demo A
│   ├── portal/ …                # demo B (multi-page)
│   └── hostile/ …
├── security-lab/                # generated adversarial pages (subset)
├── eval/                        # benchmarks (bench/, screens/)
├── tests/                       # node --test, mirrors extension/lib names
└── scripts/                     # fetch-vendor, serve, build-manifest (if needed), aggregate
```

## Rules

1. **One source of truth for privacy logic:** only `extension/lib/*.mjs`. No `.js` copies. A test fails if a `lib/*.js` twin appears.
2. **Single egress door:** only `background/egress.js` + `background/api-client.js` may call `fetch` to the server. A grep-based test enforces this.
3. **Vault never in page context:** page scripts ask the service worker to resolve a token; they do not hold the vault.
4. **No secrets in the extension.** API keys only in `server/.env`.
5. **Tests mirror modules:** `tests/<module>.test.mjs` for `lib/<module>.mjs`.
6. **Fixtures are static HTML** served by `scripts/serve.mjs`; no external network required for the demo.
7. **Docs reference code by path;** if a path moves, update docs in the same change.

## npm / script commands (proposed)

| Command | Purpose |
|---|---|
| `npm run fetch:vendor` | download pinned OCR assets with checksum |
| `npm test` | `node --test "tests/**/*.test.mjs"` |
| `npm run bench` | detection benchmark (seeded) |
| `npm run sec:lab` | adversarial pages scoring |
| `npm run serve:fixtures` | static server for fixtures |
| `npm run server` | start FastAPI (documented command, not hidden in a script) |

Python: `server/requirements.txt`, tests via `pytest server/tests`. Exact Python version pinned in README after Phase 0 **[VERIFY]**.

## `.gitignore` (initial)

```
node_modules/
.venv/
venv/
__pycache__/
*.pyc
.env
.DS_Store
extension/vendor/*
!extension/vendor/README.md
eval/out/
.pytest_cache/
```

## Permission justification table (to fill in Phase 0/7)

| Permission | Needed for | Could it be optional? |
|---|---|---|
| `activeTab` | screenshot + injection on user-invoked tab | no |
| `scripting` | inject content scripts on demand | no |
| `storage` | profile, vault, settings | no |
| `offscreen` | OCR worker document | no **[VERIFY]** |
| `sidePanel` | UI | yes (popup) |
| host `http://127.0.0.1:8000/*` | call FastAPI | no |
| `tabs` | navigate/open_tab | maybe — `chrome.tabs.update` on the active tab may not need it **[VERIFY]** |
| `<all_urls>` | run on arbitrary sites | **prefer optional host permissions**; decide Q10 |
