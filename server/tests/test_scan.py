import asyncio

import cv2

from server.tests.test_detect import _canvas, _paint_card
from server.vision.scan import scan_seat
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
