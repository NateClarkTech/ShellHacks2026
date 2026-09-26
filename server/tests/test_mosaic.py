import numpy as np

from server.vision.mosaic import best_observation, lines_by_slot, pack_strips
from server.vision.names import NameIndex


def test_lines_map_back_to_their_strips_and_gutters_are_ignored():
    strips = [np.full((36, 180, 3), 20 * (index + 1), np.uint8) for index in range(3)]
    _jpeg, slots, size = pack_strips(strips)
    width, height = size
    lines = []
    for index, slot in enumerate(slots):
        lines.append(
            {
                "text": f"Name {index}",
                "quality": 1,
                "box": {
                    "cx": (slot["x"] + slot["w"] / 2) / width,
                    "cy": (slot["y"] + slot["h"] / 2) / height,
                    "w": 0.05,
                    "h": 0.02,
                },
            }
        )
    gutter = {
        "text": "nope",
        "quality": 1,
        "box": {"cx": 2 / width, "cy": (slots[0]["y"] + 4) / height, "w": 0.01, "h": 0.01},
    }
    groups = lines_by_slot([*lines, gutter], slots, size)
    assert [group[0]["text"] for group in groups] == ["Name 0", "Name 1", "Name 2"]
    assert all(line["text"] != "nope" for group in groups for line in group)


def test_the_stronger_title_end_wins():
    index = NameIndex(["Sol Ring", "Forest"])
    box = {"cx": 0.5, "cy": 0.5, "w": 0.2, "h": 0.3}
    weak = {"text": "sol rng", "quality": 1, "box": box}
    strong = {"text": "Sol Ring", "quality": 1, "box": box}
    found = best_observation([weak, strong], index, box)
    assert found["name"] == "Sol Ring"
    assert found["confidence"] == 1
    assert found["box"] is box
