# 07 — Feature Specifications

Each feature has: purpose, requirement link (doc 02), behaviour, acceptance criteria (AC), and dependencies. Status MVP unless stated.

---

## F-PERCEIVE — Page understanding (R1)

**Behaviour.** The content script builds a **skeleton**: a list of nodes for interactive and informative elements, with `id` (stable per scan), `tag`, `type`, `role`, `label` (via label association), `name`, `required`, `state` (`empty/filled/readonly`, never the value), `visible`, `bbox`, `options` for selects, `text` for headings/cells, `isSubmit`, `href`, form action/origin, `piiCategory`, `isCensored`. Also page `url`, `title`, viewport, scroll. Reuse the shape in.
Additions for Mikoshi: `href` and `formOrigin` fields (used by the firewall), `landmark` (nav/main/footer from roles), and `textBlocks` for read-only extraction.

**AC**
- P1. On `fixtures/kyc.html` every input appears with a correct label and category (Aadhaar, PAN, name, phone, email).
- P2. No field **value** appears in the skeleton; only `empty/filled/readonly`.
- P3. Hidden elements (`display:none`, off-screen, zero size) are flagged `visible:false` and not offered as targets.
- P4. Shadow DOM and same-origin iframes are traversed **[ASSUMPTION: same-origin only; cross-origin iframes marked unreadable]**.
- P5. Build time under 300 ms on a 500-element page **[ASSUMPTION threshold; measure]**.

**Depends on:** `field-classifier.mjs`, `label-assoc.mjs`, `sensitive-fields.mjs`.

---

## F-PRIVACY-CORE — Detect and redact (R2)

**Behaviour.** Detect PII in (a) DOM text, (b) field values (locally only), (c) OCR text; fuse boxes (IoU merge); draw solid black boxes on the screenshot; also censor sensitive DOM fields before the screenshot is taken if possible (`dom-redactor`).

**AC**
- D1. `pii-rules`, `pii-config`, `independent-validators`, `secret-scanner`, `merge` tests written and green.
- D2. A screenshot of `kyc.html` with a filled Aadhaar and PAN has both regions masked.
- D3. Precision/recall on the seeded benchmark corpus are recorded in `docs/results/` at Phase 1 and must not regress between commits.
- D4. The redacted PNG, re-OCRed in tests, yields no Aadhaar/PAN pattern.

---

## F-VERIFY-GATE — Recheck before transmission (R3)

**Behaviour.** `verifyRedaction` on the masked image; one bounded extra mask pass; failure → `REDACTION_FAILED` and egress blocked. Plus final `classifyPayload` over the exact request JSON.

**AC**
- V1. Test hook injects an unmasked Aadhaar into the image → gate fails → **zero** network calls made (assert with a fetch spy).
- V2. Test hook injects a canary into the skeleton → `BLOCK`.
- V3. Gate adds < 1.5 s on the demo page **[ASSUMPTION threshold; measure in browser]**.
- V4. Every block is recorded in the activity log with reason code and **no** raw value.

---

## F-TOKEN-VAULT — Tokenization (R4) **[USER]**

**Behaviour.** As doc 06 §3. Profile values are added on load; detected values on each scan. Skeleton, goal and history are token-substituted before egress. Executor resolves `fillToken` locally.

**AC**
- T1. After `vault.addProfile`, `redactText("my pan is ABCDE1234F")` returns `my pan is [PAN_1]`.
- T2. Request body captured in an integration test contains `[AADHAAR_1]` and not the 12-digit value in any spacing.
- T3. Executor types the real value into the field; DOM check shows the value; the value is absent from logs and from any `postMessage` to the UI.
- T4. Unknown token in a model action is rejected.
- T5. Vault round-trips through `serialize/deserialize`.

---

## F-AGENT-LOOP — Multi-step agent (R5)

**Behaviour.** Orchestrator implements the loop in doc 04 §3 with: step cap (default 12 **[ASSUMPTION]**), wall-clock cap, stop button, stagnation guard, repeat-plan guard, per-step retry rules, `history` with tokenized summaries.

**AC**
- L1. Mock-model run of the KYC task finishes in the expected number of steps.
- L2. Stop button halts before the next network call and before the next action.
- L3. A model that returns the same non-terminal plan twice triggers the repeat guard.
- L4. Step and time caps enforced in tests with a fake clock.

---

## F-NAVIGATE / F-SEARCH / F-EXTRACT — Beyond forms (R5) **[USER]**

New actions beyond basic form filling.

| Action | Parameters | Executor behaviour | Firewall |
|---|---|---|---|
| `navigate` | `url` (literal) | `chrome.tabs.update`; waits for load; re-perceive | `urlRisk`; off-site → HIGH; PII in URL → CRITICAL |
| `open_tab` | `url` | new tab; orchestrator tracks active tab | same |
| `search` | `query` (sanitized text) | type into the page's search input if one is present (label/role heuristic) and submit; otherwise navigate to a configured search URL **[ASSUMPTION: only a local fixture search in MVP]** | `classifyPayload` on query; submit rules apply |
| `extract` | `name`, `targetIds[]` | read text of nodes; store in `extracted[name]`; tokenise | ALLOW (read-only) |
| `ask_user` | `question` | show in panel, await reply | ALLOW |

**AC**
- N1. On the portal fixture, "go to Fees and tell me the due date" completes with correct extracted text.
- N2. `navigate` to a URL containing an Aadhaar-like value is blocked.
- N3. `navigate` to an off-origin host asks for approval.
- N4. Extracted content containing PII is tokenized in `history`; the panel shows real values only locally.
- N5. `read_only` mode refuses any `type`, `submit`, `upload`, `download` action.

---

## F-VLM-ADAPTERS — Model-agnostic backend (R9) **[USER]**

**Behaviour.** `VLM_MODE` = `gemini` | `mock` (MVP); `openai` | `local` (Stretch). Adapter contract: `run(StepRequest) → StepResponse` or raise `VLMUnavailable`. No silent fallback.

**AC**
- M1. `/health` reports mode and model; `mock_fallback:false` stays false.
- M2. With `VLM_MODE=mock` the KYC and portal tasks complete deterministically.
- M3. With `VLM_MODE=gemini` and a bad key the server returns 503 and the client stops (test with a stubbed HTTP layer).
- M4. Response JSON is parsed leniently (extract the JSON object from model text) but validated strictly (Pydantic).

---

## F-ACTION-FIREWALL — (R11)

As doc 06 §5. **AC**
- A1. `tests/action-firewall.test.mjs` green.
- A2. New tests for `navigate`, `open_tab`, `search`, `extract`, unknown action.
- A3. Every decision carries `reasons[]` with no raw values.

---

## F-APPROVALS — Step-by-step approvals (R6)

**Behaviour.** Side-panel card per pending action with risk badge and reasons; **Approve once / Deny / Stop**. Modes: *Ask for every action*, *Ask for risky actions* (default), *Read-only*.

**AC**
- AP1. In "ask for every action" mode, no action executes without a click (test via UI harness).
- AP2. CRITICAL actions have no Approve button.
- AP3. Pending approval survives side-panel close/reopen (state in SW/storage) **[ASSUMPTION]**.

---

## F-ACTIVITY-LOG — Live activity tracking (R7)

**Behaviour.** Timeline: step n, phase (perceive, redact, verify, send, plan, firewall, execute), result, latency, tokens shown not values, egress summary (categories removed, bytes sent). Exportable as JSON without raw values.

**AC**
- LG1. Each loop phase emits an event; UI shows them in order within 200 ms of occurrence.
- LG2. "What was sent" view shows the exact outgoing payload with tokens (the user can inspect it).
- LG3. Export contains no raw PII (test with canary).

---

## F-PROFILE — Profile management (R8)

**Behaviour.** Editor for fields: full name, first/last name, email, phone, DOB, address, PIN, Aadhaar, PAN, optionally bank/IFSC. Validation uses the same checksums (Verhoeff for Aadhaar, PAN structure). Saved in `chrome.storage.local`. Each field has a **"allow auto-fill"** switch and a **"restricted"** marker (Aadhaar, PAN default to *ask every time*).

**AC**
- PR1. Invalid Aadhaar (fails Verhoeff) shows an inline error.
- PR2. Export/Import profile as JSON (local file). **[ASSUMPTION]** and "Delete all data" wipes storage.
- PR3. Disabled field is never added to the vault or used by the agent.

---

## F-SANITIZED-CONTEXT — (R10)

Everything sent is: tokenized goal, sanitized skeleton, redacted screenshot, history of tokenized summaries, vault context (token→category). **AC**: schema test + egress test (S2 in doc 01).

---

## F-PERMISSIONS — Minimal permissions (R12)

**Behaviour.** Manifest requests the smallest set that works; host access requested at runtime per site where possible. **AC**: manifest lint test lists permissions; each has a one-line justification in `docs/10-repo-structure.md` or the README. **Open:** Q10.

---

## F-STORAGE — Local storage (R13)

Schema in doc 08. **AC**: round-trip, versioned migration stub, "Delete all data".

---

## F-SERVER — FastAPI service (R14)

Endpoints `/health`, `/privacy`, `/agent/step`. **AC**: contract tests; CORS restricted; no body logging (test with log capture); `/privacy` text matches behaviour.

---

## Stretch features

| ID | Feature | Notes |
|---|---|---|
| X1 | Face/person detection | Optional extra perception layer |
| X2 | OpenAI/OpenRouter adapter | Second hosted adapter |
| X3 | Local VLM adapter | Needs model choice (Q5) |
| X4 | DPDP audit view | `dpdp-audit.mjs` |
| X5 | Vault encryption at rest | passphrase-derived key; **[VERIFY WebCrypto usage]** |
| X6 | Playwright e2e with extension | Needs headed Chrome |
| X7 | Separate planning call | Doc 04 §4 |
| X8 | Server-side second PII pass | Doc 06 §7 |
