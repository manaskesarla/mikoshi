# 05 — Tech Stack

Stack from the deck **[DECK S4]**: JavaScript/HTML/CSS extension, DOM + Accessibility APIs, Python + FastAPI, regex/PII/redaction/tokenisation, browser local storage. Everything below stays inside that, adding only what the MVP needs.

**Rule for versions:** no version number or model ID in this doc is a claim from memory. Items marked **[VERIFY]** must be checked against the current official docs/registry at the start of Phase 0 and pinned in the repo.

## 1. Extension (client)

| Concern | Choice | Why | Source / alternative rejected |
|---|---|---|---|
| Platform | Chrome Manifest V3 | Deck: Chrome MVP first. [DECK S8] | Firefox build is Roadmap. |
| Language | Plain JavaScript, ES modules (`.mjs`) | Deck; no build step and no runtime dependencies. | TypeScript: nicer, but adds a build step and risk in 48 h. |
| Bundler | **None for MVP** | Load ESM into content scripts through dynamic `import(chrome.runtime.getURL(...))` with `web_accessible_resources`. **[VERIFY pattern & CSP]** | If the pattern fails in Phase 0, fall back to `esbuild` as a dev dependency to emit an IIFE for content scripts. |
| UI | HTML + CSS + vanilla JS in a **side panel** | Persistent view for live activity + approvals. **[ASSUMPTION]** Needs `sidePanel` permission **[VERIFY availability/permission]**. | A popup closes on focus loss and loses the live log. Q4. |
| Page perception | DOM traversal + accessibility attributes (roles, `aria-*`, labels) | Deck: DOM and Accessibility APIs. [DECK S4] | Chrome DevTools Protocol accessibility tree needs `debugger` permission — too broad for "minimal permissions" [DECK S7]; not chosen. |
| OCR | Tesseract.js WASM, run in an **offscreen document** | Keeps OCR off the service worker. **[VERIFY]** versions via `scripts/fetch-vendor.mjs` | Cloud OCR rejected (violates privacy). |
| Face/person detection | MediaPipe BlazeFace, YOLOS-tiny (transformers.js) | Optional extra perception layer. | **Stretch** (heavy; not in the deck's MVP path). |
| Storage | `chrome.storage.local` | Deck. [DECK S4] | IndexedDB if vault grows; not needed. |
| Permissions | `activeTab`, `scripting`, `storage`, `offscreen`, `sidePanel`; host access for the FastAPI URL; page access requested per site | Deck: minimal permissions. [DECK S7] | Q10: is `<all_urls>` acceptable for the demo? |

## 2. Privacy core (built in Phase 1, see doc 03)

| Concern | Choice | Source |
|---|---|---|
| Detection | Regex rules + checksums (Verhoeff, Luhn, etc.) + context scoring | `pii-rules.mjs`, `pii-config.mjs`, `pii-checksums.mjs` |
| Secrets | Vendor patterns + entropy | `secret-scanner.mjs` |
| Tokenization | `Vault` class | `tokenizer.mjs` |
| Redaction | Canvas blackout from fused boxes | `redact.mjs`, `merge.mjs` |
| Verification | Re-OCR + re-detect, one extra pass, else fail | `redaction-verify.mjs` |
| Policy | `classifyPayload`, `classifyAction`, canaries, adversarial guard | `security-policy.mjs`, `action-firewall.mjs`, `canary.mjs`, `adversarial-guard.mjs` |

No new detection library is added in MVP. ML-based PII tools (e.g. Presidio, spaCy) may be used **offline** as a benchmark comparison only, never as runtime dependencies.

## 3. Backend (server)

| Concern | Choice | Why / source |
|---|---|---|
| Language/framework | Python, FastAPI, Uvicorn | Deck. [DECK S4] Planned dependencies: `fastapi`, `uvicorn[standard]`, `pydantic` (v2), `python-dotenv`, `httpx`, `certifi`; versions **[VERIFY]**. |
| Python version | **[VERIFY]** — developer machine has Python 3.11.5. Pin the version in README. |
| VLM adapters | `gemini` (HTTP via `httpx`), `mock` (deterministic) in MVP | [USER] |
| Model ID | **[VERIFY]** against Google's current model list before use. Keep it in `.env` (`VLM_MODEL`); never hard-code a default without a check. |
| Config | `.env` + `.env.example`; keys only on the server | Standard practice. |
| Validation | Pydantic models for request/response | |
| Stateless | No DB in MVP | Billing/accounts are roadmap. |

## 4. Testing and tooling

| Concern | Choice | Source |
|---|---|---|
| JS tests | `node --test` (built-in `node:test`) | `npm test`. Node version **[VERIFY]**. |
| Python tests | `pytest` | `server/tests/`. |
| Browser end-to-end | Manual scripted run for MVP; Playwright with the extension loaded is **Stretch** **[VERIFY feasibility]** | — |
| Lint/format | None mandated; add only if time remains | — |
| Fixtures | Static HTML served by a tiny Node static server | `scripts/serve.mjs`. |
| CI | GitHub Actions running both test suites | Stretch. |

## 5. Dev environment

- macOS (current machine: Darwin).
- Node (current LTS) **[VERIFY]**, Python 3.11 or 3.12 **[VERIFY]**, Google Chrome (current stable).
- Repo: this repository (`main` branch). **[verified: .git/config]**
- Secrets: `.env` in `server/`, gitignored. Never in the extension.

## 6. Alternatives considered and rejected

| Option | Rejected because |
|---|---|
| Server-side OCR | Raw screenshots would leave the device before redaction. |
| Direct browser → Gemini call | Puts an API key in the extension; harder to audit egress. MVP routes through FastAPI. |
| LangChain / agent frameworks | Extra weight, little value for a loop of this size, more hidden egress. |
| Headless browser automation (Playwright) as the product | Deck's product is an in-browser extension; automation frameworks are only a test tool. |
| ML-based PII (Presidio/NER) in the extension | Heavy for MV3; unclear benefit versus tested regex+checksum+context. Revisit for Roadmap. |
| Desktop app | Deck: not needed for v1. [DECK S7] |
