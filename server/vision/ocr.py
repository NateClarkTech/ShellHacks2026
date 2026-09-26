from server.vision.names import NameIndex, norm_name

# mtgscan calls Azure Read v3.1. That version retired on 2026-09-13.
# v3.2 is the same async Read call with a version that still answers.
READ_PATH = "/vision/v3.2/read/analyze"

# A line that is only a rules keyword or a type line is not a card.
KEYWORDS = {
    "flying",
    "haste",
    "trample",
    "lifelink",
    "vigilance",
    "deathtouch",
    "menace",
    "reach",
    "defender",
    "hexproof",
    "indestructible",
    "flash",
    "first strike",
    "double strike",
    "ward",
    "protection",
    "enchantment",
    "creature",
    "instant",
    "sorcery",
    "artifact",
    "planeswalker",
    "battle",
    "land",
    "tribal",
    "kindred",
    "legendary",
    "snow",
    "token",
    "enchant",
}


def parse_read_result(payload: dict) -> list[dict]:
    lines = []
    for page in (payload.get("analyzeResult") or {}).get("readResults") or []:
        width = page.get("width") or 0
        height = page.get("height") or 0
        if width <= 0 or height <= 0:
            continue
        for line in page.get("lines") or []:
            polygon = line.get("boundingBox") or []
            if isinstance(polygon, str):
                polygon = [float(part) for part in polygon.split(",") if part]
            if len(polygon) < 8:
                continue
            words = line.get("words") or []
            scores = [
                word.get("confidence")
                for word in words
                if isinstance(word.get("confidence"), (int, float))
            ]
            quality = sum(scores) / len(scores) if scores else 1.0
            xs = polygon[0::2]
            ys = polygon[1::2]
            lines.append(
                {
                    "text": line.get("text") or "",
                    "quality": quality,
                    "box": {
                        "cx": ((min(xs) + max(xs)) / 2) / width,
                        "cy": ((min(ys) + max(ys)) / 2) / height,
                        "w": (max(xs) - min(xs)) / width,
                        "h": (max(ys) - min(ys)) / height,
                    },
                }
            )
    return lines


def _same_physical_card(a: dict, b: dict) -> bool:
    dx = abs(a["cx"] - b["cx"])
    dy = abs(a["cy"] - b["cy"])
    width = max(a["w"], b["w"], 0.06)
    height = max(a["h"], b["h"], 0.02)
    return dx <= width * 0.8 and dy <= height * 2.0


def lines_to_observations(lines: list[dict], index: NameIndex) -> list[dict]:
    scored = []
    for line in lines:
        if norm_name(line["text"]) in KEYWORDS:
            continue
        matches = index.lookup(line["text"])
        if not matches:
            continue
        quality = line.get("quality", 1)
        top = matches[0]["confidence"]
        if top >= 0.999:
            confidence = max(0.76, quality) if quality < 0.9 else top
        else:
            confidence = round(top * max(quality, 0.5), 4)
        if confidence < 0.55:
            continue
        adjusted = [{"name": matches[0]["name"], "confidence": round(confidence, 4)}]
        for extra in matches[1:]:
            adjusted.append(extra)
        scored.append({"box": line["box"], "matches": adjusted})

    order = sorted(range(len(scored)), key=lambda i: scored[i]["matches"][0]["confidence"], reverse=True)
    used = [False] * len(scored)
    observations = []
    for index_in_order in order:
        if used[index_in_order]:
            continue
        used[index_in_order] = True
        group = [scored[index_in_order]]
        for other in order:
            if used[other]:
                continue
            if _same_physical_card(scored[index_in_order]["box"], scored[other]["box"]):
                used[other] = True
                group.append(scored[other])
        winner = max(group, key=lambda item: item["matches"][0]["confidence"])
        best = winner["matches"][0]
        alternatives = []
        seen = {best["name"]}
        for item in group:
            for match in item["matches"]:
                if match["name"] in seen:
                    continue
                if match["confidence"] < best["confidence"] - 0.12:
                    continue
                seen.add(match["name"])
                alternatives.append(match["name"])
        observations.append(
            {
                "name": best["name"],
                "confidence": best["confidence"],
                "alternatives": alternatives[:4],
                "box": winner["box"],
            }
        )
    return observations
