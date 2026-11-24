# 01 — Vision and Scope

## 1. Problem **[DECK S2]**

- Browsing is still manual: people spend time on repetitive web tasks.
- Cloud AI agents that automate the web see the page, including sensitive data. Aadhaar, PAN, email, phone and financial details are exposed during automation.
- Affected groups named in the deck: students, banking users, citizens on government portals, employees and organisations.
- The deck contrasts existing approaches (traditional browsers, basic automation tools, cloud AI agents, traditional OCR) with their limitations. The table body was not captured when the slide was read, so the exact limitation wording is **not** reproduced here (see `13-open-questions.md` Q1).

## 2. Vision

> A browser agent that is allowed to *see and act* on the web, but is structurally unable to leak what is sensitive. **[DECK S3, S6]**

Three promises, each testable:

1. **Perceive locally** — page understanding uses DOM, accessibility APIs and on-device OCR. No page content goes to the cloud unless it has passed the privacy pipeline.
2. **Sanitize before egress, verify after** — detection + tokenization + redaction, then an independent recheck. If the recheck fails, nothing is sent (fail-closed).
3. **Act under control** — every action is validated by an Action Firewall; risky ones need the user's approval; the user sees a live activity log.

## 3. Beyond form filling **[USER]**

The deck frames the product as automating repetitive web tasks under the track "Beyond the Browser" **[DECK S2, S3, S1]**. Filling one form on one page is only the first use case. Mikoshi's scope:

| Capability | Mikoshi MVP |
|---|---|
| Fill a form on the current page | Yes (demo A) |
| Navigate to another page / open a link / search | **Yes (new action set)** |
| Multi-page task (several steps across pages) | **Yes (orchestrator keeps cross-page state)** |
| Read/extract information from pages and return it to the user | **Yes** |
| Tokenize values the cloud sees | **Yes (consistent end-to-end)** |
| Profile management UI | **Yes (explicit UI)** |
| Live activity tracking | **Yes (dedicated panel)** |
| Minimal permissions | **Yes (goal; see risk R4)** |

## 4. Users and primary scenarios

| User | Scenario | Source |
|---|---|---|
| Student | Fill scholarship / admission / KYC forms; look up status across a portal. | [DECK S2, S7] |
| Citizen on a government portal | Fill a KYC form with Aadhaar and PAN without exposing them to an AI cloud. | [DECK S2] [USER: KYC demo] |
| Banking user | Automate repetitive banking steps with the firewall blocking payments by default. | [DECK S2, S7] |
| Employee / business | Repetitive web workflows with approvals. | [DECK S2, S7] |
| Healthcare (secondary) | Less sensitive data exposure. | [DECK S7] Roadmap only |

## 5. Goals and non-goals

### Goals (MVP, 48 hours)

- G1. Chrome MV3 extension that completes a **Government/KYC form** end to end on a local fixture portal, with Aadhaar and PAN never reaching the server in clear text. **[USER]**
- G2. At least one **non-form task** (navigate menus, find and read information, return a summary) on a local fixture portal, to prove "beyond forms". **[ASSUMPTION: task choice, see Q3]**
- G3. Tokenization with local re-injection. **[USER]**
- G4. Fail-closed egress gate and Action Firewall with approval UI. **[DECK S3, S6]**
- G5. Live activity log and a profile editor. **[DECK S3]**
- G6. Gemini adapter plus a deterministic mock adapter, selectable by config. **[USER: Gemini + mock]**
- G7. Reproducible tests and a demo script that works offline with the mock model.

### Non-goals (MVP)

- No Firefox/Edge/Safari build (deck: "add more browsers" is later). **[DECK S8]**
- No desktop app. **[DECK S7: "no desktop app needed for v1"]**
- No payments, billing, accounts, or enterprise admin console (business model is roadmap). **[DECK S8]**
- No claim of "zero PII" as an absolute guarantee. The deck says "zero-PII cloud exposure with a fail-closed verification mechanism" **[DECK S6]**; pattern-based detection is never perfect (see section 6). The honest claim is "fail-closed: if verification finds PII, nothing is sent".
- OpenAI and local VLM adapters are **Stretch**. **[USER]**
- No real government portals. Automation targets local fixtures only (legal and ethical; also reliable for a demo). **[ASSUMPTION]**

## 6. Constraints and honest limits

- **Time:** ~48 hours. **[USER]**
- **Detection quality is bounded.** Pattern-based detection has known weak spots: values with no label next to them, and text garbled by OCR. Mikoshi measures recall, redaction leakage and bytes reaching the server in Phase 1 and Phase 7 and reports **only measured values**. The OCR, face and end-to-end latency figures are measured in a real browser, not estimated.
  Implication: the privacy design must rely on layered defence (field-level knowledge from the DOM, the user's own profile values matched exactly, redaction, recheck, fail-closed), not on regex alone.
- **No real-model benchmark yet.** Gemini behaviour on redacted screenshots is unmeasured; plan includes a smoke test (`11-testing-and-evaluation.md`).

## 7. Success criteria (demo-day)

| ID | Criterion | How measured |
|---|---|---|
| S1 | KYC demo completes with no manual typing of Aadhaar/PAN. | Run demo script (doc 12) three times in a row. |
| S2 | Network capture of the extension → server request contains no Aadhaar/PAN/phone/email value from the fixture. | Automated egress test + manual HAR inspection. |
| S3 | A deliberately leaky payload (test hook) is blocked by the gate. | Unit + integration test. |
| S4 | A hostile page (prompt injection, cross-origin form, executable download) is blocked or needs approval. | Adversarial fixture suite (doc 11 §6). |
| S5 | Non-form task returns a correct summary from fixture data. | Scripted check. |
| S6 | Demo works with `VLM_MODE=mock` and with Gemini. | Both run before demo. |

## 8. Scope table (MVP vs Stretch vs Roadmap)

| Item | Status |
|---|---|
| DOM + accessibility perception, OCR, redaction, verify gate | MVP |
| Tokenization + vault + local re-injection | MVP |
| Action Firewall + approvals + activity log | MVP |
| Profile editor (local storage) | MVP |
| Task planner (multi-step, multi-page) with navigate/extract/search | MVP |
| Gemini + mock adapters | MVP |
| Face detection / ViT person detection | Stretch |
| OpenAI / local VLM adapters | Stretch |
| DPDP audit report view | Stretch |
| Firefox build | Roadmap |
| Premium / enterprise / API | Roadmap [DECK S8] |
