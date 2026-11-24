# 11 — Testing and Evaluation

Principle: **only claim what was measured.** OCR recall, face/person detection, end-to-end latency and network round trip can only be measured in a real browser. Mikoshi measures them in Phase 7 or does not claim them.

## 1. Test pyramid

| Level | Tooling | What | Where |
|---|---|---|---|
| Unit (JS) | `node --test` | Every `lib/*.mjs` module | `tests/` |
| Unit (Python) | `pytest` | Schemas, adapters (stubbed HTTP), `/privacy`, CORS, log redaction | `server/tests/` |
| Integration (JS, no browser) | `node --test` with fakes | Orchestrator with fake page/OCR/API; egress function | `tests/orchestrator.test.mjs` etc. |
| Contract | `pytest` + JS | Same JSON examples validated by both sides | `tests/contract/` |
| Adversarial | security-lab scoring | Hostile pages vs. expected decisions | `eval/security`, `security-lab/` |
| Browser e2e | manual checklist (MVP); Playwright **Stretch** | Real Chrome, real OCR, fixtures | doc 12 |

## 2. Required test suites

Privacy core: `pii-rules`, `pii-config`, `independent-validators`, `secret-scanner`, `sensitive-fields`, `field-classifier`, `label-assoc`, `tokenizer`, `merge`, `dlp-sanitizer`, `task-goal-sanitizer`, `redaction-verify`, `egress-guard`, `security-policy`, `canary`, `action-firewall`, `adversarial-guard`, `prompt-injection`, `profile-fields`; Python `test_mock_agent`, `test_vlm_no_fallback`.

New for Mikoshi:

| Test | Asserts |
|---|---|
| `url-risk.test` | https/IP/punycode/`@`/trusted site scoring |
| `firewall-navigation.test` | navigate/open_tab/search/extract/ask_user/unknown ⇒ expected decisions |
| `egress-single-door.test` | grep: no `fetch(` to server outside `egress.js`/`api-client.js` |
| `no-js-twins.test` | no `lib/*.js` duplicates of `.mjs` |
| `egress-no-pii.test` | with a filled KYC fixture + fake network, body contains tokens only; scan with independent validators |
| `gate-blocks.test` | unmasked PII ⇒ zero network calls |
| `response-validation.test` | hallucinated token/target/action rejected; `read_only` enforced |
| `loop-guards.test` | step cap, wall-clock cap, stagnation, repeat plan, stop |
| `privacy-endpoint.test` (py) | `/privacy` text matches tokenization+blackout; no "No tokenization" |
| `no-body-logging.test` (py) | request bodies never appear in captured logs |
| `cors.test` (py) | `*` origin refused |

## 3. Privacy metrics

| Metric | Definition | Target (MVP) | Measured how |
|---|---|---|---|
| Egress PII leak count (demo) | PII-pattern or vault-value matches in outgoing request, across all steps of demo runs | **0** | automated scan (independent validators) + HAR review |
| Gate catch rate on seeded leaks | blocked / injected leaks | 100% of seeded cases | unit/integration |
| Detection F1 | Seeded synthetic corpus | recorded baseline; no regression between commits | `npm run bench` |
| Recall on unlabelled values | bench subset B | report, don't hide | bench |
| OCR-garbled recall | bench subset | report | bench |
| Redaction leakage | bench `redaction.mjs` | report; target improvement over the Phase 1 baseline | bench |
| Raw PII bytes reaching the server | egress experiment (unprotected vs pipeline vs pipeline + gate) | target 0 on demo | experiment |

> All numbers above are placeholders until measured. Record exact values and the command that produced them in `docs/results/` before quoting them externally.

## 4. Agent quality metrics

| Metric | Target | Notes |
|---|---|---|
| KYC task success (mock) | 100% (deterministic) | test |
| KYC task success (Gemini) | ≥ 4/5 runs | measured; report honestly |
| Portal task success (mock) | 100% | test |
| Portal task success (Gemini) | ≥ 3/5 runs | measured |
| Steps per task | KYC ≤ 8 (guess), portal ≤ 6 | **[ASSUMPTION]** adjust after first runs |
| Hostile-page decisions correct | all security-lab pages | scoring script |

## 5. Performance metrics (measure in a real browser, Phase 7)

| Metric | Budget (planning guess) |
|---|---|
| Skeleton build | < 300 ms on demo pages |
| OCR on one screenshot | measure; unknown |
| Verify gate | < 1.5 s extra |
| Step round trip (excl. model) | measure |
| Model latency | measure per model |
| Time to complete KYC demo | < 90 s with approvals **[ASSUMPTION]** |

Budgets are guesses, labelled as such, to be replaced by measurements.

## 6. Security tests (adversarial fixtures)

Adversarial pages and expected decisions: benign → allow; PII/credential → sanitize/block; phishing; visible/hidden/image injection → flagged; malicious form → exfil blocked; exfil URL → blocked; sensitive doc; malicious download → blocked; mixed; canary → blocked. New: malicious navigation (navigate to lookalike with PII in query).
Caveat: a static page generator cannot measure CSS visibility, OCR of image text or live navigation; browser runs must cover them or the claim is dropped.

## 7. Manual e2e checklist (Chrome)

For each of [mock, Gemini]:
1. Fresh profile; load extension; set server URL/key; "Test connection" ok.
2. Enter profile (valid Aadhaar and PAN).
3. Open KYC fixture; run "Fill my KYC form" in *ask for every action* mode; approve each step; verify the form values and the activity log; open "What was sent" and confirm tokens only.
4. Repeat in *risky only* mode.
5. Run portal task in read-only mode; verify summary.
6. Open hostile fixtures; verify blocks/approvals.
7. Stop server mid-task; verify clean stop with error and no fallback.
8. Break the gate (test hook); verify nothing sent.
9. Export log; grep for the Aadhaar/PAN: expect no match.

## 8. Reporting

After each phase gate, update a `docs/results/` file (create when first measured) with date, commit, command, outputs. Pitch numbers must cite one of these files.
