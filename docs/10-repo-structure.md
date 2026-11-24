# 10 — Repository Structure

Target repo: this repository, `main` branch.
Layout is a proposal **[ASSUMPTION]**.

```
Mikoshi/
├── README.md                    # setup, run, tests, honest limits
├── package.json                 # scripts only; no runtime dependencies
├── docs/                        # design docs; 14-build-status.md is the current state
├── extension/                   # Chrome MV3 extension
│   ├── manifest.json
│   ├── background/              # service worker (ES modules)
│   │   ├── index.js             # wires Chrome APIs to the orchestrator
│   │   ├── orchestrator.js      # the agent loop (all I/O injected)
│   │   ├── egress.js            # the single egress door
│   │   ├── response-validation.js
│   │   ├── api-client.js        # the only module that talks to the server
│   │   ├── storage.js  tabs.js  vision.js
│   ├── content/                 # page code, injected on demand
│   │   ├── loader.js  main.mjs  perceiver.mjs  executor.mjs
│   ├── panel/                   # side panel: panel.html  panel.css  panel.js
│   ├── lib/                     # privacy core: ONE copy, ESM
│   │   ├── pii-checksums  pii-config  pii-rules  secret-scanner  sensitive-fields
│   │   ├── field-classifier  label-assoc  dlp-heuristics  dlp-sanitizer  tokenizer
│   │   ├── payload-walk  canary  security-policy  egress-guard  adversarial-guard
│   │   ├── url-risk  action-firewall  merge  redact  redaction-verify   (all .mjs)
│   └── vendor/                  # gitignored; OCR assets (not yet wired, see docs/14)
├── server/                      # main.py  schema.py  vlm.py  prompts/  tests/
├── fixtures/                    # kyc/  portal/  hostile/
├── eval/bench/                  # seeded detection benchmark
├── tests/                       # node --test, mirrors extension/lib names
└── scripts/                     # serve.mjs  browser-check.mjs  e2e.mjs
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
