# 13 — Open Questions and Risk Register

Answer the **Blocks** column first. Anything unanswered keeps the default shown, labelled [ASSUMPTION] in the docs.

## 1. Open questions

| # | Question | Why it matters | Default I used | Blocks |
|---|---|---|---|---|
| Q1 | What does the comparison table on slide 2 say (limitations of browsers, automation tools, cloud agents, OCR)? | Pitch accuracy; I could not read its body | Not quoted anywhere | Pitch only |
| Q2 | What does your slide 5 architecture diagram show? | Doc 04 is *derived*; could contradict you | Derived from slides 2–4 and 6 | Phase 2+ design |
| Q3 | What is the exact non-form demo task ("beyond forms")? Navigating a portal and summarising? Comparing items? Multi-site? | Defines F-NAVIGATE/SEARCH/EXTRACT scope and fixtures | "Find fee due date on an info portal, read-only" | Phase 4, 6 |
| Q4 | Side panel or popup UI? | Side panel keeps the live log visible; needs `sidePanel` permission | Side panel | Phase 5 |
| Q5 | Which local VLM, if any, for the deck's "local" option? | Stretch adapter | None; Stretch | No |
| Q6 | Is OpenAI/OpenRouter wanted in MVP? | Extra adapter | No (Stretch) | No |
| Q7 | Does the ideathon require a working prototype, a recorded demo, or slides only? | Time allocation | Prepare all three | Phase 8 |
| Q8 | Must the vault be encrypted at rest in MVP? | Extra work, UX for passphrase | No; documented limitation | No |
| Q9 | Licence for the repository? | Repo hygiene; no LICENSE file yet | Undecided; placeholder | No |
| Q10 | Is `<all_urls>` host access acceptable for the demo, given slide 7 says "minimal permissions"? | Permission model, store trust | Prefer `activeTab` + optional host access; fall back to `<all_urls>` if blocking | Phase 0 |
| Q11 | Who reviews DPDP/compliance wording before it goes in the pitch? | Legal claims | Use only "supports data-minimisation by design" | Pitch |
| Q12 | Team split (4 members listed on slide 1): who owns what? | Doc 09 role table is a guess | A/B/C/D per doc 09 | No |
| Q13 | Branch/commit policy for the repository? | — | Commit only when asked | No |
| Q15 | Is a shared-secret header between extension and server acceptable for the demo? | Local-server protection | Yes | No |
| Q16 | Which languages should the UI support (English only vs Hindi/Kannada)? | Student/citizen audience | English only | No |

## 2. Assumptions list (to confirm or reject)

1. Target browser is desktop Chrome only. **[DECK S8]**
2. Automation runs only on local fixtures during the demo.
3. One iterative loop (observe → act), not a separate planner call.
4. Vault lives in the service worker, not the page.
5. Screen-detected values are cleared per task; profile values persist.
6. Step cap 12, wall-clock cap defined in Phase 4.
7. Server is local (`127.0.0.1`), not hosted.
8. The 48-hour budget is net working time for the team, not a single person.
9. `read_only` mode is a first-class setting.
10. Synthetic IDs only for demos.

## 3. Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Time overrun in Phase 4 | High | High | Cut-line in doc 09; KYC path first | B |
| R2 | OCR WASM won't load/run in MV3 offscreen | Medium | High | Timebox 45 min in Phase 0/2; fall back to DOM-only mode with the gate on DOM text; Tesseract worker warm-up | B |
| R3 | Gemini output unreliable / model ID or API changed | Medium | Medium | [VERIFY] at Phase 0; mock adapter; strict validation | C |
| R4 | `<all_urls>` contradicts "minimal permissions" | High | Medium | Decide Q10; optional host perms; honest pitch wording | A |
| R5 | Detector recall limits (values without labels, OCR-garbled text, redaction leakage) | High | High | Layers, profile exact-match, gate; don't claim zero; report measurements | A |
| R6 | ESM in content scripts blocked | Medium | Medium | esbuild fallback (doc 05) | B |
| R7 | Slide 5 mismatch | Medium | Low | Q2 | all |
| R8 | Approval UI clutter slows demo | Medium | Low | "risky only" mode; rehearsal | D |
| R9 | Hostile page breaks executor (frameworks ignore programmatic input) | Medium | Medium | dispatch `input/change`; test with a React-style fixture | B |
| R10 | Provider data retention of sanitized screenshots | Low | Medium | Only redacted images; document; consider provider terms [VERIFY] | A |
| R11 | Real PII used accidentally in demo/test | Low | High | Synthetic data only; checklist | all |
| R12 | Scope creep from "beyond forms" | High | High | MVP = navigate + search + extract + read-only; everything else Stretch | lead |
| R13 | Team context loss: docs drift from code | Medium | Medium | Update docs in same change; paths cited | all |
| R14 | Executor race with page navigation | Medium | Medium | Re-perceive after navigate; wait for load; stagnation guard | B |
| R15 | Untested claims in pitch | Medium | High | Claims list in doc 12; numbers only from `docs/results/` | lead |

## 4. Things I deliberately did **not** do

- Did not read or reproduce team member names/USNs from slide 1.
- Did not state versions or model IDs from memory; they are **[VERIFY]**.
- Did not commit or push anything beyond the docs.
- Did not claim DPDP compliance.
