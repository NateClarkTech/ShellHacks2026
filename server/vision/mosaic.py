import cv2
import numpy as np

from server.vision.names import NameIndex
from server.vision.ocr import parse_read_result, scored_matches

STRIP_W = 380
STRIP_H = 80
GUTTER = 16
COLUMNS = 8


def pack_strips(strips: list[np.ndarray]) -> tuple[bytes, list[dict], tuple[int, int]]:
    """One JPEG of title strips. Read bills per image, so a photo is one call."""
    if not strips:
        raise ValueError("no title strips")
    columns = min(COLUMNS, len(strips))
    rows = (len(strips) + columns - 1) // columns
    width = columns * STRIP_W + (columns + 1) * GUTTER
    height = rows * STRIP_H + (rows + 1) * GUTTER
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    slots = []
    for index, strip in enumerate(strips):
        row, column = divmod(index, columns)
        x = GUTTER + column * (STRIP_W + GUTTER)
        y = GUTTER + row * (STRIP_H + GUTTER)
        canvas[y : y + STRIP_H, x : x + STRIP_W] = cv2.resize(
            strip, (STRIP_W, STRIP_H), interpolation=cv2.INTER_CUBIC
        )
        slots.append({"x": x, "y": y, "w": STRIP_W, "h": STRIP_H})
    ok, encoded = cv2.imencode(".jpg", canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise RuntimeError("could not encode the title mosaic")
    return encoded.tobytes(), slots, (width, height)


def lines_by_slot(lines: list[dict], slots: list[dict], size: tuple[int, int]) -> list[list[dict]]:
    width, height = size
    groups: list[list[dict]] = [[] for _ in slots]
    for line in lines:
        box = line.get("box") or {}
        cx = float(box.get("cx", -1)) * width
        cy = float(box.get("cy", -1)) * height
        for index, slot in enumerate(slots):
            if slot["x"] <= cx <= slot["x"] + slot["w"] and slot["y"] <= cy <= slot["y"] + slot["h"]:
                groups[index].append(line)
                break
    return groups


def best_observation(lines: list[dict], index: NameIndex, box: dict) -> dict | None:
    ranked = []
    for line in lines:
        matches = scored_matches(line, index)
        if matches:
            ranked.append(matches)
    if not ranked:
        return None
    ranked.sort(key=lambda matches: matches[0]["confidence"], reverse=True)
    winner = ranked[0][0]
    seen = {winner["name"]}
    alternatives = []
    for matches in ranked:
        for match in matches:
            if match["name"] in seen or match["confidence"] < winner["confidence"] - 0.12:
                continue
            seen.add(match["name"])
            alternatives.append(match["name"])
    return {
        "name": winner["name"],
        "confidence": winner["confidence"],
        "alternatives": alternatives[:4],
        "box": box,
    }


def choose_ends(payload: dict, slots: list[dict], size: tuple[int, int], slot_meta: list[tuple[int, str]], boxes: list[dict], index: NameIndex) -> dict[int, tuple[str, dict]]:
    """Pick the title end whose name match is stronger. Rules text on the other end loses."""
    groups = lines_by_slot(parse_read_result(payload), slots, size)
    chosen: dict[int, tuple[str, dict]] = {}
    for slot_index, (crop_index, end) in enumerate(slot_meta):
        observation = best_observation(groups[slot_index], index, boxes[crop_index])
        if observation is None:
            continue
        current = chosen.get(crop_index)
        if current is None or observation["confidence"] > current[1]["confidence"]:
            chosen[crop_index] = (end, observation)
    return chosen
