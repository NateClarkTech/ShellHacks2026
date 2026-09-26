import io

from PIL import Image

from server.vision.cardsight import parse_cardsight
from server.vision.images import prepare_image
from server.vision.names import NameIndex
from server.vision.ocr import lines_to_observations, parse_read_result

NAMES = ["Swords to Plowshares", "Sol Ring", "Island", "Sword of Fire and Ice"]


def test_cardsight_parse_keeps_names_and_drops_a_set_only_match():
    payload = {
        "success": True,
        "detections": [
            {
                "confidence": "High",
                "card": {"name": "Sol Ring", "suggestions": []},
            },
            {
                "confidence": "Medium",
                "card": {
                    "name": "Wrath of God",
                    "suggestions": [{"name": "Damnation"}, {"name": "Wrath of God"}],
                },
            },
            {"confidence": "Low", "card": {"setName": "Alpha"}},
        ],
    }
    found = parse_cardsight(payload)
    assert found[0]["confidence"] == 0.95
    assert found[1]["suggestions"] == ["Damnation"]
    assert found[1]["confidence"] == 0.82
    assert len(found) == 2


def test_read_result_normalizes_boxes():
    payload = {
        "analyzeResult": {
            "readResults": [
                {
                    "width": 1000,
                    "height": 500,
                    "lines": [
                        {
                            "text": "Island",
                            "boundingBox": [100, 50, 300, 50, 300, 80, 100, 80],
                            "words": [{"text": "Island", "confidence": 0.99}],
                        }
                    ],
                }
            ]
        }
    }
    [line] = parse_read_result(payload)
    assert line["text"] == "Island"
    assert line["box"]["cx"] == 0.2
    assert line["box"]["cy"] == 0.13


def test_nearby_lines_collapse_and_keywords_drop():
    index = NameIndex(NAMES)
    lines = [
        {"text": "Swords to Plowshares", "quality": 1, "box": {"cx": 0.3, "cy": 0.7, "w": 0.12, "h": 0.02}},
        {"text": "Sword of Fire and Ice", "quality": 1, "box": {"cx": 0.3, "cy": 0.72, "w": 0.12, "h": 0.02}},
        {"text": "Flying", "quality": 1, "box": {"cx": 0.3, "cy": 0.74, "w": 0.08, "h": 0.02}},
        {"text": "Sol Ring", "quality": 1, "box": {"cx": 0.8, "cy": 0.3, "w": 0.1, "h": 0.02}},
        {"text": "Island", "quality": 0.2, "box": {"cx": 0.2, "cy": 0.2, "w": 0.08, "h": 0.02}},
    ]
    found = {item["name"]: item for item in lines_to_observations(lines, index)}
    assert "Flying" not in found
    assert found["Sol Ring"]["box"]["cx"] == 0.8
    assert found["Swords to Plowshares"]["alternatives"] == ["Sword of Fire and Ice"]
    assert "Island" in found
    assert found["Island"]["confidence"] >= 0.75


def test_prepare_image_returns_a_bounded_jpeg():
    image = Image.new("RGB", (2000, 1000), "navy")
    raw = io.BytesIO()
    image.save(raw, format="PNG")
    jpeg = prepare_image(raw.getvalue())
    opened = Image.open(io.BytesIO(jpeg))
    assert opened.format == "JPEG"
    assert max(opened.size) <= 1800
