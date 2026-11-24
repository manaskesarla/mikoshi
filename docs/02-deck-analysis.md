# 02 — Deck Analysis and Traceability

Source: the team's Google Slides deck (8 slides), read via its public HTML view. Exact text was available for slides 1–4 and 6–8. **Slide 5 (Process Flow / Architecture Diagram) is an image; its content could not be read.** The architecture in doc 04 is therefore *derived* from slides 2–4 and 6 and must be compared with your real diagram (Q2).

Team ID and member details on slide 1 are deliberately omitted from these docs.

## 1. Slide-by-slide extraction

### Slide 1 — Title
wHACKiest 2026, online ideathon, 26–27 Nov 2026, organised by a Department of Computer Science and Engineering. Team NOVA. Track: "Beyond the Browser". Team ID blank.

### Slide 2 — Problem statement
- Browsing is manual; repetitive web tasks cost time.
- Cloud-based AI agents see sensitive page data (privacy risk).
- Sensitive identifiers exposed during automation: Aadhaar, PAN, email, phone, financial details.
- Affected: students, banking users, citizens on government portals, employees, organisations.
- A comparison table of traditional browsers, basic automation tools, cloud AI agents and traditional OCR with their limitations (body text not captured).

### Slide 3 — Proposed solution
An AI-powered browser agent that understands webpages, automates repetitive tasks and protects sensitive data through on-device perception and privacy filtering.
1. Web understanding: DOM, accessibility, on-device OCR.
2. On-device PII detection and redaction **before** cloud calls, with a **recheck before transmission**.
3. Browser automation **with user approval**.
4. User control: step-by-step approvals, live activity tracking, profile management.
5. Flexible AI integration: Gemini, OpenAI, local or mock VLMs.

### Slide 4 — Tech stack
| Layer | Deck says |
|---|---|
| Frontend | JavaScript, HTML, CSS (browser extension UI) |
| Webpage perception | DOM and Accessibility APIs |
| Backend | Python, FastAPI |
| Privacy | regex, PII detection, redaction, tokenisation |
| Storage | browser local storage |

### Slide 5 — Process flow / architecture diagram
Image. Not readable. Footer and a placeholder only.

### Slide 6 — Novelty ("What makes Mikoshi different?")
Privacy-first automation combining on-device visual perception, AI reasoning and controlled action execution.
1. Multi-layer perception (DOM, accessibility, OCR).
2. Zero-PII cloud exposure with a fail-closed verification mechanism.
3. Privacy-aware AI automation sending sanitized context.
4. An **Action Firewall** validating AI actions and requiring approval.
5. VLM-agnostic architecture.

### Slide 7 — Impact and feasibility
- Technical: existing extension technology, lightweight local processing, existing AI APIs, modular design.
- Operational: lightweight extension, **minimal permissions**, user-controlled approvals, no desktop app for v1.
- Beneficiaries: students (faster applications), banks/financial services (privacy-conscious automation), healthcare (less sensitive data exposure), businesses (workflow automation).

### Slide 8 — Business model
- Freemium (basic automation, limited AI requests, basic privacy).
- Premium subscription (higher limits, advanced workflows, multiple AI integrations).
- Enterprise licensing (custom privacy policies, org-wide deployment, advanced controls).
- Developer/API integration offering.
- Go-to-market: Chrome extension MVP → students and early adopters → enterprise and institutions.
- Costs: AI API usage, development, testing and security audits, infrastructure, support.
- Growth: improve perception and PII detection, more browsers, enterprise features.

## 2. Requirement register (derived from the deck)

IDs are used by the rest of the docs.

| ID | Requirement | Deck source |
|---|---|---|
| R1 | Understand pages via DOM + accessibility + on-device OCR | S3.1, S4, S6.1 |
| R2 | On-device PII detection and redaction before any cloud call | S3.2, S4 |
| R3 | Recheck before transmission; fail-closed | S3.2, S6.2 |
| R4 | Tokenisation of sensitive values | S4 |
| R5 | Automate repetitive tasks in the browser | S2, S3.3 |
| R6 | Step-by-step user approvals | S3.4, S3.3 |
| R7 | Live activity tracking | S3.4 |
| R8 | Profile management | S3.4 |
| R9 | VLM-agnostic: Gemini, OpenAI, local, mock | S3.5, S6.5 |
| R10 | Send only sanitized context | S6.3 |
| R11 | Action Firewall validating AI actions | S6.4 |
| R12 | Minimal permissions, lightweight, no desktop app | S7 |
| R13 | Store data in browser local storage | S4 |
| R14 | Python FastAPI backend | S4 |
| R15 | Chrome extension MVP first | S8 |
| R16 | Business tiers, API, roadmap | S8 |

## 3. Traceability matrix

Status: MVP / Stretch / Roadmap. "Feature" IDs are in doc 07; "Phase" is in doc 09.

| Req | Feature (doc 07) | Doc(s) | Phase | Status |
|---|---|---|---|---|
| R1 | F-PERCEIVE (skeleton + OCR) | 04, 07 | 2 | MVP |
| R2 | F-PRIVACY-CORE (detect + redact) | 06, 07 | 1, 2 | MVP |
| R3 | F-VERIFY-GATE | 06, 07 | 1, 4 | MVP |
| R4 | F-TOKEN-VAULT | 06, 07, 08 | 1, 4 | MVP |
| R5 | F-AGENT-LOOP, F-NAVIGATE, F-EXTRACT | 04, 07 | 4 | MVP |
| R6 | F-APPROVALS | 07 | 5 | MVP |
| R7 | F-ACTIVITY-LOG | 07 | 5 | MVP |
| R8 | F-PROFILE | 07, 08 | 5 | MVP |
| R9 | F-VLM-ADAPTERS (Gemini + mock) | 05, 07, 08 | 3 | MVP; OpenAI/local Stretch |
| R10 | F-SANITIZED-CONTEXT | 06, 08 | 3, 4 | MVP |
| R11 | F-ACTION-FIREWALL | 06, 07 | 4 | MVP |
| R12 | F-PERMISSIONS | 05, 10 | 0, 5 | MVP (see Risk R4 in doc 13) |
| R13 | F-STORAGE | 08 | 1, 5 | MVP |
| R14 | F-SERVER | 05, 08 | 3 | MVP |
| R15 | Chrome MV3 target | 05, 10 | 0 | MVP |
| R16 | Business/roadmap | 12 | 8 | Pitch only |

## 4. Gaps and tensions between deck and reality

1. **"Minimal permissions".** Broad host access (`<all_urls>`) and the `tabs` permission contradict this claim. Mikoshi should default to `activeTab` plus user-granted host access, or justify the broad permission in the pitch (Risk R4).
2. **"Zero-PII" wording.** The deck's claim is strong; detector recall is never 100% (doc 01 §6). Wording in the pitch must be "fail-closed verification", not "mathematically zero".
3. **"Tokenisation" must be consistent end to end.** The deck lists tokenisation under the privacy layer. The extension, the server contract and the server's `/privacy` description must all describe the same scheme **[USER]**.
4. **"Automates repetitive tasks" means more than forms.** Mikoshi adds navigation, planning and extraction (doc 01 §3).
5. **"Local VLM".** Listed in the deck, but no concrete local model is named. Stretch; needs a decision (Q5).
6. **Slide 5 missing.** See top of this file.
7. **Slide 2 comparison table.** Body not captured; do not quote competitor limitations until read.
