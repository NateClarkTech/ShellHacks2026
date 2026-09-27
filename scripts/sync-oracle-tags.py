#!/usr/bin/env python3
"""Build server/data/tag-index.json from Scryfall's oracle_tags bulk file.

Stdlib only. Not used at runtime. The dated download URL comes from /bulk-data.
"""

import gzip
import json
import ssl
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAMILIES = ROOT / "src" / "candidates" / "families.json"
OUT = ROOT / "server" / "data" / "tag-index.json"
UA = {"User-Agent": "commander-table/0.1", "Accept": "application/json"}


def https_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    bundle = Path("/etc/ssl/cert.pem")
    if bundle.exists():
        context.load_verify_locations(cafile=bundle)
    return context


HTTPS = https_context()


def get_json(url: str):
    request = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(request, timeout=60, context=HTTPS) as response:
        return json.load(response)


def main() -> None:
    families = json.loads(FAMILIES.read_text(encoding="utf-8"))
    slug_family = {slug: family for family, slugs in families.items() for slug in slugs}
    meta = get_json("https://api.scryfall.com/bulk-data/oracle_tags")
    download = meta.get("jsonl_download_uri") or meta["download_uri"]
    request = urllib.request.Request(download, headers={"User-Agent": UA["User-Agent"]})
    tags = []
    with urllib.request.urlopen(request, timeout=120, context=HTTPS) as response:
        with gzip.GzipFile(fileobj=response) as raw:
            for line in raw:
                tag = json.loads(line)
                oracle_ids = [
                    row.get("oracle_id")
                    for row in tag.get("taggings") or []
                    if row.get("oracle_id")
                ]
                tags.append(
                    {
                        "id": tag["id"],
                        "slug": tag.get("slug") or "",
                        "parent_ids": tag.get("parent_ids") or [],
                        "oracle_ids": oracle_ids,
                    }
                )
    own = {tag["id"]: slug_family[tag["slug"]] for tag in tags if tag["slug"] in slug_family}

    def family_of(tag: dict) -> str | None:
        if tag["id"] in own:
            return own[tag["id"]]
        for parent in tag["parent_ids"]:
            if parent in own:
                return own[parent]
        return None

    index: dict[str, list[dict]] = {}
    kept = 0
    for tag in tags:
        family = family_of(tag)
        if not family or not tag["oracle_ids"]:
            continue
        kept += 1
        row = {"id": tag["id"], "slug": tag["slug"], "family": family}
        for oracle_id in tag["oracle_ids"]:
            bucket = index.setdefault(oracle_id, [])
            if all(item["id"] != tag["id"] for item in bucket):
                bucket.append(row)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(index), encoding="utf-8")
    print(f"wrote {len(index)} cards from {kept} tags to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
