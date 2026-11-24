"""Mikoshi agent server.

POST /agent/step  sanitized context in, validated action plan out
GET  /health      liveness and current model mode
GET  /privacy     what the server does and does not see
"""
from __future__ import annotations

import hmac
import logging
import os
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from schema import StepRequest, StepResponse
from vlm import VLMBadOutput, VLMUnavailable, run_step

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:  # noqa: BLE001 - dotenv is optional
    pass

VERSION = "0.1.0"
MAX_BODY_BYTES = 8 * 1024 * 1024
log = logging.getLogger("mikoshi")  # request bodies are never logged

app = FastAPI(title="Mikoshi Agent", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://[a-p]{32}|https?://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Mikoshi-Key"],
)


@app.middleware("http")
async def limit_body(request: Request, call_next):
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=413, content={"detail": "request too large"})
    return await call_next(request)


def require_key(x_mikoshi_key: str | None = Header(default=None)) -> None:
    expected = os.environ.get("MIKOSHI_API_KEY", "")
    if expected and not hmac.compare_digest(x_mikoshi_key or "", expected):
        raise HTTPException(status_code=401, detail="missing or invalid key")


def _canaries() -> list[str]:
    return [c.strip() for c in os.environ.get("MIKOSHI_CANARIES", "").split(",") if c.strip()]


@app.get("/health")
def health() -> dict:
    mode = os.environ.get("VLM_MODE", "mock")
    return {
        "ok": True,
        "version": VERSION,
        "vlm_mode": mode,
        "model": "mock" if mode == "mock" else (os.environ.get("VLM_MODEL") or "unset"),
        "mock_fallback": False,
        "auth_required": bool(os.environ.get("MIKOSHI_API_KEY")),
    }


@app.get("/privacy")
def privacy() -> dict:
    return {
        "scheme": "tokenization+blackout",
        "server_sees": [
            "redacted screenshot (sensitive regions blacked out)",
            "sanitized page description (field values reduced to empty/filled/readonly)",
            "tokenized task text and history (placeholders such as [PAN_1])",
            "token -> category map",
        ],
        "server_never_sees": ["raw personal values", "the unredacted screenshot", "field contents", "the local vault"],
        "notes": "Placeholders stand for values kept only in the browser. The browser puts the real value back when it types.",
    }


@app.post("/agent/step", response_model=StepResponse, dependencies=[Depends(require_key)])
def agent_step(req: StepRequest) -> StepResponse:
    blob = req.model_dump_json()
    for c in _canaries():
        if c in blob:
            log.warning("request rejected: canary present")  # never log the body
            raise HTTPException(status_code=400, detail="request rejected by server policy")
    try:
        return run_step(req)
    except VLMUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"AI unavailable: {exc}") from exc
    except VLMBadOutput as exc:
        raise HTTPException(status_code=502, detail=f"AI returned an unusable plan: {exc}") from exc
