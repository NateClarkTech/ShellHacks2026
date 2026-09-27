#!/usr/bin/env python3
"""Save a few cited Commander questions from RulesGuru.

Stdlib only. Two seconds between calls. Not used during a game.
"""

import json
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "rules" / "rulesguru.json"
RULES = ["613", "614", "616", "702", "704", "903"]
UA = {"User-Agent": "commander-table/0.1", "Accept": "application/json"}


def https_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    bundle = Path("/etc/ssl/cert.pem")
    if bundle.exists():
        context.load_verify_locations(cafile=bundle)
    return context


HTTPS = https_context()


def questions(rule: str) -> list:
    settings = {
        "count": 5,
        "level": ["0", "1", "2"],
        "complexity": ["Simple", "Intermediate", "Complicated"],
        "legality": "all",
        "tags": ["Unsupported answers"],
        "tagsConjunc": "NOT",
        "rules": [rule],
        "rulesConjunc": "OR",
        "from": "commander-table",
    }
    url = "https://rulesguru.net/api/questions/?json=" + urllib.parse.quote(
        json.dumps(settings, separators=(",", ":"))
    )
    request = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(request, timeout=60, context=HTTPS) as response:
        payload = json.load(response)
    return payload if isinstance(payload, list) else []


def main() -> None:
    saved = []
    for index, rule in enumerate(RULES):
        if index:
            time.sleep(2)
        for item in questions(rule):
            saved.append(
                {
                    "id": item.get("id"),
                    "rule": rule,
                    "url": item.get("url"),
                    "answer": item.get("answerSimpleCited") or item.get("answerSimple") or "",
                    "cards": [
                        card.get("name")
                        for card in item.get("includedCards") or []
                        if isinstance(card, dict) and card.get("name")
                    ],
                }
            )
        print(f"{rule}: {sum(1 for row in saved if row['rule'] == rule)}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(saved, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(saved)} answers to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
