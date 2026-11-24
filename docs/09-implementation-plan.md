# 09 — Implementation Plan (≈48 hours)

Budget: **48 h of working time** **[USER: ~2 days]**, planned as 44 h of tasks + 4 h buffer. Day split is a suggestion: Day 1 = Phases 0–3, Day 2 = Phases 4–8. Times are estimates **[ASSUMPTION]**; re-plan at each phase gate.

| Phase | Name | Hours | Cumulative | Status |
|---|---|---|---|---|
| 0 | Repo, tooling, verification of versions | 3 | 3 | MVP |
| 1 | Build privacy core + tests | 6 | 9 | MVP |
| 2 | Perception + vision pipeline | 7 | 16 | MVP |
| 3 | Server + VLM adapters | 5 | 21 | MVP |
| 4 | Orchestrator, firewall, beyond-forms actions | 9 | 30 | MVP |
| 5 | Side-panel UI (approvals, activity, profile) | 6 | 36 | MVP |
| 6 | Demo fixtures + end-to-end runs | 5 | 41 | MVP |
| 7 | Hardening and measurement | 3 | 44 | Partly Stretch |
| 8 | Demo prep and pitch | (in buffer) | 48 | MVP |

**Cut-line.** If at hour 30 Phase 4 is not green, drop in this order: Phase 7 measurements → profile import/export → face detection → search action → `open_tab`. Never drop: tokenization, verify gate, firewall, KYC demo, mock adapter.

Each step lists: **Goal · Do · Done when · Risk**.

---

## Phase 0 — Repo, tooling, version verification (3 h)

**0.1 Initialise repo layout.** Create folders per doc 10. Add `.gitignore` (node_modules, `.venv`, `__pycache__`, `.env`, `vendor/` except README, `eval/out`), `README.md` (link to docs), `LICENSE` (Q9).
- Done when: `git status` clean tree except new files; no commit made unless the user asks.

**0.2 Verify toolchain versions (all [VERIFY] items in doc 05).** Record results in `docs/05-tech-stack.md` "Verified versions" table: Node, Python, Chrome, Tesseract.js, FastAPI, Pydantic, httpx, Gemini model ID and request format, `sidePanel`/`offscreen` APIs.
- Done when: every [VERIFY] has a value and a source URL, or is moved to Q-list.

**0.3 Manifest skeleton.** MV3 manifest with service worker, side panel, offscreen permission, content script stub, CSP allowing `wasm-unsafe-eval` for OCR.
- Done when: extension loads in `chrome://extensions` with no errors; side panel opens.

**0.4 Prove the ESM-in-content-script pattern.** A content script dynamically imports a module from `lib/` through `chrome.runtime.getURL` (needs `web_accessible_resources`). If it fails, adopt `esbuild` and update doc 10.
- Done when: a test page logs output from an imported ESM function.

**0.5 `scripts/fetch-vendor.mjs`.** Download pinned OCR assets with SHA-256 checks.
- Done when: running it twice is idempotent; checksum mismatch fails.

*Risk:* time lost on ESM/CSP. Mitigation: timebox 45 min, then bundle.

---

## Phase 1 — Build the privacy core (6 h)

**1.1 Implement the privacy-core modules and their tests** (module list and behaviour in doc 03): `pii-rules, pii-config, pii-checksums, secret-scanner, sensitive-fields, field-classifier, label-assoc, dlp-heuristics, dlp-sanitizer, tokenizer, redact, merge, redaction-verify, egress-guard, security-policy, canary, adversarial-guard, action-firewall, dpdp-audit`. Write each test file first from the acceptance rules in doc 03.
- Done when: `node --test` passes for every module.

**1.2 Single ESM source of truth.** Ensure no classic-script `.js` copies of `.mjs` modules exist (doc 10 rule 1) and add the `no-js-twins` test.
- Done when: `grep -R "sensitive-fields.js"` returns nothing; tests still green.

**1.3 Tokenizer extensions.** Add: test for overlapping values; `forgetSource("screen")` to clear per-task entries; `maskForDisplay(token)`; optional `encrypt/decrypt` hook interface (impl Stretch).
- Done when: new tests green.

**1.4 `url-risk.mjs`.** Pure function `urlRisk(url, ctx) → {trust:0..1, reasons[]}`: https required, IP-literal host, punycode, `@` in authority, known trusted origins, user trusted sites. Tests for each.
- Done when: `action-firewall` + `security-policy` consume it via `ctx.destinationTrust`.

**1.5 Firewall extensions.** Add `search`, `extract`, `ask_user`; change unknown action default to BLOCK; add tests.
- Done when: matrix in doc 06 §5 is covered by tests.

**1.6 Detection benchmark.** Write a seeded corpus generator (`eval/bench/gen-corpus.mjs`), a runner (`run.mjs`) and independent validators (`lib/independent-validators.mjs`) so detection is not graded by its own code; add `npm run bench`.
- Done when: the same seed gives identical numbers; baseline precision, recall, F1, unlabelled-value recall and leakage are recorded in `docs/results/`.

*Risk:* modules depend on each other. Mitigation: implement in dependency order (checksums → config → rules → scanner → tokenizer → policy); fail fast on missing import.

---

## Phase 2 — Perception and vision (7 h)

**2.1 Skeleton builder (`content/perceiver.js`).** Reimplement from `skeleton.js` ideas: node scan, label association, a11y roles, bbox, visibility, same-origin iframe, shadow DOM. Add `href`, `formOrigin`, `formCrossOrigin`, `landmark`.
- Done when: AC P1–P4 (doc 07) pass on `fixtures/kyc.html`.

**2.2 Page text extraction + adversarial scan.** Gather visible text blocks; run `scanAdversarialVectors`.
- Done when: `security-lab/05` and `06` pages are classified suspicious/malicious.

**2.3 Executor (`content/executor.js`).** `type` (set value + dispatch `input/change` events so frameworks notice), `click`, `select`, `scroll`, `submit`, `wait`. Token resolution happens via a call to the SW's vault, not a copy of the vault in the page. **[ASSUMPTION: vault lives in SW to keep it out of page context]**
- Done when: on `kyc.html`, executing a `type` with a token fills the field and fires events.

**2.4 Offscreen OCR + redaction.** Implement `vision-pipeline.mjs` (OCR + DOM boxes only), `redact.mjs`, `merge.mjs`; message API `MIKOSHI_VISION`.
- Done when: sample screenshot with PII returns masked image and boxes.

**2.5 Verify gate wiring.** Run `verifyRedaction` using the same OCR worker.
- Done when: V1 (doc 07): unmasked PII → failure → no network call.

*Risk:* OCR speed and WASM loading in MV3. Mitigation: warm up the worker at task start; show progress; keep image size capped.

---

## Phase 3 — Server and VLM adapters (5 h)

**3.1 Server skeleton.** FastAPI app, `/health`, `/privacy` (corrected), CORS restricted, shared-secret dependency, request-size limit, no body logging.
- Done when: `pytest` contract tests pass.

**3.2 Schemas.** Pydantic models per doc 08 incl. new actions and `mode`, `extracted`, `vaultContext`, `summary`.
- Done when: schema tests cover valid/invalid examples.

**3.3 Mock adapter.** Deterministic scripted behaviour for (a) KYC fill using tokens and (b) portal navigation+extraction.
- Done when: running the loop against the mock completes both demos in tests.

**3.4 Gemini adapter.** `httpx` call with screenshot + JSON context; strict response validation. **[VERIFY]** endpoint, model ID, JSON-mode parameters.
- Done when: with a real key, a smoke call on a sample page returns valid actions; with a bad key → 503.

**3.5 System prompt.** Write per doc 08 §5. Include few-shot examples with tokens.
- Done when: manual run on both fixtures yields valid action sequences.

**3.6 Server canary check.** Reject requests that contain configured canary strings.
- Done when: test with canary returns 4xx and logs a safe message.

*Risk:* model returns malformed JSON or hallucinated targets. Mitigation: strict validation + one retry with an error hint, then fail.

---

## Phase 4 — Orchestrator, firewall, beyond-forms (9 h)

**4.1 Orchestrator state machine (`background/orchestrator.js`).** States: idle → perceive → redact → verify → egress → plan → firewall → (approval) → execute → loop/done/failed. Event emission per phase.
- Done when: unit tests with fake CS/OFF/API cover transitions and caps.

**4.2 Egress function.** Single `enforceEgress(payload)` doing: vault sanitize → `classifyPayload` → apply SANITIZE → recheck → return bytes or throw. The *only* caller of `fetch` to the server (lint test: grep).
- Done when: AC V2, T2.

**4.3 Response validation.** Schema, targets exist, tokens in vault, action allowed in current `mode`.
- Done when: hallucinated token and unknown target are rejected in tests.

**4.4 Firewall integration + approvals plumbing.** `classifyAction` with `ctx` (target node, resolved value (local), page origin, page malicious, destination trust). Pending-approval store; `MIKOSHI_APPROVAL_*`.
- Done when: BLOCK/REQUIRE_APPROVAL/ALLOW flows tested.

**4.5 `navigate`, `open_tab`.** Tab management, load wait, re-perceive, history update, `urlRisk`.
- Done when: N1, N3.

**4.6 `search`.** Heuristic to find a search input in the skeleton; fill + submit; fallback `ask_user`.
- Done when: portal fixture search works.

**4.7 `extract` + `summary`.** Extraction store, tokenization of extracted text, final summary rendering with local re-insertion.
- Done when: N4.

**4.8 Loop guards.** Step cap, wall clock, stagnation, repeat-plan, stop.
- Done when: L1–L4.

**4.9 Mode `read_only`.** Enforce at validation and firewall.
- Done when: N5.

*Risk:* most complex phase. Mitigation: 4.1–4.4 first (needed for KYC demo); 4.5–4.9 are the "beyond forms" increment.

---

## Phase 5 — Side-panel UI (6 h)

**5.1 Shell + settings.** Server URL, shared key, approval mode, step cap, DOM-only toggle; "Test connection" calls `/health`.
- Done when: bad URL shows a clear error.

**5.2 Task input + controls.** Goal box, mode toggle (Act / Read-only), Start/Stop.
- Done when: starting a task emits events.

**5.3 Live activity timeline.** Render `MIKOSHI_EVENT`s; expandable "what was sent" view showing the exact payload with tokens.
- Done when: LG1–LG3.

**5.4 Approval cards.** Risk badge, reasons, Approve once/Deny/Stop; CRITICAL has no approve.
- Done when: AP1–AP3.

**5.5 Profile editor.** Fields with validation (Verhoeff for Aadhaar, PAN pattern), autofill switch, restricted marker; delete-all.
- Done when: PR1–PR3.

**5.6 Result view.** Show extracted data and summary with local re-insertion; copy button.
- Done when: demo B renders correctly.

*Risk:* UI polish consumes time. Mitigation: plain CSS, one screen, accessible defaults.

---

## Phase 6 — Fixtures and end-to-end (5 h)

**6.1 KYC fixture portal.** Build `fixtures/kyc/`; include name, DOB, Aadhaar, PAN, phone, email, address, a consent checkbox, and a submit that posts to the same origin. Add `data-gt` ground-truth attributes for tests.
**6.2 Info portal fixture (demo B).** Multi-page: home → menu (Admissions, Fees, Results) → fees table → search box. Include a "Pay now" trap link and a hidden prompt-injection div.
**6.3 Hostile pages.** Write 3–4 adversarial pages (injection visible/hidden, malicious form, executable download) and add a malicious-navigation page.
**6.4 Scripted e2e runs (manual first).** Checklist run with mock, then Gemini. Record pass/fail and time.
**6.5 Egress capture.** Run a local proxy or log the server's received body in debug mode (test-only) to assert S2.

Done when: success criteria S1–S6 (doc 01 §7) all pass at least once; S1 three times consecutively.

---

## Phase 7 — Hardening and measurement (3 h; trim first)

- 7.1 Real-browser measurements: OCR time, verify-gate time, round-trip, bytes sent. Record in `docs/11-testing-and-evaluation.md` results table.
- 7.2 Adversarial pass over security-lab pages; fix misses.
- 7.3 Permission audit; reduce if possible (Q10).
- 7.4 Error-path polish: server down, 503, OCR fail.
- 7.5 (Stretch) CI workflow.

---

## Phase 8 — Demo and pitch prep (inside buffer)

- 8.1 Rehearse demo script (doc 12) twice end to end, with mock and with Gemini.
- 8.2 Record a backup screen capture of a good run.
- 8.3 Prepare slides updates: replace deck slide 5 with the real architecture if desired; add measured numbers only if measured.
- 8.4 Freeze: tag the repository state **only if the user asks for a commit/tag**.

---

## Dependencies graph (critical path)

`0.3/0.4 → 1.1 → 2.1/2.3/2.4 → 2.5 → 3.x → 4.1–4.4 → 5.3/5.4 → 6.1 → 6.4`
Parallelisable: Phase 3 (server) can proceed while Phase 2 is in progress if two people work; Phase 5 UI can start once event shapes (doc 08 §2) are fixed.

## Suggested split for a team of 4 **[ASSUMPTION: deck lists four members]**

| Role | Owns |
|---|---|
| A — Privacy | Phase 1, verify gate, firewall rules, security tests |
| B — Extension core | Phases 2, 4 |
| C — Server/AI | Phase 3, prompts, adapter tests |
| D — UI/Demo | Phases 5, 6, 8 |

## Definition of done (project)

- All MVP rows in doc 01 §8 are implemented.
- `npm test` and `pytest` green.
- Success criteria S1–S6 pass.
- `13-open-questions.md` has no unanswered question marked "blocks MVP".
