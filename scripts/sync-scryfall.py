#!/usr/bin/env python3
"""Refresh fixtures/cards/catalog.json from the names in fixtures/cards/names.txt.

Stdlib only. Not used at runtime. Scryfall asks for a short pause between calls.
"""

import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = ROOT / "fixtures" / "cards" / "names.txt"
OUT = ROOT / "fixtures" / "cards" / "catalog.json"
PAUSE = 0.1
UA = "commander-table/0.1 (local clarification catalog)"


def https_context() -> ssl.SSLContext:
    # python.org builds on macOS often have an empty default trust store.
    context = ssl.create_default_context()
    bundle = Path("/etc/ssl/cert.pem")
    if bundle.exists():
        context.load_verify_locations(cafile=bundle)
    return context


HTTPS = https_context()


def get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30, context=HTTPS) as response:
        return json.load(response)


def rulings_for(url: str) -> list[dict]:
    rows = []
    while url:
        payload = get(url)
        for row in payload.get("data", []):
            rows.append({"published_at": row["published_at"], "comment": row["comment"]})
        url = payload.get("next_page") if payload.get("has_more") else None
        if url:
            time.sleep(PAUSE)
    return rows


def oracle_text(card: dict) -> str:
    if card.get("oracle_text"):
        return card["oracle_text"]
    faces = card.get("card_faces") or []
    return "\n".join(face.get("oracle_text", "") for face in faces if face.get("oracle_text"))


def main() -> None:
    names = [
        line.strip()
        for line in NAMES.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    catalog = {}
    for index, name in enumerate(names):
        if index:
            time.sleep(PAUSE)
        try:
            card = get("https://api.scryfall.com/cards/named?exact=" + urllib.parse.quote(name))
        except urllib.error.HTTPError as error:
            raise SystemExit(f"{name}: Scryfall returned {error.code}") from error
        time.sleep(PAUSE)
        catalog[card["oracle_id"]] = {
            "name": card["name"],
            "oracle_id": card["oracle_id"],
            "oracle_text": oracle_text(card),
            "rulings": rulings_for(card["rulings_uri"]),
        }
        print(f"{card['name']} {card['oracle_id']} ({len(catalog[card['oracle_id']]['rulings'])} rulings)")
    OUT.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(catalog)} cards to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
