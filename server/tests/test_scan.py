import asyncio

import cv2

from server.tests.test_detect import _canvas, _paint_card
from server.vision.cardsight import sight_seconds
from server.vision.scan import identify_magic, scan_seat
from server.vision.sessions import MEMORY


def _jpeg(image) -> bytes:
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return encoded.tobytes()


def test_a_wide_scene_makes_no_api_call(monkeypatch):
    MEMORY.clear()

    async def boom(_image):
        raise AssertionError("the wide scene called an API")

    monkeypatch.setattr("server.vision.scan._azure_read", boom)
    monkeypatch.setattr("server.vision.scan.identify_magic", boom)
    image = _canvas(900, 900, seed=9)
    for x, y in ((40, 40), (250, 40), (40, 400), (250, 400)):
        _paint_card(image, x, y, 70, 100)
    result = asyncio.run(scan_seat(_jpeg(image), "south", "battlefield", "wide", "add"))
    assert result["scene"] == "wide"
    assert result["ocr"] == []
    assert result["cardsight"] == []
    assert "Move closer" in result["warnings"][0]


def test_a_close_photo_is_one_read_and_the_same_bytes_replay(monkeypatch):
    MEMORY.clear()
    reads = []

    async def fake_read(image):
        reads.append(image)
        return {"analyzeResult": {"readResults": []}}

    async def fake_sight(_image):
        return [], None

    monkeypatch.setattr("server.vision.scan._azure_read", fake_read)
    monkeypatch.setattr("server.vision.scan.identify_magic", fake_sight)
    image = _canvas(1000, 1200, seed=11)
    _paint_card(image, 80, 80, 220, 310)
    _paint_card(image, 520, 80, 220, 310)
    payload = _jpeg(image)
    first = asyncio.run(scan_seat(payload, "north", "graveyard", "close", "add"))
    second = asyncio.run(scan_seat(payload, "north", "graveyard", "close", "add"))
    assert first["scene"] == "close"
    assert first["photoId"]
    assert first["ocr"]
    assert all(row["image"].startswith("data:image/jpeg;base64,") for row in first["ocr"])
    assert len(reads) == 1
    assert second["replayed"] is True
    assert second["photoId"] == first["photoId"]
    assert len(reads) == 1


def test_a_close_photo_budgets_cardsight_before_the_calls(monkeypatch):
    MEMORY.clear()
    events = []

    async def fake_read(_image):
        return {"analyzeResult": {"readResults": []}}

    async def fake_sight(_image):
        return [{"name": "Island", "confidence": 0.95, "suggestions": []}], None

    async def on_progress(event):
        events.append(dict(event))

    monkeypatch.setattr("server.vision.scan._azure_read", fake_read)
    monkeypatch.setattr("server.vision.scan.identify_magic", fake_sight)
    image = _canvas(1000, 1200, seed=12)
    _paint_card(image, 80, 80, 220, 310)
    _paint_card(image, 520, 80, 220, 310)
    result = asyncio.run(
        scan_seat(_jpeg(image), "seat1", "battlefield", "budget", "add", on_progress=on_progress)
    )
    assert result["scene"] == "close"
    assert events
    assert events[0]["done"] == 0
    assert events[0]["total"] == len(result["cardsight"])
    assert events[0]["total"] >= 1
    assert events[0]["budget"] == sight_seconds(events[0]["total"])
    assert events[0]["seconds"] == events[0]["budget"]
    assert events[-1]["done"] == events[0]["total"]


def test_identify_magic_takes_a_cardsight_slot(monkeypatch):
    monkeypatch.setenv("CARDSIGHT_API_KEY", "test-key")
    taken = []

    class Limiter:
        async def acquire(self):
            taken.append("slot")

    class Response:
        status_code = 200

        def json(self):
            return {
                "success": True,
                "detections": [{"confidence": "High", "card": {"name": "Island", "suggestions": []}}],
            }

    class Client:
        def __init__(self, *args, **kwargs):
            del args, kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, content):
            assert url.endswith("/identify/card/mtg")
            assert headers["X-API-Key"] == "test-key"
            assert content
            return Response()

    monkeypatch.setattr("server.vision.scan.SIGHT_LIMITER", Limiter())
    monkeypatch.setattr("server.vision.scan.httpx.AsyncClient", Client)
    found, warning = asyncio.run(identify_magic(b"jpeg"))
    assert taken == ["slot"]
    assert warning is None
    assert found[0]["name"] == "Island"


def test_a_missing_cardsight_key_does_not_take_a_slot(monkeypatch):
    monkeypatch.delenv("CARDSIGHT_API_KEY", raising=False)
    taken = []

    class Limiter:
        async def acquire(self):
            taken.append("slot")

    monkeypatch.setattr("server.vision.scan.SIGHT_LIMITER", Limiter())
    found, warning = asyncio.run(identify_magic(b"jpeg"))
    assert taken == []
    assert found == []
    assert "key" in warning
