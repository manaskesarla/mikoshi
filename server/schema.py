"""Request/response contracts for /agent/step.

The server only ever receives sanitized data:
  - screenshot:   a data: URL of the redacted (blacked-out) image
  - skeleton:     page structure with field values reduced to empty/filled/readonly
  - taskGoal/history/extracted: text in which sensitive values were replaced by tokens
  - vaultContext: token -> category (never values)
"""
from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

ActionName = Literal[
    "click", "type", "select", "scroll", "submit", "wait", "done",
    "navigate", "open_tab", "search", "extract", "ask_user",
]
Mode = Literal["act", "read_only"]

TOKEN_RE = re.compile(r"^\[[A-Z0-9]+_\d+\]$")
MUTATING = {"type", "select", "submit"}
READ_ONLY_ALLOWED = {"click", "scroll", "wait", "done", "navigate", "open_tab", "search", "extract", "ask_user"}
NEEDS_TARGET = {"click", "type", "select", "submit"}


class SkeletonNode(BaseModel):
    id: str
    tag: str
    type: Optional[str] = None
    role: Optional[str] = None
    label: str = ""
    name: Optional[str] = None
    required: bool = False
    state: str = "n/a"
    piiCategory: Optional[str] = None
    visible: bool = True
    bbox: dict[str, float] = Field(default_factory=dict)
    options: Optional[list[dict[str, Any]]] = None
    text: Optional[str] = None
    href: Optional[str] = None
    formOrigin: Optional[str] = None
    formCrossOrigin: Optional[bool] = None
    landmark: Optional[str] = None
    isSubmit: Optional[bool] = None
    isCensored: bool = False
    fillToken: Optional[str] = None
    skip: Optional[bool] = None


class Skeleton(BaseModel):
    url: str = ""
    title: str = ""
    viewport: dict[str, float] = Field(default_factory=dict)
    scroll: dict[str, float] = Field(default_factory=dict)
    nodes: list[SkeletonNode] = Field(default_factory=list)


class VisionDetection(BaseModel):
    category: str
    confidence: float
    sources: list[str] = Field(default_factory=list)
    bbox: dict[str, float] = Field(default_factory=dict)
    fieldId: Optional[str] = None


class HistoryItem(BaseModel):
    step: int
    action: Optional[dict[str, Any]] = None
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class StepRequest(BaseModel):
    taskGoal: str
    mode: Mode = "act"
    step: int = 1
    skeleton: Skeleton
    visionDetections: list[VisionDetection] = Field(default_factory=list)
    screenshot: Optional[str] = None
    history: list[HistoryItem] = Field(default_factory=list)
    extracted: dict[str, str] = Field(default_factory=dict)
    vaultContext: dict[str, str] = Field(default_factory=dict)


class Action(BaseModel):
    action: ActionName
    targetId: Optional[str] = None
    targetIds: Optional[list[str]] = None
    piiCategory: Optional[str] = None
    fillToken: Optional[str] = None
    literalValue: Optional[str] = None
    url: Optional[str] = None
    query: Optional[str] = None
    name: Optional[str] = None
    question: Optional[str] = None
    reason: Optional[str] = None

    @model_validator(mode="after")
    def _shape(self) -> "Action":
        a = self.action
        if a in NEEDS_TARGET and not self.targetId:
            raise ValueError(f"{a} needs targetId")
        if a in ("type", "select") and not (self.fillToken or self.literalValue):
            raise ValueError(f"{a} needs fillToken or literalValue")
        if a in ("navigate", "open_tab") and not self.url:
            raise ValueError(f"{a} needs url")
        if a == "search" and not self.query:
            raise ValueError("search needs query")
        if a == "extract" and not (self.name and self.targetIds):
            raise ValueError("extract needs name and targetIds")
        if a == "ask_user" and not self.question:
            raise ValueError("ask_user needs question")
        if self.fillToken and not TOKEN_RE.match(self.fillToken):
            raise ValueError("fillToken is not a token")
        return self


class StepResponse(BaseModel):
    actions: list[Action] = Field(default_factory=list)
    rationale: str = ""
    done: bool = False
    summary: Optional[str] = None
    latency_ms: Optional[int] = None
    model: str = ""
