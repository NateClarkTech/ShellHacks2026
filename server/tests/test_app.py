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


def test_a_compass_seat_is_rejected():
    response = TestClient(app).post(
        "/api/scan",
        data={"controller": "south", "zone": "battlefield"},
        files={"image": ("board.jpg", b"jpeg-bytes", "image/jpeg")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Pick a seat before scanning."
