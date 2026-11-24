import pytest
from pydantic import ValidationError

from schema import Action, StepRequest


def test_type_needs_target_and_a_value():
    with pytest.raises(ValidationError):
        Action(action="type", targetId="n1")
    with pytest.raises(ValidationError):
        Action(action="type", fillToken="[PAN_1]")
    assert Action(action="type", targetId="n1", fillToken="[PAN_1]").fillToken == "[PAN_1]"


def test_fill_token_must_look_like_a_token():
    with pytest.raises(ValidationError):
        Action(action="type", targetId="n1", fillToken="ABCPE1234F")


@pytest.mark.parametrize("data", [
    {"action": "navigate"}, {"action": "open_tab"}, {"action": "search"},
    {"action": "extract", "name": "x"}, {"action": "extract", "targetIds": ["n1"]}, {"action": "ask_user"},
    {"action": "click"}, {"action": "teleport"},
])
def test_incomplete_or_unknown_actions_are_rejected(data):
    with pytest.raises(ValidationError):
        Action(**data)


def test_valid_new_actions():
    Action(action="navigate", url="https://x.example")
    Action(action="search", query="fees")
    Action(action="extract", name="fees", targetIds=["n2"])
    Action(action="ask_user", question="Which one?")
    Action(action="done")


def test_request_defaults():
    r = StepRequest(taskGoal="x", skeleton={"nodes": []})
    assert r.mode == "act" and r.vaultContext == {} and r.extracted == {}
    with pytest.raises(ValidationError):
        StepRequest(taskGoal="x", skeleton={"nodes": []}, mode="yolo")
