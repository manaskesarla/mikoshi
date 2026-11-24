import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ("VLM_MODE", "VLM_MODEL", "GEMINI_API_KEY", "MIKOSHI_API_KEY", "MIKOSHI_CANARIES"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("VLM_MODE", "mock")


def node(id, tag="input", **kw):
    base = {"id": id, "tag": tag, "label": kw.pop("label", ""), "state": kw.pop("state", "empty"), "visible": True, "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}}
    base.update(kw)
    return base


def step_request(nodes, goal="Fill my KYC form", **kw):
    return {"taskGoal": goal, "skeleton": {"url": "http://127.0.0.1:4173/kyc/", "title": "KYC", "nodes": nodes}, **kw}
