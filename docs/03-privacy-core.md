# 03 — Privacy Core Design

The privacy core is a set of **pure ES modules** in `extension/lib/` with no runtime dependencies. They run in the service worker, content scripts and the offscreen document. Every module has a test file in `tests/` with the same name. Function names below are the planned public API **[ASSUMPTION: names may change during build; tests define the contract]**.

Build order follows the dependency order in the last section.

## 1. Detection

| Module | Responsibility | Public API (planned) | Acceptance rules |
|---|---|---|---|
| `pii-checksums.mjs` | Dependency-free validators: Verhoeff (Aadhaar), Luhn (cards), IIN prefix check, IBAN mod-97, SSN rules, bech32/base58 for crypto addresses | `verhoeffValid`, `luhnValid`, `cardIinOk`, `ibanValid`, `ssnValid`, `btcAddressValid` | Known-valid and known-invalid vectors for each; random single-digit mutations of valid values fail |
| `pii-config.mjs` | Data only: regex rules, context keywords, negative-context keywords, allow-lists (IFSC bank codes, RTO state codes, UPI handles), category list | `REGEX_RULES`, `CONTEXT`, `NEGATIVE_CONTEXT`, `CATEGORIES` | Every category has at least one positive and one near-miss negative test |
| `pii-rules.mjs` | Engine: normalize text (fold unicode digits, dashes, zero-width and fullwidth characters while keeping an offset map back to the original); find maximal digit runs and classify by length + checksum; run regex rules with context gating and a confidence score | `normalize(text)`, `detectPII(text, opts) → [{category, start, end, value, confidence, source}]` | Offsets map back to the original string; Aadhaar needs a valid Verhoeff checksum; PAN requires the structural pattern; a 12-digit number failing the checksum is not reported as Aadhaar |
| `secret-scanner.mjs` | Vendor secret patterns (cloud keys, tokens, private-key blocks, JWTs, connection strings, bearer headers) + entropy + nearby-context | `scanSecrets(text, {minConfidence})`, `shannonEntropy`, `maskSecret` | Evidence is always masked; high-entropy random strings without context stay below threshold |
| `sensitive-fields.mjs` | Category sets: **restricted** (never sent, never typed without approval) vs **profile** (autofill candidates) | `RESTRICTED_PII_CATEGORIES`, `PROFILE_PII_CATEGORIES`, `isRestrictedCategory`, `isSensitiveText` | Single source of truth, ESM only |
| `field-classifier.mjs` | Classify a form field from signals (type, name, id, autocomplete, label, placeholder, aria) into a category | `classifySignals(signals) → {category, confidence}` | Password, OTP, card, Aadhaar, PAN, phone, email fields classified from realistic markup |
| `label-assoc.mjs` | Associate each control with its label (for/id, wrapping label, aria-label/labelledby, adjacent text) | `associateLabels(root)` | Tested on fixtures with each labelling style |
| `dlp-heuristics.mjs` / `dlp-sanitizer.mjs` | Paragraph/goal sanitization; DOM-level field heuristics; label and nearby-context lookup | `sanitizeParagraphText`, `sanitizeTaskGoal`, `classifyFieldHeuristics` | A task goal containing a PAN leaves as `[PAN_1]`, not the value |

## 2. Tokenization

| Module | Responsibility | Public API (planned) |
|---|---|---|
| `tokenizer.mjs` | The **vault**: stable `[PREFIX_n]` tokens for real values. Sources: profile and detections | `Vault.add(value, category, source)`, `addProfile(profile)`, `addDetections(list)`, `tokenForValue`, `resolve(token)`, `categoryOf(token)`, `redactText(text)`, `exportContext()` (token → category only), `serialize()` / `Vault.deserialize()`, `forgetSource(source)`, `maskForDisplay(token)` |

Rules:
- Prefix map covers: first/last/full name, email, phone, address, PIN, DOB, Aadhaar, PAN, passport, SSN, card, CVV, card expiry, bank account, IFSC, UPI, voter ID, vehicle registration, GSTIN, password, username, government ID, IP, face.
- Same normalized value → same token (case and whitespace insensitive).
- `redactText` replaces longest values first; digit runs match regardless of spacing (`2345 6789 0124` = `234567890124`).
- `exportContext()` never contains values.
- Tests: overlapping values (a phone number contained in a longer number), round-trip serialization, token collision, `forgetSource("screen")`.

## 3. Redaction and verification

| Module | Responsibility | Public API (planned) |
|---|---|---|
| `merge.mjs` | Fuse boxes from DOM, OCR and optional vision by IoU; compute redundancy stats | `mergeDetections(lists)`, `iou(a, b)` |
| `redact.mjs` | Draw solid black boxes on a canvas; score residual leakage for decided regions | `redactCanvas(canvas, boxes)`, `leakScore` |
| `redaction-verify.mjs` | **The recheck.** Re-OCR the already-masked canvas, re-run detection + secret scan at a paranoid threshold, grow offending boxes, mask once more, re-verify. Still leaking → `REDACTION_FAILED` (caller must not send). Bounded to one extra pass. OCR is injected so the module stays pure | `verifyRedaction({canvas, ocr, boxes}) → {ok, passes, residual}` |

Tests: unmasked PII is caught; a box drawn too small is grown; clean image passes in one pass; a failing OCR function fails closed.

## 4. Policy

| Module | Responsibility | Public API (planned) |
|---|---|---|
| `canary.mjs` | Generate unique canary strings, find them in any payload | `generateCanaries`, `findCanaries`, `assertNoCanaryEgress` |
| `security-policy.mjs` | One decision point for outgoing payloads. Walks all string fields (skipping structural keys), combines PII, secrets, exact profile values, canaries | `classifyPayload(payload, ctx) → {decision: ALLOW|SANITIZE|BLOCK|REQUIRE_APPROVAL, classification, findings[], sanitized, reasons[]}` |
| `egress-guard.mjs` | Thin assertion wrapper used right before `fetch` | `assertNoSensitivePayload(payload)` |
| `adversarial-guard.mjs` | Prompt-injection phrases, hidden-style tricks (zero-size, off-screen, same-colour text), leetspeak/obfuscation, data-vs-instruction separation; classify a page `BENIGN | SUSPICIOUS | MALICIOUS` | `detectPromptInjection`, `detectHiddenStyles`, `scanAdversarialVectors`, `classifyContent` |
| `action-firewall.mjs` | Rule engine for proposed actions (rules in doc 06 §5) | `classifyAction(action, ctx) → {risk, decision, reasons[], exfil}` |
| `url-risk.mjs` | **New.** Destination trust score | `urlRisk(url, ctx) → {trust, reasons[]}` |
| `dpdp-audit.mjs` | Map categories to DPDP concepts; audit report (Stretch UI) | `classifyDPDP`, `generateDPDPAuditReport` |

`classifyPayload` precedence (most severe wins): canary → BLOCK; blocking secret → BLOCK; restricted PII → BLOCK; approval-level secret → REQUIRE_APPROVAL; low-trust destination + personal data → REQUIRE_APPROVAL; any other PII or profile value → SANITIZE; nothing → ALLOW. Evidence in findings is always masked.

## 5. Vision

| Module | Responsibility |
|---|---|
| `vision-pipeline.mjs` | Orchestrates OCR + DOM boxes (+ optional face/person detection, Stretch) and returns fused boxes and a redacted image; runs in the offscreen document |
| `vision-transformer.mjs` | Optional person detector (Stretch) |

## 6. Cross-cutting design decisions

1. **Pure functions, injected I/O.** OCR, clock, randomness and storage are passed in, so every module is testable under `node --test` without a browser.
2. **Fail closed.** Errors inside any privacy module surface as a block, never as "allow".
3. **No raw values in findings, logs or errors.** Evidence is masked at the source.
4. **One implementation.** ESM only; no parallel classic-script copies. A test enforces it (doc 10, rule 1).
5. **Independent validators in tests.** The benchmark and tests use separately written checksum code so a bug in the production validator cannot hide itself.

## 7. Known weak spots to design tests around

- Values without a label next to them (no context keywords).
- OCR-garbled digits (O/0, l/1, S/5, split lines).
- Values split across DOM nodes or across lines.
- Reformatted values (extra spaces, dashes, fullwidth digits).
- Short or common values (a 4-digit PIN) that cannot be detected by pattern and rely on profile exact-match.

Each weak spot gets a named test group, and its measured recall is reported, not hidden (doc 11).

## 8. Implementation order (dependency order)

1. `pii-checksums` → 2. `pii-config` → 3. `pii-rules` → 4. `secret-scanner` → 5. `sensitive-fields`, `field-classifier`, `label-assoc` → 6. `tokenizer` → 7. `dlp-heuristics`, `dlp-sanitizer` → 8. `canary`, `security-policy`, `egress-guard` → 9. `adversarial-guard` → 10. `url-risk`, `action-firewall` → 11. `merge`, `redact`, `redaction-verify` → 12. `vision-pipeline` (Phase 2) → 13. `dpdp-audit` (Stretch).
