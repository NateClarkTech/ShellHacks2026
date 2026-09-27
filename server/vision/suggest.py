import asyncio
import json
import re
from pathlib import Path

import httpx
from rapidfuzz import fuzz, process

from server.vision.names import norm_name
from server.vision.scan import CATALOG_HEADERS, load_name_list

TOKEN_CACHE = Path(__file__).resolve().parents[1] / "data" / "token-variants.json"
TOKEN_SEARCH = "https://api.scryfall.com/cards/search?q=layout%3Atoken&unique=oracle"
_REMINDER = re.compile(r"\s*\([^)]*\)")
_COLOR = {"W": "W", "U": "U", "B": "B", "R": "R", "G": "G"}

_suggester = None
_lock = asyncio.Lock()


def token_detail(card: dict) -> str:
    """A short line that tells two tokens with the same name apart."""
    faces = card.get("card_faces") if card.get("power") is None and card.get("card_faces") else None
    if faces:
        return " // ".join(part for part in (_face_detail(face) for face in faces) if part)
    return _face_detail(card)


def _face_detail(card: dict) -> str:
    bits = []
    type_line = card.get("type_line") or ""
    if "Token" in type_line:
        bits.append("Token")
    power, toughness = card.get("power"), card.get("toughness")
    if power is not None and toughness is not None:
        bits.append(f"{power}/{toughness}")
    colors = "".join(_COLOR[color] for color in (card.get("colors") or []) if color in _COLOR)
    if colors:
        bits.append(colors)
    text = _REMINDER.sub("", (card.get("oracle_text") or "").split("\n")[0]).strip()
    if text:
        bits.append(text[:72])
    if not bits and type_line:
        bits.append(type_line)
    return " · ".join(bits)


def entries_from(names: list[str], tokens: list[dict]) -> list[dict]:
    variants = []
    seen = set()
    token_names = set()
    for token in tokens:
        name = str(token.get("name") or "").strip()
        detail = str(token.get("detail") or "").strip()
        if not name or not detail:
            continue
        key = (name, detail)
        if key in seen:
            continue
        seen.add(key)
        token_names.add(name)
        variants.append({"name": name, "detail": detail})
    cards = [{"name": name, "detail": ""} for name in names if name and name not in token_names]
    return cards + variants


class Suggester:
    def __init__(self, entries: list[dict]):
        self.entries = entries
        self.name_keys = [norm_name(entry["name"]) for entry in entries]
        self.full_keys = [norm_name(f"{entry['name']} {entry['detail']}") for entry in entries]
        self.by_name: dict[str, list[int]] = {}
        for index, name_key in enumerate(self.name_keys):
            self.by_name.setdefault(name_key, []).append(index)
        self.unique_names = list(self.by_name)

    def suggest(self, query: str, limit: int = 12) -> list[dict]:
        key = norm_name(query)
        if len(key) < 2 or not self.entries:
            return []
        chosen: dict[int, float] = {}
        # A short query matches the start of the name, so "rat" lists Rat and
        # Rat Colony, not every word that happens to contain those letters.
        if len(key) < 5:
            names = [name for name in self.unique_names if name.startswith(key)]
            names.sort(key=lambda name: (name != key, len(name), name))
            for name_key in names[:limit]:
                score = 100 if name_key == key else 92
                for entry_index in self.by_name[name_key]:
                    chosen[entry_index] = score
        else:
            hits = process.extract(
                key,
                self.unique_names,
                scorer=fuzz.WRatio,
                score_cutoff=74,
                limit=limit,
            )
            for name_key, score, _index in hits:
                for entry_index in self.by_name[name_key]:
                    chosen[entry_index] = max(chosen.get(entry_index, 0), score)
        if len(key) >= 5:
            detail_hits = process.extract(
                key,
                self.full_keys,
                scorer=fuzz.partial_ratio,
                score_cutoff=90,
                limit=limit,
            )
            for _text, score, entry_index in detail_hits:
                chosen[entry_index] = max(chosen.get(entry_index, 0), score)
        ranked = []
        for entry_index, score in chosen.items():
            entry = self.entries[entry_index]
            name_key = self.name_keys[entry_index]
            ranked.append((
                0 if name_key == key else 1,
                0 if name_key.startswith(key) else 1,
                -score,
                name_key,
                entry["detail"],
                entry,
            ))
        ranked.sort()
        return [{"name": item[-1]["name"], "detail": item[-1]["detail"]} for item in ranked[:limit]]


def compact_token(card: dict) -> dict | None:
    name = str(card.get("name") or "").strip()
    detail = token_detail(card)
    if not name or not detail:
        return None
    return {"name": name, "detail": detail}


async def load_token_variants() -> list[dict]:
    if TOKEN_CACHE.exists():
        try:
            cached = json.loads(TOKEN_CACHE.read_text())
            if isinstance(cached, list):
                return [item for item in cached if isinstance(item, dict)]
        except (OSError, json.JSONDecodeError):
            pass
    found = []
    url = TOKEN_SEARCH
    async with httpx.AsyncClient(timeout=30, headers=CATALOG_HEADERS) as client:
        while url:
            response = await client.get(url)
            response.raise_for_status()
            payload = response.json()
            for card in payload.get("data") or []:
                compact = compact_token(card)
                if compact:
                    found.append(compact)
            url = payload.get("next_page")
            if url:
                await asyncio.sleep(0.1)
    TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_CACHE.write_text(json.dumps(found))
    return found


async def get_suggester() -> Suggester:
    global _suggester
    if _suggester is not None:
        return _suggester
    async with _lock:
        if _suggester is None:
            names = await load_name_list()
            try:
                tokens = await load_token_variants()
            except (httpx.HTTPError, OSError, json.JSONDecodeError, RuntimeError):
                tokens = []
            _suggester = Suggester(entries_from(names, tokens))
        return _suggester


async def suggest_names(query: str) -> list[dict]:
    try:
        suggester = await get_suggester()
    except (httpx.HTTPError, OSError, json.JSONDecodeError, RuntimeError):
        return []
    return suggester.suggest(query)
