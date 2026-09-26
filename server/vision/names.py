import re
import unicodedata

from rapidfuzz import fuzz, process


def norm_name(name: str) -> str:
    faces = []
    for face in re.split(r"\s*//\s*", name or ""):
        text = unicodedata.normalize("NFKD", face)
        text = "".join(char for char in text if not unicodedata.combining(char))
        text = text.lower()
        text = re.sub(r"[^a-z0-9 ]+", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            faces.append(text)
    return " // ".join(faces)


# A one-character slip on a short word clears the fuzzy cutoff, so these names
# are exact hits only. The same list, for tokens, is mirrored in src/vision.js.
EXACT_NAMES = (
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
    "Wastes",
    "Snow-Covered Plains",
    "Snow-Covered Island",
    "Snow-Covered Swamp",
    "Snow-Covered Mountain",
    "Snow-Covered Forest",
    "Rat",
    "Spirit",
    "Goblin",
    "Soldier",
    "Zombie",
    "Treasure",
    "Food",
    "Clue",
    "Blood",
    "Map",
    "Insect",
    "Saproling",
    "Thopter",
    "Servo",
    "Gnome",
    "Elemental",
    "Copy",
    "Squirrel",
    "Faerie",
)
PROTECTED = {norm_name(name) for name in EXACT_NAMES}


class NameIndex:
    """Fuzzy card-name list. The match is the part of mtgscan worth keeping."""

    def __init__(self, names: list[str]):
        self.exact: dict[str, str] = {}
        self.spaced: dict[str, str] = {}
        self.face_owners: dict[str, set[str]] = {}
        for raw in names:
            key = norm_name(raw)
            if not key or key in self.exact:
                continue
            self.exact[key] = raw
        for raw in names:
            key = norm_name(raw)
            if not key:
                continue
            for face in key.split(" // "):
                self.face_owners.setdefault(face, set()).add(self.exact.get(key, raw))
            if " // " in key:
                spaced = " ".join(key.split(" // "))
                self.spaced.setdefault(spaced, self.exact[key])
        choices = list(self.exact)
        for face, owners in self.face_owners.items():
            if len(owners) == 1 and face not in self.exact:
                choices.append(face)
        for spaced in self.spaced:
            if spaced not in self.exact:
                choices.append(spaced)
        self.choices = choices

    def _exact(self, key: str) -> str | None:
        if key in self.exact:
            return self.exact[key]
        if key in self.spaced:
            return self.spaced[key]
        owners = self.face_owners.get(key)
        if owners and len(owners) == 1:
            return next(iter(owners))
        return None

    def lookup(self, text: str, limit: int = 4) -> list[dict]:
        key = norm_name(text)
        if len(key) < 3 or len(key) > 40:
            return []
        exact = self._exact(key)
        if exact:
            return [{"name": exact, "confidence": 1.0}]
        # "forests" must not become Forest, and "ratt" must not become Rat.
        if " " not in key and len(key) < 9:
            return []
        choices = [choice for choice in self.choices if self._fuzzy_target(choice)]
        if not choices:
            return []
        hits = process.extract(
            key,
            choices,
            scorer=fuzz.ratio,
            score_cutoff=78,
            limit=limit * 3,
        )
        found = []
        seen = set()
        for match, score, _index in hits:
            display = self._exact(match)
            if not display or display in seen:
                continue
            seen.add(display)
            found.append({"name": display, "confidence": round(score / 100, 4)})
            if len(found) >= limit:
                break
        return found

    def _fuzzy_target(self, choice: str) -> bool:
        if choice in PROTECTED or (" " not in choice and len(choice) < 9):
            return False
        display = self._exact(choice)
        return not display or norm_name(display) not in PROTECTED
