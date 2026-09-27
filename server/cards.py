"""Oracle text, rulings, and collision tags for any printed name."""

import json
from pathlib import Path

import httpx

from server.vision.names import norm_name

ROOT = Path(__file__).resolve().parents[1]
CACHE_PATH = ROOT / "server" / "data" / "oracle-cache.json"
TAG_INDEX_PATH = ROOT / "server" / "data" / "tag-index.json"
MUTED_PATH = ROOT / "src" / "candidates" / "muted-tags.json"
SCRYFALL = "https://api.scryfall.com/cards/named"
HEADERS = {"User-Agent": "commander-table/0.1", "Accept": "application/json"}

_memory: dict[str, dict] = {}
_tags: dict | None = None
_muted: set[str] | None = None


def reset_caches() -> None:
    global _tags, _muted
    _memory.clear()
    _tags = None
    _muted = None


def _read_json(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _tag_index() -> dict:
    global _tags
    if _tags is None:
        loaded = _read_json(TAG_INDEX_PATH)
        _tags = loaded if isinstance(loaded, dict) else {}
    return _tags


def _muted_ids() -> set[str]:
    global _muted
    if _muted is None:
        loaded = _read_json(MUTED_PATH)
        _muted = {item for item in loaded if isinstance(item, str)} if isinstance(loaded, list) else set()
    return _muted


def tags_for(oracle_id: str | None) -> list[dict]:
    if not oracle_id:
        return []
    muted = _muted_ids()
    rows = []
    for tag in _tag_index().get(oracle_id, []):
        if not isinstance(tag, dict) or tag.get("id") in muted:
            continue
        if tag.get("family") and tag.get("slug"):
            rows.append({"id": tag["id"], "slug": tag["slug"], "family": tag["family"]})
    return rows


def _oracle_text(card: dict) -> str:
    if card.get("oracle_text"):
        return card["oracle_text"]
    faces = card.get("card_faces") or []
    return "\n".join(face.get("oracle_text", "") for face in faces if face.get("oracle_text"))


def map_card(card: dict, rulings: list[dict], queried: str) -> dict:
    name = card["name"]
    matched = name if norm_name(name) != norm_name(queried) else None
    return {
        "name": name,
        "oracle_id": card["oracle_id"],
        "oracle_text": _oracle_text(card),
        "type_line": card.get("type_line") or "",
        "rulings": [{"published_at": row["published_at"], "comment": row["comment"]} for row in rulings],
        "tags": tags_for(card.get("oracle_id")),
        "matched_name": matched,
    }


def _disk_cache() -> dict:
    loaded = _read_json(CACHE_PATH)
    return loaded if isinstance(loaded, dict) else {}


def _store(key: str, card: dict) -> dict:
    _memory[key] = card
    cache = _disk_cache()
    cache[key] = card
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache), encoding="utf-8")
    return card


async def _named(client: httpx.AsyncClient, name: str, *, fuzzy: bool) -> dict | None:
    response = await client.get(SCRYFALL, params={"fuzzy" if fuzzy else "exact": name}, headers=HEADERS)
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        return None
    return response.json()


async def _rulings(client: httpx.AsyncClient, card: dict) -> list[dict]:
    url = card.get("rulings_uri")
    rows: list[dict] = []
    while url:
        response = await client.get(url, headers=HEADERS)
        response.raise_for_status()
        payload = response.json()
        rows.extend(payload.get("data") or [])
        url = payload.get("next_page") if payload.get("has_more") else None
    return rows


async def fetch_card(name: str) -> dict | None:
    async with httpx.AsyncClient(timeout=20) as client:
        card = await _named(client, name, fuzzy=False)
        if card is None:
            card = await _named(client, name, fuzzy=True)
        if card is None:
            return None
        rulings = await _rulings(client, card)
    return map_card(card, rulings, name)


async def lookup_card(name: str) -> dict | None:
    key = norm_name(name)
    if not key:
        return None
    if key in _memory:
        return _memory[key]
    cached = _disk_cache().get(key)
    if isinstance(cached, dict):
        _memory[key] = cached
        return cached
    card = await fetch_card(name)
    if card is None:
        return None
    return _store(key, card)
