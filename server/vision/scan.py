import asyncio
import json
import os
import time
from pathlib import Path

import httpx

from server.vision.cardsight import parse_cardsight
from server.vision.images import prepare_image
from server.vision.names import NameIndex
from server.vision.ocr import READ_PATH, lines_to_observations, parse_read_result

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


async def run_scan(image_bytes: bytes, content_type: str | None = None) -> dict:
    del content_type
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
