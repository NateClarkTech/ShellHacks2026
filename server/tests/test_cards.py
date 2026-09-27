from fastapi.testclient import TestClient

from server import cards
from server.app import app


def test_map_card_keeps_a_fuzzy_name():
    body = cards.map_card(
        {
            "name": "Rhystic Study",
            "oracle_id": "study",
            "oracle_text": "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
        },
        [{"published_at": "2004-10-04", "comment": "The opponent chooses."}],
        "Rhystic Stud",
    )
    assert body["matched_name"] == "Rhystic Study"
    assert body["rulings"][0]["published_at"] == "2004-10-04"
    assert body["tags"] == []


def test_a_second_lookup_does_not_hit_the_network(monkeypatch, tmp_path):
    cards.reset_caches()
    monkeypatch.setattr(cards, "CACHE_PATH", tmp_path / "oracle-cache.json")
    calls = {"n": 0}

    async def fake(name):
        calls["n"] += 1
        return {
            "name": "Rhystic Study",
            "oracle_id": "study",
            "oracle_text": "draw",
            "rulings": [],
            "tags": [{"id": "tax-1", "slug": "cast-tax", "family": "tax"}],
            "matched_name": None,
        }

    monkeypatch.setattr(cards, "fetch_card", fake)
    client = TestClient(app)
    first = client.get("/api/card", params={"name": "Rhystic Study"})
    second = client.get("/api/card", params={"name": "Rhystic Study"})
    assert first.status_code == 200
    assert second.json()["oracle_text"] == "draw"
    assert calls["n"] == 1
    cards.reset_caches()
