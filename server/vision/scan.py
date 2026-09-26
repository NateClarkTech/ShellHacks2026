import asyncio
import base64
import json
import os
import time
import uuid
from pathlib import Path

import cv2
import httpx
import numpy as np

from server.vision.cardsight import parse_cardsight
from server.vision.detect import detect_cards, orient_warp
from server.vision.images import prepare_image
from server.vision.mosaic import choose_ends, pack_strips
from server.vision.names import NameIndex
from server.vision.ocr import READ_PATH, lines_to_observations, parse_read_result
from server.vision.sessions import MEMORY, digest

CATALOG_URL = "https://api.scryfall.com/catalog/card-names"
CACHE = Path(__file__).resolve().parents[1] / "data" / "card-names.json"
CATALOG_HEADERS = {"User-Agent": "commander-table/0.1", "Accept": "application/json"}

_index: NameIndex | None = None
_index_lock = asyncio.Lock()


async def load_name_list() -> list[str]:
    if CACHE.exists():
        cached = json.loads(CACHE.read_text())
        if isinstance(cached, list) and cached:
            return cached
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=60, headers=CATALOG_HEADERS) as client:
        response = await client.get(CATALOG_URL)
        response.raise_for_status()
        names = response.json().get("data")
    if not isinstance(names, list) or not names:
        raise RuntimeError("card name catalog was empty")
    CACHE.write_text(json.dumps(names))
    return names


async def get_index() -> NameIndex:
    global _index
    if _index is not None:
        return _index
    async with _index_lock:
        if _index is None:
            _index = NameIndex(await load_name_list())
        return _index


def _read_url(endpoint: str) -> str:
    base = endpoint.rstrip("/")
    if base.endswith("/vision/v3.2"):
        return base + "/read/analyze"
    return base + READ_PATH


async def _azure_read(image: bytes) -> dict:
    endpoint = os.environ["AZURE_VISION_ENDPOINT"]
    key = os.environ["AZURE_VISION_KEY"]
    headers = {"Ocp-Apim-Subscription-Key": key}
    async with httpx.AsyncClient(timeout=30) as client:
        started = await client.post(
            _read_url(endpoint),
            headers={**headers, "Content-Type": "application/octet-stream"},
            content=image,
        )
        started.raise_for_status()
        operation = started.headers["Operation-Location"]
        deadline = time.monotonic() + 12
        while True:
            poll = await client.get(operation, headers=headers)
            poll.raise_for_status()
            payload = poll.json()
            status = str(payload.get("status", "")).lower()
            if status == "succeeded":
                return payload
            if status == "failed":
                raise RuntimeError("Azure Read failed")
            if time.monotonic() > deadline:
                raise TimeoutError("Azure Read timed out")
            await asyncio.sleep(0.4)


async def identify_magic(image: bytes) -> tuple[list[dict], str | None]:
    key = os.environ.get("CARDSIGHT_API_KEY")
    if not key:
        return [], "CardSight key is not set."
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                "https://api.cardsight.ai/v1/identify/card/mtg",
                headers={"X-API-Key": key, "Content-Type": "image/jpeg"},
                content=image,
            )
    except httpx.HTTPError:
        return [], "CardSight could not be reached."
    if response.status_code == 401:
        return [], "CardSight rejected the API key."
    if response.status_code == 429:
        return [], "CardSight rate limit reached."
    if response.status_code >= 400:
        return [], f"CardSight failed ({response.status_code})."
    payload = response.json()
    if payload.get("success") is False:
        return [], "CardSight did not identify that image."
    return parse_cardsight(payload), None


async def read_titles(image: bytes) -> tuple[list[dict], str | None]:
    if not os.environ.get("AZURE_VISION_KEY") or not os.environ.get("AZURE_VISION_ENDPOINT"):
        return [], "Azure vision key is not set."
    try:
        index = await get_index()
    except (httpx.HTTPError, OSError, RuntimeError, json.JSONDecodeError, KeyError):
        return [], "The card name list could not be loaded, so titles were not matched."
    try:
        payload = await _azure_read(image)
    except (httpx.HTTPError, TimeoutError, RuntimeError, KeyError):
        return [], "The title scan could not be reached."
    return lines_to_observations(parse_read_result(payload), index), None


GUESS_AT = 0.75
SIGHT_CAP = 8
SEAT_ZONES = {"battlefield", "graveyard", "exile", "command"}


async def run_scan(
    image_bytes: bytes,
    content_type: str | None = None,
    *,
    controller: str | None = None,
    zone: str | None = None,
    session: str | None = None,
    mode: str = "add",
) -> dict:
    del content_type
    if controller:
        return await scan_seat(image_bytes, controller, zone, session, mode)
    try:
        prepared = prepare_image(image_bytes)
    except ValueError:
        return {
            "warnings": ["Could not read that image. Use a JPEG or PNG."],
            "cardsight": [],
            "ocr": [],
        }
    cardsight, titles = await asyncio.gather(identify_magic(prepared), read_titles(prepared))
    warnings = [warning for warning in (cardsight[1], titles[1]) if warning]
    return {"warnings": warnings, "cardsight": cardsight[0], "ocr": titles[0]}


def _jpeg(image: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        raise RuntimeError("could not encode a card crop")
    return encoded.tobytes()


def _crop_image(crop: dict, pick: tuple[str, dict] | None) -> str:
    """The upright warp, small enough to keep beside the card name."""
    end = pick[0] if pick else "top"
    view = orient_warp(crop["warp"], end)
    height, width = view.shape[:2]
    if width > 180:
        scale = 180 / width
        view = cv2.resize(view, (180, max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".jpg", view, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(encoded.tobytes()).decode("ascii")


def _blank(crop: dict, note: str, image: str) -> dict:
    return {
        "name": None,
        "confidence": 0,
        "alternatives": [],
        "box": crop["box"],
        "note": note,
        "image": image,
    }


async def scan_seat(
    image_bytes: bytes,
    controller: str,
    zone: str | None,
    session: str | None,
    mode: str,
) -> dict:
    del controller, zone, mode
    photo_id = str(uuid.uuid4())
    key = digest(image_bytes)
    cached = MEMORY.recall(session, key)
    if cached is not None:
        return {**cached, "replayed": True}
    try:
        prepared = prepare_image(image_bytes)
    except ValueError:
        return _seat_result(["Could not read that image. Use a JPEG or PNG."], scene="empty")
    bgr = cv2.imdecode(np.frombuffer(prepared, dtype=np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        return _seat_result(["Could not read that image. Use a JPEG or PNG."], scene="empty")
    found = detect_cards(bgr)
    if found["scene"] == "wide":
        result = _seat_result(
            ["Move closer. Those cards are too small to read."],
            scene="wide",
        )
        MEMORY.remember(session, key, result)
        return result
    if found["scene"] == "empty" or not found["crops"]:
        result = _seat_result(
            ["No cards found. Leave a gap between cards and try again."],
            scene="empty",
        )
        MEMORY.remember(session, key, result)
        return result

    crops = found["crops"]
    strips = []
    slot_meta = []
    for index, crop in enumerate(crops):
        for end, strip in crop["ends"]:
            strips.append(strip)
            slot_meta.append((index, end))
    warnings: list[str] = []
    chosen: dict[int, tuple[str, dict]] = {}
    if strips:
        try:
            mosaic, slots, size = pack_strips(strips)
            payload = await _azure_read(mosaic)
        except (httpx.HTTPError, TimeoutError, RuntimeError, KeyError, ValueError):
            if not os.environ.get("AZURE_VISION_KEY") or not os.environ.get("AZURE_VISION_ENDPOINT"):
                warnings.append("Azure vision key is not set.")
            else:
                warnings.append("The title scan could not be reached.")
        else:
            try:
                index = await get_index()
            except (httpx.HTTPError, OSError, RuntimeError, json.JSONDecodeError, KeyError):
                warnings.append("The card name list could not be loaded, so titles were not matched.")
            else:
                chosen = choose_ends(
                    payload,
                    slots,
                    size,
                    slot_meta,
                    [crop["box"] for crop in crops],
                    index,
                )

    views = [_crop_image(crop, chosen.get(index)) for index, crop in enumerate(crops)]
    ocr = []
    sight_indexes = []
    for index, _crop in enumerate(crops):
        pick = chosen.get(index)
        observation = pick[1] if pick else None
        if observation is not None:
            ocr.append({**observation, "image": views[index]})
            # An exact basic or token is 1.0, so it never spends a CardSight call.
            if observation["confidence"] >= GUESS_AT:
                continue
        sight_indexes.append(index)
    if len(sight_indexes) > SIGHT_CAP:
        warnings.append("Some cards were too shiny. Retake those.")
        sight_indexes = sight_indexes[:SIGHT_CAP]

    sight_rows = await asyncio.gather(
        *(_one_sight(index, crops[index], chosen.get(index)) for index in sight_indexes)
    )
    cardsight = []
    covered: set[int] = set()
    seen_warning = set(warnings)
    for index, detection, warning in sight_rows:
        if warning and warning not in seen_warning:
            warnings.append(warning)
            seen_warning.add(warning)
        if detection is not None:
            cardsight.append({**detection, "image": views[index]})
            covered.add(index)
    for index, crop in enumerate(crops):
        if chosen.get(index) or index in covered:
            continue
        note = "Glare. Retake this photo." if crop["glare"] else "The title could not be read."
        ocr.append(_blank(crop, note, views[index]))

    result = _seat_result(warnings, ocr=ocr, cardsight=cardsight, scene="close", photo_id=photo_id)
    result["glare"] = sum(1 for crop in crops if crop["glare"])
    MEMORY.remember(session, key, result)
    return result


async def _one_sight(
    index: int, crop: dict, pick: tuple[str, dict] | None
) -> tuple[int, dict | None, str | None]:
    end = pick[0] if pick else "top"
    try:
        found, warning = await identify_magic(_jpeg(orient_warp(crop["warp"], end)))
    except (RuntimeError, ValueError):
        return index, None, "A card crop could not be sent."
    detection = dict(found[0]) if found else None
    if detection is not None:
        detection["box"] = crop["box"]
    return index, detection, warning


def _seat_result(
    warnings: list[str],
    *,
    ocr: list | None = None,
    cardsight: list | None = None,
    scene: str,
    photo_id: str | None = None,
) -> dict:
    return {
        "warnings": warnings,
        "cardsight": cardsight or [],
        "ocr": ocr or [],
        "scene": scene,
        "photoId": photo_id,
        "glare": 0,
        "replayed": False,
    }
