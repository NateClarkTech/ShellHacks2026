import json

import httpx
from fastapi.testclient import TestClient

from server import clarify
from server.app import app


def board(*names):
    return {
        "game_state": {
            "players": [{"id": "seat1", "display_name": "Seat 1", "life": 40, "poison": 0, "commander_names": []}],
            "objects": [
                {
                    "id": f"obj-{index}",
                    "name": name,
                    "zone": "battlefield",
                    "controller": "seat1",
                    "oracle_id": f"oracle-{index}",
                    "oracle_text": "text",
                    "rulings": [],
                }
                for index, name in enumerate(names)
            ],
            "unknowns": ["timestamps"],
        },
        "focus": {"selected_object_ids": ["obj-0", "obj-1"], "auto_included_object_ids": []},
    }


def row(**extra):
    base = {
        "headline": "How do Blood Moon and Urborg, Tomb of Yawgmoth interact?",
        "one_liner": "Blood Moon removes the ability of Urborg, Tomb of Yawgmoth.",
        "verdict": "applies",
        "citations": ["cr:613.1d", "ruling:oracle-1"],
        "depends_on": [],
        "object_ids": ["obj-0", "obj-1"],
        "card_names": ["Blood Moon", "Urborg, Tomb of Yawgmoth"],
        "choices": [],
    }
    base.update(extra)
    return base


def test_a_well_formed_reply_is_kept():
    payload = board("Blood Moon", "Urborg, Tomb of Yawgmoth")
    kept = clarify.accept(payload, [row()])
    assert kept[0]["source_tier"] == "llm"
    assert kept[0]["verdict"] == "applies"
    assert kept[0]["citations"] == ["cr:613.1d", "ruling:oracle-1"]


def test_a_card_that_is_not_on_the_board_is_dropped():
    payload = board("Blood Moon", "Urborg, Tomb of Yawgmoth")
    foreign = row(
        one_liner="Sol Ring is what actually matters.",
        card_names=["Blood Moon", "Sol Ring"],
    )
    assert clarify.accept(payload, [foreign]) == []


def test_a_missing_key_does_not_call_the_model(monkeypatch):
    monkeypatch.delenv("XAI_API_KEY", raising=False)

    def explode(*_args, **_kwargs):
        raise AssertionError("xAI was called")

    monkeypatch.setattr(httpx.AsyncClient, "post", explode)
    response = TestClient(app).post("/api/clarify", json=board("Blood Moon", "Urborg, Tomb of Yawgmoth"))
    assert response.status_code == 503
    assert "key" in response.json()["detail"]


def test_the_route_parses_a_mocked_model_reply(monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "test-key")
    payload = board("Blood Moon", "Urborg, Tomb of Yawgmoth")

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"output_text": json.dumps({"clarifications": [row()]})}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, headers, json):
            assert url == clarify.URL
            assert headers["Authorization"] == "Bearer test-key"
            assert json["model"] == "grok-4.7"
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post("/api/clarify", json=payload)
    assert response.status_code == 200
    assert response.json()["clarifications"][0]["source_tier"] == "llm"
