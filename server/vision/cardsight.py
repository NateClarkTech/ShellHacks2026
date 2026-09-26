TIERS = {"high": 0.95, "medium": 0.82, "low": 0.62}


def parse_cardsight(payload: dict) -> list[dict]:
    """CardSight detections have a tier and a name. They do not have a box."""
    found = []
    for detection in payload.get("detections") or []:
        card = detection.get("card") or {}
        name = card.get("name")
        if not name:
            continue
        tier = str(detection.get("confidence") or "").lower()
        suggestions = []
        for suggestion in card.get("suggestions") or []:
            other = suggestion.get("name") if isinstance(suggestion, dict) else None
            if other and other != name:
                suggestions.append(other)
        found.append(
            {
                "name": name,
                "confidence": TIERS.get(tier, 0.5),
                "suggestions": suggestions,
            }
        )
    return found
