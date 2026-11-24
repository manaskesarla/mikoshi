# 14 — Build Status

What exists, how it was verified, and what is not done. Updated after each build step. Everything marked "verified" was actually run; nothing here is assumed.

## Built and verified

| Area | What | Verified by |
|---|---|---|
| Privacy core (`extension/lib/`) | PII checksums, detection engine, secret scanner, sensitive-field sets, field classifier, label association, tokenizer/vault, text and skeleton sanitizers, canaries, security policy, egress guard, adversarial guard, URL risk, action firewall, box fusion, canvas redaction, redaction verify gate | 172 Node tests; checksum code cross-checked against an independently written implementation on 2,000 random numbers |
| Detection benchmark | Seeded corpus, independent validators, scorer | `docs/results/bench-baseline.md` (precision 99.7%, recall 88.4%, OCR-garbled recall 33.8%; unlabelled dates are skipped by design) |
| Server | FastAPI app, strict schemas, mock model, Gemini adapter, plan validation, key check, canary rejection, CORS limits, no body logging | 44 pytest tests; started for real and queried |
| Orchestrator | The agent loop with a single egress door, plan validation, firewall and approvals, loop guards, extraction, navigation | 21 tests with fakes |
| Page code | Perceiver and executor | `npm run browser-check` in headless Chrome against the fixtures |
| Extension | Manifest, service worker, storage, API client, tabs, side panel (task, activity, approvals, what-was-sent, profile validation, settings) | `npm run e2e`: the real extension loaded in Chrome, driving the real server; 36 checks |
| Demos | KYC form fill and submit; read-only portal question | e2e. Includes: no raw personal value in any request body or in the stored log; the hidden-injection page forces approval; denying an approval leaves the form unsent |

## Not built, or not verified

| Item | State |
|---|---|
| Screenshot, OCR and redaction in the extension | **Not built.** `extension/background/vision.js` is DOM-only; `useScreenshot` throws. The redaction/verify modules exist and are unit-tested with a fake canvas and fake OCR, but nothing wires Tesseract in. Needs `scripts/fetch-vendor.mjs`, an offscreen document and real OCR measurements |
| Real Gemini call | **Not verified.** The adapter is tested against a fake HTTP transport only. The request shape is marked `[VERIFY]` in `server/vlm.py`. No model ID is hard-coded |
| Face/person detection, OpenAI/local adapters | Stretch, not built |
| Server-side second PII pass | Stretch, not built |
| Vault encryption at rest | Not built (open question Q8) |
| Profile "ask every time" for restricted fields | Not built; approval modes cover it only partly |
| `optional_host_permissions` flow | The manifest declares it, but the UI does not request site access yet. Navigation across sites other than `127.0.0.1`/`localhost` is untested |
| Latency, OCR accuracy, real-page behaviour | Not measured |
| LICENSE | Not chosen (Q9) |

## Known issues

- During development the e2e run stalled once, with no result event even though the service worker reported the task as finished. It passed in the next five runs and could not be reproduced. A Chrome auto-update happened while it was running. Treat the e2e as reliable but keep an eye on it; if the task state ever disappears mid-run, suspect the service worker restarting.
- Chrome (v137+) ignores `--load-extension`; the e2e uses `Extensions.loadUnpacked` over a debugging pipe instead.

## Deviations from the plan

- The side panel is one file (`panel.js`) instead of the `components/` folder in doc 10.
- `search` is implemented as "fill the page's own search box"; there is no fallback search-engine URL.
- Step numbering in practice: privacy core (steps 1–8), server (9), orchestrator (10), fixtures (11), page code (12), extension wiring and e2e (13), side panel (14), docs (15).
