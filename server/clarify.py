"""Ask Grok about the selected cards. The key never leaves this process."""

import json
import os

import httpx

from server.vision.names import norm_name

MODEL = "grok-4.7"
URL = "https://api.x.ai/v1/responses"
VERDICTS = {"legal", "illegal", "applies", "does_not_apply", "depends", "unknown"}
UNKNOWNS = {"stack", "timestamps", "phase", "priority", "targets", "attachments", "counters", "modes"}

SYSTEM = """You answer a Commander table. The user message is the game state and the cards the table selected.
Do not give strategy advice.
Return at most 7 rows. headline is the question. one_liner is one or two sentences.
verdict is legal, illegal, applies, does_not_apply, depends, or unknown.
If a fact listed in unknowns would change the answer, use depends, put that fact in depends_on, and add choices. Each choice has an id, a short label the table can tap, and the one_liner that becomes true for that tap.
Cite a Comprehensive Rules number only as cr:613.7. Cite a Gatherer ruling only as ruling:<oracle_id> from the payload. Leave citations empty when unsure.
card_names lists every card the row talks about. Use only names from the payload. Do not invent a life total, a counter, or a blocker the state does not show.
Layers apply in order: copy, control, text, type, color, abilities, then power and toughness. A later timestamp matters only inside one layer.
"Instead", "skip", "enters with", and "as this enters" are replacements. "When" and "whenever" are triggers.
A commander moving from a graveyard or exile to the command zone is a state-based action. A move to a hand or library is a replacement. 21 commander damage is combat damage from one commander.
"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["clarifications"],
    "properties": {
        "clarifications": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "headline",
                    "one_liner",
                    "verdict",
                    "citations",
                    "depends_on",
                    "object_ids",
                    "card_names",
                    "choices",
                ],
                "properties": {
                    "headline": {"type": "string"},
                    "one_liner": {"type": "string"},
                    "verdict": {"type": "string", "enum": sorted(VERDICTS)},
                    "citations": {"type": "array", "items": {"type": "string"}},
                    "depends_on": {"type": "array", "items": {"type": "string", "enum": sorted(UNKNOWNS)}},
                    "object_ids": {"type": "array", "items": {"type": "string"}},
                    "card_names": {"type": "array", "items": {"type": "string"}},
                    "choices": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["id", "label", "one_liner"],
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string"},
                                "one_liner": {"type": "string"},
                            },
                        },
                    },
                },
            },
        }
    },
}


def _allowed(payload: dict) -> tuple[set[str], set[str], set[str]]:
    objects = (payload.get("game_state") or {}).get("objects") or []
    names = set()
    ids = set()
    oracles = set()
    for obj in objects:
        if not isinstance(obj, dict):
            continue
        if obj.get("id"):
            ids.add(obj["id"])
        if obj.get("name"):
            names.add(norm_name(obj["name"]))
        if obj.get("oracle_id"):
            oracles.add(obj["oracle_id"])
    return names, ids, oracles


def accept(payload: dict, rows: list) -> list[dict]:
    names, ids, oracles = _allowed(payload)
    kept = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        verdict = row.get("verdict")
        headline = row.get("headline") if isinstance(row.get("headline"), str) else ""
        one_liner = row.get("one_liner") if isinstance(row.get("one_liner"), str) else ""
        if verdict not in VERDICTS or not headline.strip() or not one_liner.strip():
            continue
        object_ids = row.get("object_ids") if isinstance(row.get("object_ids"), list) else []
        if any(not isinstance(item, str) or item not in ids for item in object_ids):
            continue
        card_names = row.get("card_names") if isinstance(row.get("card_names"), list) else []
        if any(not isinstance(item, str) or norm_name(item) not in names for item in card_names):
            continue
        depends = row.get("depends_on") if isinstance(row.get("depends_on"), list) else []
        if any(item not in UNKNOWNS for item in depends):
            continue
        citations = []
        for cite in row.get("citations") or []:
            if not isinstance(cite, str):
                continue
            if cite.startswith("cr:") and cite[3:].replace(".", "", 1).isalnum():
                citations.append(cite)
            elif cite.startswith("ruling:") and cite[7:] in oracles:
                citations.append(cite)
        choices = []
        for choice in row.get("choices") or []:
            if not isinstance(choice, dict):
                continue
            label = choice.get("label") if isinstance(choice.get("label"), str) else ""
            line = choice.get("one_liner") if isinstance(choice.get("one_liner"), str) else ""
            choice_id = choice.get("id") if isinstance(choice.get("id"), str) else ""
            if not choice_id or not label or not line:
                continue
            choices.append({"id": choice_id, "label": label, "one_liner": line})
        kept.append(
            {
                "candidate_id": "llm:" + ":".join(sorted(object_ids)),
                "headline": headline.strip(),
                "one_liner": one_liner.strip(),
                "verdict": verdict,
                "citations": citations,
                "depends_on": depends,
                "confidence": 0.7,
                "source_tier": "llm",
                "object_ids": object_ids,
                "choices": choices,
            }
        )
        if len(kept) == 7:
            break
    return kept


def output_text(body: dict) -> str:
    if isinstance(body.get("output_text"), str):
        return body["output_text"]
    for item in body.get("output") or []:
        if not isinstance(item, dict):
            continue
        for part in item.get("content") or []:
            if isinstance(part, dict) and part.get("text"):
                return part["text"]
    raise ValueError("The model reply had no text.")


def brief(payload: dict) -> dict:
    state = payload.get("game_state") or {}
    focus = payload.get("focus") or {}
    chosen = set(focus.get("selected_object_ids") or []) | set(focus.get("auto_included_object_ids") or [])
    objects = []
    for obj in state.get("objects") or []:
        if not isinstance(obj, dict):
            continue
        item = {
            "id": obj.get("id"),
            "name": obj.get("name"),
            "zone": obj.get("zone"),
            "controller": obj.get("controller"),
            "type_line": obj.get("type_line") or "",
        }
        if obj.get("id") in chosen:
            item["oracle_id"] = obj.get("oracle_id")
            item["oracle_text"] = obj.get("oracle_text") or ""
            item["rulings"] = obj.get("rulings") or []
        objects.append(item)
    return {
        "players": state.get("players") or [],
        "commander_damage": state.get("commander_damage"),
        "unknowns": state.get("unknowns") or [],
        "objects": objects,
        "selected_object_ids": focus.get("selected_object_ids") or [],
    }


async def fetch_clarifications(payload: dict) -> dict:
    key = os.environ.get("XAI_API_KEY")
    if not key:
        raise PermissionError("The model key is not set.")
    request = {
        "model": MODEL,
        "reasoning": {"effort": "low"},
        "input": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps(brief(payload))},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "clarifications",
                "schema": SCHEMA,
                "strict": True,
            }
        },
    }
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=request,
        )
    response.raise_for_status()
    parsed = json.loads(output_text(response.json()))
    rows = parsed.get("clarifications") if isinstance(parsed, dict) else None
    return {"clarifications": accept(payload, rows or [])}
