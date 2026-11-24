"""Model adapters. `run_step(req)` returns a validated StepResponse or raises:

  VLMUnavailable  the model could not be reached or is not configured   -> HTTP 503
  VLMBadOutput    the model answered, but not with a usable plan         -> HTTP 502

There is deliberately NO fallback from a failing real model to the mock: a silent
fallback would hide outages and make demos look like real AI results.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Optional

import httpx

from schema import MUTATING, NEEDS_TARGET, READ_ONLY_ALLOWED, Action, StepRequest, StepResponse

MAX_ACTIONS = 5
PROMPT_PATH = Path(__file__).parent / "prompts" / "system.md"


class VLMUnavailable(RuntimeError):
    pass


class VLMBadOutput(RuntimeError):
    pass


# ---------------------------------------------------------------- shared helpers
def wrap_untrusted(text: str, limit: int = 12000) -> str:
    """Mark page-derived text as data and defuse any copy of the delimiter inside it."""
    body = re.sub(r"<(/?)\s*untrusted_page_data", r"&lt;\1untrusted_page_data", text[:limit], flags=re.I)
    return f"<untrusted_page_data>\n{body}\n</untrusted_page_data>"


def build_context(req: StepRequest) -> str:
    page = req.skeleton.model_dump(exclude_none=True)
    return "\n".join([
        f"mode: {req.mode}",
        f"step: {req.step}",
        f"task (placeholders stand for private values): {req.taskGoal}",
        f"available placeholders: {json.dumps(req.vaultContext)}",
        f"history: {json.dumps([h.model_dump(exclude_none=True) for h in req.history[-6:]])}",
        f"extracted so far: {json.dumps(req.extracted)}",
        "page description:",
        wrap_untrusted(json.dumps(page)),
    ])


def extract_json(text: str) -> dict:
    """Pull the first JSON object out of model text (tolerates code fences and chatter)."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    start = t.find("{")
    if start < 0:
        raise VLMBadOutput("no JSON object in model output")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(t)):
        ch = t[i]
        if in_str:
            esc = (not esc and ch == "\\")
            if ch == '"' and not esc:
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(t[start:i + 1])
                except json.JSONDecodeError as exc:
                    raise VLMBadOutput("model output is not valid JSON") from exc
    raise VLMBadOutput("unterminated JSON in model output")


def parse_response(data: dict, model: str) -> StepResponse:
    try:
        resp = StepResponse(**{k: v for k, v in data.items() if k in StepResponse.model_fields})
    except Exception as exc:  # pydantic ValidationError carries only field names and reasons
        raise VLMBadOutput(f"plan failed validation: {str(exc).splitlines()[0][:120]}") from exc
    resp.model = model
    return resp


def validate_response(req: StepRequest, resp: StepResponse) -> StepResponse:
    """The model is untrusted: check every action against what the request actually offered."""
    ids = {n.id for n in req.skeleton.nodes}
    if len(resp.actions) > MAX_ACTIONS:
        raise VLMBadOutput(f"too many actions ({len(resp.actions)})")
    for a in resp.actions:
        if req.mode == "read_only" and a.action not in READ_ONLY_ALLOWED:
            raise VLMBadOutput(f"{a.action} is not allowed in read_only mode")
        if a.action in NEEDS_TARGET and a.targetId not in ids:
            raise VLMBadOutput("action targets an element that is not on the page")
        for tid in a.targetIds or []:
            if tid not in ids:
                raise VLMBadOutput("extract targets an element that is not on the page")
        if a.fillToken and a.fillToken not in req.vaultContext:
            raise VLMBadOutput("action uses a placeholder that was not provided")
        if a.literalValue and re.search(r"\[[A-Z0-9]+_\d+\]", a.literalValue):
            raise VLMBadOutput("placeholder written into literalValue")
    return resp


# ------------------------------------------------------------------------- mock
_STOP = set("the and for you your tell find give show get please what when how with from this that page portal about".split())


def _keywords(goal: str) -> list[str]:
    return [w for w in re.findall(r"[a-z]{3,}", goal.lower()) if w not in _STOP]


def _mock(req: StepRequest) -> StepResponse:
    nodes = [n for n in req.skeleton.nodes if n.visible and not n.skip]
    by_cat: dict[str, list[str]] = {}
    for tok, cat in req.vaultContext.items():
        by_cat.setdefault(cat, []).append(tok)
    tried = {(h.action or {}).get("targetId") for h in req.history if h.action}

    # 1. form filling: empty fields whose category we hold a placeholder for
    if req.mode == "act":
        fills = []
        for n in nodes:
            if n.tag in ("input", "select", "textarea") and n.state == "empty" and n.id not in tried and n.piiCategory in by_cat:
                fills.append(Action(action="type", targetId=n.id, fillToken=by_cat[n.piiCategory][0], piiCategory=n.piiCategory, reason=f"fill {n.piiCategory}"))
        if fills:
            return StepResponse(actions=fills[:MAX_ACTIONS], rationale="Filling the empty fields I have placeholders for.", model="mock")
        if re.search(r"\bsubmit\b", req.taskGoal, re.I):
            btn = next((n for n in nodes if n.isSubmit and n.id not in tried), None)
            if btn:
                return StepResponse(actions=[Action(action="submit", targetId=btn.id, reason="submit as requested")], rationale="All fields filled; submitting.", model="mock")
        if any(n.piiCategory in by_cat for n in nodes) and not req.extracted:
            return StepResponse(actions=[Action(action="done")], done=True, summary="Form filled.", rationale="No more fields to fill.", model="mock")

    # 2. reading / navigating: follow links that match the goal, then extract matching text
    words = _keywords(req.taskGoal)
    if req.extracted:
        summary = " | ".join(f"{k}: {v}" for k, v in req.extracted.items())[:600]
        return StepResponse(actions=[Action(action="done")], done=True, summary=summary, rationale="Collected the requested information.", model="mock")
    hits = [n for n in nodes if n.text and n.tag not in ("a", "button", "nav") and any(w in n.text.lower() for w in words)]
    if hits:
        return StepResponse(actions=[Action(action="extract", name="result", targetIds=[n.id for n in hits[:3]], reason="matching text on this page")], rationale="The page already shows what was asked for.", model="mock")
    link = next((n for n in nodes if n.href and n.id not in tried and any(w in ((n.text or n.label or "").lower()) for w in words)), None)
    if link:
        return StepResponse(actions=[Action(action="click", targetId=link.id, reason="link matches the task")], rationale="Following the link that matches the task.", model="mock")
    return StepResponse(actions=[Action(action="ask_user", question="I could not find this on the page. Where should I look?")], rationale="Nothing on this page matches.", model="mock")


# ----------------------------------------------------------------------- gemini
def _gemini(req: StepRequest, client: Optional[httpx.Client] = None) -> StepResponse:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    model = os.environ.get("VLM_MODEL", "").strip()
    if not key:
        raise VLMUnavailable("GEMINI_API_KEY is not set")
    if not model:
        raise VLMUnavailable("VLM_MODEL is not set (check Google's current model list)")

    # [VERIFY] endpoint and body shape against Google's current Gemini API reference.
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    parts: list[dict] = [{"text": build_context(req)}]
    if req.screenshot and req.screenshot.startswith("data:") and ";base64," in req.screenshot:
        header, b64 = req.screenshot.split(",", 1)
        parts.append({"inline_data": {"mime_type": header[5:].split(";")[0], "data": b64}})
    body = {
        "systemInstruction": {"parts": [{"text": PROMPT_PATH.read_text()}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1},
    }
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        r = client.post(url, json=body, headers={"x-goog-api-key": key})
    except httpx.HTTPError as exc:
        raise VLMUnavailable(f"could not reach the model ({type(exc).__name__})") from exc
    finally:
        if own:
            client.close()
    if r.status_code >= 400:
        raise VLMUnavailable(f"model returned HTTP {r.status_code}")
    try:
        text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, ValueError) as exc:
        raise VLMBadOutput("unexpected response shape from the model") from exc
    return parse_response(extract_json(text), model)


# ------------------------------------------------------------------------ entry
def run_step(req: StepRequest, client: Optional[httpx.Client] = None) -> StepResponse:
    mode = os.environ.get("VLM_MODE", "mock").strip().lower()
    t0 = time.perf_counter()
    if mode == "mock":
        resp = _mock(req)
    elif mode == "gemini":
        resp = _gemini(req, client)
    else:
        raise VLMUnavailable(f"unknown VLM_MODE {mode!r}")
    resp = validate_response(req, resp)
    resp.latency_ms = int((time.perf_counter() - t0) * 1000)
    return resp
