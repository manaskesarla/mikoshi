import logging

import pytest
from fastapi.testclient import TestClient

import main
from conftest import node, step_request
from vlm import VLMBadOutput, VLMUnavailable

client = TestClient(main.app)
BODY = step_request([node("n1", piiCategory="pan", label="PAN")], vaultContext={"[PAN_1]": "pan"})


def test_health_reports_mode_and_never_a_fallback():
    h = client.get("/health").json()
    assert h["ok"] and h["vlm_mode"] == "mock" and h["mock_fallback"] is False and h["auth_required"] is False


def test_privacy_describes_tokenization_not_its_absence():
    p = client.get("/privacy").json()
    text = " ".join([p["scheme"], p["notes"], *p["server_sees"], *p["server_never_sees"]]).lower()
    assert p["scheme"] == "tokenization+blackout"
    assert "no tokenization" not in text
    assert any("placeholder" in s or "tokenized" in s for s in p["server_sees"])
    assert "raw personal values" in p["server_never_sees"]


def test_step_returns_a_plan():
    r = client.post("/agent/step", json=BODY)
    assert r.status_code == 200
    assert r.json()["actions"][0]["fillToken"] == "[PAN_1]"


def test_key_is_enforced_when_configured(monkeypatch):
    monkeypatch.setenv("MIKOSHI_API_KEY", "s3cret")
    assert client.post("/agent/step", json=BODY).status_code == 401
    assert client.post("/agent/step", json=BODY, headers={"X-Mikoshi-Key": "wrong"}).status_code == 401
    assert client.post("/agent/step", json=BODY, headers={"X-Mikoshi-Key": "s3cret"}).status_code == 200
    assert client.get("/health").status_code == 200  # health stays open


def test_canary_in_request_is_rejected_without_logging_the_body(monkeypatch, caplog):
    monkeypatch.setenv("MIKOSHI_CANARIES", "MKS-CANARY-ABCDEFGHIJKL")
    leaky = step_request([node("n1", text="MKS-CANARY-ABCDEFGHIJKL")])
    with caplog.at_level(logging.DEBUG):
        r = client.post("/agent/step", json=leaky)
    assert r.status_code == 400
    assert "MKS-CANARY" not in r.text and "MKS-CANARY" not in caplog.text


def test_model_outage_is_503_and_unusable_output_is_502(monkeypatch):
    def down(req): raise VLMUnavailable("down")
    def junk(req): raise VLMBadOutput("junk")
    monkeypatch.setattr(main, "run_step", down)
    r = client.post("/agent/step", json=BODY)
    assert r.status_code == 503 and "unavailable" in r.json()["detail"].lower()
    monkeypatch.setattr(main, "run_step", junk)
    assert client.post("/agent/step", json=BODY).status_code == 502


def test_invalid_request_is_422():
    assert client.post("/agent/step", json={"taskGoal": "x"}).status_code == 422


def test_oversize_body_is_413():
    r = client.post("/agent/step", content=b"{}", headers={"Content-Length": str(9 * 1024 * 1024), "Content-Type": "application/json"})
    assert r.status_code == 413


@pytest.mark.parametrize("origin,allowed", [
    ("chrome-extension://abcdefghijklmnopabcdefghijklmnop", True),
    ("http://localhost:4173", True), ("http://127.0.0.1:8000", True),
    ("https://evil.example", False), ("http://localhost.evil.example", False),
])
def test_cors_only_for_the_extension_and_localhost(origin, allowed):
    r = client.get("/health", headers={"Origin": origin})
    assert (r.headers.get("access-control-allow-origin") == origin) is allowed
