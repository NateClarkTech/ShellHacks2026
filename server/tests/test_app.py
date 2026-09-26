import json

from fastapi.testclient import TestClient

from server.app import app
from server import app as app_module


def test_health_reports_missing_keys(monkeypatch):
    monkeypatch.delenv("CARDSIGHT_API_KEY", raising=False)
    monkeypatch.delenv("AZURE_VISION_KEY", raising=False)
    monkeypatch.delenv("AZURE_VISION_ENDPOINT", raising=False)
    body = TestClient(app).get("/api/health").json()
    assert body["cardsight"] is False
    assert body["azure"] is False
    assert isinstance(body["names"], int)


def test_empty_upload_is_rejected():
    response = TestClient(app).post(
        "/api/scan",
        files={"image": ("board.jpg", b"", "image/jpeg")},
    )
    assert response.status_code == 400


def test_scan_returns_the_pipeline_result(monkeypatch):
    async def fake(data, content_type=None):
        assert data
        return {
            "warnings": ["Azure vision key is not set."],
            "cardsight": [{"name": "Island", "confidence": 0.95, "suggestions": []}],
            "ocr": [],
        }

    monkeypatch.setattr(app_module, "run_scan", fake)
    response = TestClient(app).post(
        "/api/scan",
        files={"image": ("board.jpg", b"not-an-image", "image/jpeg")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["cardsight"][0]["name"] == "Island"
    assert "Azure" in body["warnings"][0]


def test_a_seat_id_is_accepted(monkeypatch):
    seen = {}

    async def fake(data, content_type=None, *, controller=None, zone=None, session=None, mode="add"):
        del data, content_type, session, mode
        seen["controller"] = controller
        seen["zone"] = zone
        return {"warnings": [], "cardsight": [], "ocr": [], "scene": "close"}

    monkeypatch.setattr(app_module, "run_scan", fake)
    response = TestClient(app).post(
        "/api/scan",
        data={"controller": "seat1", "zone": "graveyard", "mode": "add"},
        files={"image": ("board.jpg", b"jpeg-bytes", "image/jpeg")},
    )
    assert response.status_code == 200
    assert seen == {"controller": "seat1", "zone": "graveyard"}


def test_a_scan_stream_sends_the_time_budget_then_the_result(monkeypatch):
    async def fake(data, content_type=None, *, controller=None, zone=None, session=None, mode="add", on_progress=None):
        del data, content_type, session, mode
        assert controller == "seat2"
        assert zone == "exile"
        assert on_progress is not None
        await on_progress({"event": "progress", "done": 0, "total": 4, "seconds": 1.25, "budget": 1.25})
        return {"warnings": [], "cardsight": [], "ocr": [], "scene": "close", "photoId": "photo"}

    monkeypatch.setattr(app_module, "run_scan", fake)
    response = TestClient(app).post(
        "/api/scan",
        data={"controller": "seat2", "zone": "exile", "mode": "add"},
        files={"image": ("board.jpg", b"jpeg-bytes", "image/jpeg")},
        headers={"Accept": "application/x-ndjson"},
    )
    assert response.status_code == 200
    assert "application/x-ndjson" in response.headers["content-type"]
    lines = [line for line in response.text.splitlines() if line]
    assert len(lines) == 2
    progress = json.loads(lines[0])
    result = json.loads(lines[1])
    assert progress["budget"] == 1.25
    assert progress["total"] == 4
    assert result["event"] == "result"
    assert result["photoId"] == "photo"
    assert result["scene"] == "close"


def test_a_compass_seat_is_rejected():
    response = TestClient(app).post(
        "/api/scan",
        data={"controller": "south", "zone": "battlefield"},
        files={"image": ("board.jpg", b"jpeg-bytes", "image/jpeg")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Pick a seat before scanning."
