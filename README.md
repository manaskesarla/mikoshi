# Mikoshi

A privacy-first AI browser agent for Chrome. It reads a web page on your device, replaces your sensitive details (Aadhaar, PAN, phone, email, financial data) with placeholders **before** asking an AI what to do, and asks you before anything risky.

Built for wHACKiest 2026, track "Beyond the Browser".

## How it works

1. **Perceive locally.** A content script builds a compact description of the page from the DOM and accessibility attributes. Field values are never included.
2. **Tokenize.** Your profile values and any personal data found on the page become placeholders such as `[AADHAAR_1]`. The real values stay in a local vault.
3. **Check before sending.** One function (the egress door) inspects the exact outgoing bytes: canaries, secrets, restricted personal data. If anything is wrong, nothing is sent.
4. **Ask the AI.** A small FastAPI server turns the sanitized page description into proposed actions (Gemini, or a built-in mock model for offline demos).
5. **Distrust the answer.** Every proposed action is validated against the real page, then classified by the **Action Firewall** (allow / ask you / block). Risky ones appear as approval cards in the side panel.
6. **Act locally.** The extension puts the real value back only at the moment of typing.

It can fill forms and also navigate, search and read information across pages (read-only mode).

## Run it

Requirements: Node 20+, Python 3.11+, Google Chrome.

```bash
# 1. server
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
cp server/.env.example server/.env          # VLM_MODE=mock works with no key
server/.venv/bin/python -m uvicorn main:app --app-dir server --port 8000

# 2. demo pages (second terminal)
npm run serve:fixtures                      # http://127.0.0.1:4173/

# 3. extension
#    chrome://extensions -> Developer mode -> Load unpacked -> choose the extension/ folder
#    Click the Mikoshi icon to open the side panel.
```

In the side panel: **Profile** tab → enter your details (use synthetic ones for demos) → Save. Open `http://127.0.0.1:4173/kyc/`, go to **Task**, type "Fill my KYC form and submit it", press Start. For the portal demo open `http://127.0.0.1:4173/portal/`, choose **Read only**, and ask "Tell me the tuition fee due date".

To use Gemini instead of the mock: set `VLM_MODE=gemini`, `GEMINI_API_KEY` and `VLM_MODEL` in `server/.env` (check Google's current model list for the model name).

## Tests

```bash
npm test                 # 172 unit and integration tests (Node)
npm run test:server      # 44 server tests (pytest)
npm run bench            # seeded PII detection benchmark -> docs/results/bench-baseline.md
npm run browser-check    # perceiver and executor against the fixtures in headless Chrome
npm run e2e              # the real extension + real server + fixtures in headless Chrome (36 checks)
```

`browser-check` and `e2e` need Chrome installed; `e2e` also needs the server venv above.

## Layout

```
extension/   Chrome MV3 extension: background/ (service worker, orchestrator, egress door),
             content/ (page code), panel/ (side panel UI), lib/ (privacy core)
server/      FastAPI service, model adapters, tests
fixtures/    demo pages (KYC form, college portal) and hostile test pages
eval/        detection benchmark
scripts/     fixture server, browser checks
docs/        design and planning documents; start at docs/README.md and docs/14-build-status.md
```

## Honest limits

- Pattern-based detection is never perfect. The design is layered and fail-closed, but it is not a guarantee. Measured numbers are in `docs/results/`.
- Screenshots are not sent yet: the OCR-and-redaction pipeline is not built, so the agent works from the page description only. See `docs/14-build-status.md`.
- The profile is stored unencrypted in `chrome.storage.local`.
- Demos run against local fixture pages only.
