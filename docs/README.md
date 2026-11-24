# Mikoshi — Planning Docs

Privacy-first AI browser agent. Team NOVA, wHACKiest 2026 (online ideathon, 26–27 Nov 2026), track **"Beyond the Browser"**.

These docs are the design and build plan, plus a status page (`14-build-status.md`) that records what has actually been built and verified. Read them in order; `09-implementation-plan.md` is the one you execute.

## How to read the evidence tags

Every non-trivial statement in these docs carries its origin, so nothing here is invented silently.

| Tag | Meaning |
|---|---|
| **[DECK Sx]** | Taken from slide *x* of the team's Google Slides deck. |
| **[USER]** | A decision the user gave in conversation. |
| **[ASSUMPTION]** | My proposal to fill a gap. Needs your confirmation. Collected in `13-open-questions.md`. |
| **[VERIFY]** | A fact (version, model ID, API behaviour) that must be checked against current docs before use. Not stated from memory. |

## Reading order

| # | File | What it answers |
|---|---|---|
| 01 | [vision-and-scope](01-vision-and-scope.md) | What are we building, for whom, what is in/out for the 48-hour MVP? |
| 02 | [deck-analysis](02-deck-analysis.md) | What exactly does the deck promise? Traceability matrix claim → feature → phase. |
| 03 | [privacy-core](03-privacy-core.md) | What modules make up the privacy core and how must each behave? |
| 04 | [architecture](04-architecture.md) | Components, data flow, trust boundaries, sequence diagrams. |
| 05 | [tech-stack](05-tech-stack.md) | Every technology, why, alternatives rejected. |
| 06 | [privacy-and-security-design](06-privacy-and-security-design.md) | Threat model, tokenization, fail-closed gate, Action Firewall. |
| 07 | [feature-specs](07-feature-specs.md) | Each feature with acceptance criteria. |
| 08 | [api-and-data-contracts](08-api-and-data-contracts.md) | JSON schemas, storage schema, error codes. |
| 09 | [implementation-plan](09-implementation-plan.md) | **Step-by-step build plan, ~48 h, with cut-line.** |
| 10 | [repo-structure](10-repo-structure.md) | Target folder tree and module boundaries. |
| 11 | [testing-and-evaluation](11-testing-and-evaluation.md) | Test strategy, metrics, thresholds. |
| 12 | [demo-and-pitch](12-demo-and-pitch.md) | Demo script, fallback plan, judge Q&A. |
| 13 | [open-questions](13-open-questions.md) | Unresolved items and risk register. **Answer these first.** |
| 14 | [build-status](14-build-status.md) | What is built, how it was verified, and what is not done. |

## One-paragraph summary


## Glossary

- **PII** — personally identifiable information.
- **Aadhaar / PAN** — Indian national ID number / tax ID. Both have checksum or structural rules, so they can be detected precisely.
- **Skeleton** — the compact, sanitized description of the page (accessibility/DOM nodes with ids, labels, roles, bounding boxes) sent instead of raw HTML.
- **Token** — a placeholder like `[PAN_1]` standing for a real value held in the local vault.
- **Vault** — local map token → real value. Never leaves the browser.
- **Egress** — anything sent off the machine (to the FastAPI server, and from there to a VLM).
- **Fail-closed** — if verification cannot prove the payload is clean, nothing is sent.
- **Action Firewall** — rule engine that classifies each proposed action as ALLOW / REQUIRE_APPROVAL / BLOCK.
- **VLM** — vision-language model (reads screenshot + text, returns actions).
- **DPDP** — India's Digital Personal Data Protection Act; categories are mapped to it for audit reporting (Stretch).

## Status legend

- **MVP** — must exist for the demo (48-hour build).
- **Stretch** — build only if MVP is done and green.
- **Roadmap** — described in the deck's business plan; not built now.
