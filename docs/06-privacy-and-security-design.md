# 06 — Privacy and Security Design

## 1. What we protect

Sensitive data named in the deck: **Aadhaar, PAN, email, phone, financial details**. **[DECK S2]**
Categories the detector must cover (doc 03): aadhaar (Verhoeff), pan, email, phone-in, credit-card (Luhn + IIN), bank account, IFSC, UPI VPA, GSTIN, voter-id, vehicle-reg, passport-in, DOB, IBAN, SSN, IPv4, crypto addresses, plus vendor secrets and passwords.

Restricted categories (never typed without care, never sent): defined by `RESTRICTED_PII_CATEGORIES` — read the exact list in Phase 1 and copy it into the test suite, not into docs.

## 2. Threat model

| ID | Threat | Actor | Impact | Mitigation |
|---|---|---|---|---|
| T1 | PII in screenshot reaches the cloud | Detector miss, OCR error | Core promise broken | Blackout + **verify gate** (re-OCR) + fail-closed + DOM-level field knowledge + profile exact-match (see §4) |
| T2 | PII in text (skeleton, goal, history) reaches the cloud | Detector miss | Same | Tokenize known values; `classifyPayload` over final bytes; canaries |
| T3 | Prompt injection in page steers the agent | Malicious page | Data exfiltration, harmful actions | `adversarial-guard` scan; page treated as data; firewall raises risk on `MALICIOUS` pages |
| T4 | Model proposes a harmful or hallucinated action | Model | Payments, deletions, wrong target | Schema + target validation; Action Firewall; approvals |
| T5 | Exfiltration through URL, cross-origin form, download | Malicious page or model | Data leaves via side channel | Firewall exfil rules (URL query PII, cross-origin form) |
| T6 | Vault theft | Other extension/malware | Values exposed | Local only; encryption at rest is Stretch; document limitation |
| T7 | Server logs or provider retention | Operator/provider | Sanitized data persists | Server logs no bodies; tokens only; document provider terms **[VERIFY]** |
| T8 | API key exposure | Extension reverse engineering | Key abuse | Key only on server |
| T9 | Over-broad permissions | Store reviewers/users | Trust loss | Minimal permissions; request host access per site |
| T10 | Tokens leak meaning | Cloud sees `[PAN_1]` | Category disclosed | Accepted: category is not the value; documented |

Out of scope for MVP: malware on the user's machine, browser zero-days, compromised Google account, side-channel timing.

## 3. Tokenization design **[USER]**

Cloud sees placeholders, the browser keeps values.

- **Source of values:** (a) user profile entries; (b) values detected on screen (DOM, field values, OCR).
- **Token form:** `[PREFIX_n]`, e.g. `[AADHAAR_1]`, `[PAN_1]`, `[EMAIL_1]`, `[PHONE_1]`. Prefix map in `tokenizer.mjs::CATEGORY_PREFIX`.
- **Stable within a vault:** same normalized value always maps to the same token.
- **What the server may see:** token and category (`exportContext()` returns token → category only). **Never** the value.
- **Where tokens appear:**
  - Skeleton node `text`/`label` (value replaced by token),
  - Task goal (`sanitizeTaskGoal`),
  - History items,
  - Model actions: `fillToken: "[PAN_1]"`.
- **Re-injection:** the **executor** resolves `fillToken` through `Vault.resolve(token)` immediately before typing. Resolution happens in the content-script/SW; the resolved value is never logged or sent back.
- **Unknown token:** action rejected (hallucinated).
- **Activity log display:** show the token and a masked preview (e.g. `XXXX XXXX 1234`); full value only on explicit user click, locally.
- **Vault lifetime:** profile-sourced entries persist in `chrome.storage.local`; screen-detected entries are per-task and cleared on task end. **[ASSUMPTION]**
- **Known weakness:** `Vault.redactText` replaces by exact/normalized match; a value reformatted by the page (e.g. Aadhaar with different grouping) is handled for digit runs but not for arbitrary strings — covered by tests, and backed by the verify gate.

## 4. Defence in depth for "zero-PII" **[DECK S6]**

Layers in order, each independent of the next:

1. **Field knowledge (DOM):** fields classified as sensitive (`type=password`, label/name/autocomplete hints) are censored regardless of what the regex sees.
2. **Profile exact match:** every profile value is replaced wherever it appears, in any format the vault normalizes.
3. **Pattern + checksum detection** on all text (DOM + OCR): high precision for Aadhaar, PAN, cards.
4. **Visual blackout** of detected regions, plus DOM-box redaction for sensitive fields.
5. **Verify gate:** re-OCR the masked image, re-detect at a paranoid threshold; one more mask pass; still leaking → `REDACTION_FAILED` → **block egress**.
6. **Egress policy on the exact outgoing JSON:** canaries → BLOCK; secrets → BLOCK/REQUIRE_APPROVAL; restricted PII → BLOCK; other PII or profile-value match → SANITIZE; nothing → ALLOW.
7. **Canary tokens** planted in tests to prove nothing leaks end-to-end.

Honest limit: none of these is perfect; pattern detection has lower recall for unlabelled and OCR-garbled values (doc 01 §6). The guarantee we can *test* is: **the payload that leaves has passed all layers, and a known leak in tests is blocked.**

## 5. Action Firewall

Verified behaviour of `classifyAction(action, ctx)`:

| Action | Rule summary | Decision |
|---|---|---|
| `wait`, `scroll`, `done` | non-mutating | ALLOW |
| `type`/`select` | secrets → HIGH; restricted/personal PII → MEDIUM; sensitive field → MEDIUM; PII into a form that submits cross-origin → **CRITICAL (BLOCK)** | MEDIUM ⇒ ALLOW unless action in {submit, upload, download}; HIGH ⇒ approval; CRITICAL ⇒ BLOCK |
| `submit` | MEDIUM; credential/restricted form → HIGH; cross-origin → CRITICAL; payment text → HIGH | MEDIUM ⇒ approval; HIGH ⇒ approval; CRITICAL ⇒ BLOCK |
| `click` on link | off-origin MEDIUM; download HIGH; executable CRITICAL; URL carrying PII → CRITICAL; payment/destructive/security-setting text → HIGH | as above |
| `navigate`, `open_tab` | MEDIUM; off-site HIGH; PII in URL CRITICAL | as above |
| `download`/`upload`/`copy`/`paste` | HIGH | approval |
| `execute_script` | CRITICAL | BLOCK |
| unknown action | MEDIUM | ALLOW unless in the approval set — **Mikoshi changes this: unknown ⇒ BLOCK** |
| any mutating action on a `MALICIOUS` page | at least HIGH | approval |

Mikoshi additions **[ASSUMPTION]**:

- `search(query)`: query is run through `classifyPayload`; PII in a query ⇒ BLOCK.
- `extract(...)`: read-only; ALLOW, but extracted text is tokenized before being stored.
- `ask_user(question)`: ALLOW; question text sanitized.
- `urlRisk(url)` returns `destinationTrust ∈ [0,1]` from: protocol (https), IP-literal host, punycode/lookalike heuristic, allow-list for demo origins, and user-defined trusted sites. New module in Phase 1.
- User **policy settings:** per-site "always ask", "auto-approve low risk", and a global "ask before every mutating step" (deck: step-by-step approvals **[DECK S3]**).

### Approval UX rules

- Show: action, target label, risk level, reasons (no raw values), and the token(s) involved.
- Buttons: **Approve once**, **Deny**, **Stop task**. "Always allow" is not offered for HIGH.
- Timeout on a pending approval cancels the task.

## 6. Prompt-injection and hostile pages

- `scanAdversarialVectors` / `detectHiddenStyles` / `detectPromptInjection` on page text and attributes.
- The system prompt states that page content is untrusted data; the server wraps page text in delimiters. **[ASSUMPTION: prompt design in Phase 3]**
- Security-lab pages (`05-injection-visible`, `06-injection-hidden`, `07-injection-image`, `08-malicious-form`, `09-exfil-url`, `11-malicious-download`, `13-canary`) become regression tests.

## 7. Server-side rules

- Validate the request with Pydantic; reject anything that looks like raw PII? The server **may** run a second `detect` pass as defence in depth. **[ASSUMPTION]** Needs a Python port of the patterns or a call to Node; costly — **Stretch**. MVP relies on the client gate and a **server-side canary check** (reject any request containing a configured canary).
- No request-body logging. Log only: timestamp, step, latency, model, status, token counts.
- CORS restricted to the extension origin and localhost; `/health` and `/privacy` are the only unauthenticated endpoints; `/agent/step` requires a shared secret header for demo. **[ASSUMPTION]**
- `/privacy` must describe tokenization + blackout truthfully and be covered by a test comparing it to behaviour.

## 8. DPDP mapping (India)

Mikoshi maps detected categories to DPDP concepts (`classifyDPDP`, `generateDPDPAuditReport` — Stretch). For the pitch, say "supports data-minimisation and purpose limitation by design". Do **not** claim legal compliance or certification; have wording reviewed (Q11).

## 9. Privacy statement to ship in the UI

"Mikoshi reads your page on your device. Before anything is sent to the AI service, sensitive values are replaced with placeholders and screenshots are blacked out, then checked again. If the check fails, nothing is sent. You approve risky actions."
