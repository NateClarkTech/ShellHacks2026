import { SEATS, seatId, seatOrderName } from "./game.js";

// CardSight names a card and does not return a box. The title scan (Azure Read
// plus a name list, the useful half of mtgscan) returns boxes. A slot is one
// title-scan box, or a CardSight name that matched no box.

const TIERS = { high: 0.95, medium: 0.82, low: 0.62 };

// A single reader at or above this fills the name and marks it a guess.
// Below it, the table picks. CardSight Low is 0.62. Medium is 0.82.
export const GUESS_AT = 0.75;

export const ZONES = ["battlefield", "graveyard", "exile", "command", "library", "hand", "stack"];

const PIN_ZONES = ["battlefield", "graveyard", "exile", "command"];

// Keep this in step with EXACT_NAMES tokens in server/vision/names.py.
const TOKEN_NAMES = [
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
];

const CENTER = 0.14;
const OUTER = 0.4;
const SIDE = 0.06;

export function normName(name) {
  return String(name ?? "")
    .split(/\s*\/\/\s*/)
    .map((face) =>
      face
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join(" // ");
}

export function sameCard(a, b) {
  const left = normName(a);
  const right = normName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftFaces = left.split(" // ");
  const rightFaces = right.split(" // ");
  if (leftFaces.length === 1 && rightFaces.includes(leftFaces[0])) return true;
  if (rightFaces.length === 1 && leftFaces.includes(rightFaces[0])) return true;
  return false;
}

function asConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  return TIERS[String(value ?? "").toLowerCase()] ?? 0.5;
}

function asAlternatives(list, source, ceiling) {
  const out = [];
  for (const [index, item] of (list ?? []).entries()) {
    const name = typeof item === "string" ? item : item?.name;
    if (!name) continue;
    // Suggestions are the reader's own runners-up, so they stay under that read.
    const cap = Math.max(0.4, ceiling - (index + 1) * 0.05);
    const given =
      typeof item === "object" && item && typeof item.confidence === "number"
        ? asConfidence(item.confidence)
        : cap;
    out.push({ name, confidence: Math.min(given, cap), sources: [source] });
  }
  return out;
}

function mergeCandidate(bucket, entry) {
  const existing = bucket.find((item) => sameCard(item.name, entry.name));
  if (!existing) {
    bucket.push({ name: entry.name, confidence: entry.confidence, sources: [...entry.sources] });
    return;
  }
  if (
    entry.confidence > existing.confidence ||
    (entry.confidence === existing.confidence && entry.name.length > existing.name.length)
  ) {
    existing.name = entry.name;
  }
  existing.confidence = Math.max(existing.confidence, entry.confidence);
  for (const source of entry.sources) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
  }
}

function sortedCandidates(bucket) {
  return bucket
    .slice()
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

function readNote(identity, confidence, sources) {
  if (identity === "agreed") return "CardSight and the title scan agree.";
  if (identity === "choose" && sources.length > 1) return "The two readers disagree. Pick the card.";
  if (identity === "choose") return "The read was uncertain. Pick the card.";
  if (confidence >= 0.9) return "Only one reader saw this, and it was confident.";
  return "Only one reader saw this. Check the name.";
}

function finish(name, identity, confidence, sources, candidates, box, note, image) {
  const uniqueSources = [...new Set(sources)];
  return {
    name,
    identity,
    confidence,
    sources: uniqueSources,
    candidates,
    box: box ?? null,
    note: note || readNote(identity, confidence, uniqueSources),
    image: image || null,
  };
}

export function isTokenName(name) {
  const key = normName(name);
  return TOKEN_NAMES.some((token) => normName(token) === key);
}

// Share of the new names that are already on this seat and zone. Two Forests
// count twice. A name match is not enough to merge them; the seat asks first.
export function duplicateShare(currentNames, nextNames) {
  const bag = new Map();
  for (const name of currentNames ?? []) {
    const key = normName(name);
    if (!key) continue;
    bag.set(key, (bag.get(key) ?? 0) + 1);
  }
  const incoming = (nextNames ?? []).map((name) => normName(name)).filter(Boolean);
  if (incoming.length === 0) return 0;
  let hits = 0;
  for (const key of incoming) {
    const left = bag.get(key) ?? 0;
    if (left <= 0) continue;
    bag.set(key, left - 1);
    hits += 1;
  }
  return hits / incoming.length;
}

// One-way near-misses stay two cards. Merging requires each side to name the other,
// which is the signal that both readers are unsure about the same title.
function mutualDisagree(slot, sight) {
  const ocrNamesSight = slot.alternatives.some((item) => sameCard(item.name, sight.name));
  const sightNamesOcr = sight.suggestions.some((item) => sameCard(item.name, slot.ocrName));
  return ocrNamesSight && sightNamesOcr && !sameCard(slot.ocrName, sight.name);
}

function singleSource(name, confidence, sources, alternatives, box, image) {
  const bucket = [];
  mergeCandidate(bucket, { name, confidence, sources });
  for (const alt of alternatives) {
    if (!sameCard(alt.name, name)) mergeCandidate(bucket, alt);
  }
  const candidates = sortedCandidates(bucket);
  if (confidence >= GUESS_AT) {
    return finish(
      name,
      "guess",
      confidence,
      sources,
      candidates.filter((item) => !sameCard(item.name, name)),
      box,
      undefined,
      image,
    );
  }
  return finish(null, "choose", candidates[0]?.confidence ?? confidence, sources, candidates, box, undefined, image);
}

export function vote(cardsight = [], ocr = []) {
  const sights = [];
  for (const detection of cardsight) {
    if (!detection?.name) continue;
    sights.push({
      name: detection.name,
      confidence: asConfidence(detection.confidence),
      suggestions: asAlternatives(
        detection.suggestions,
        "cardsight",
        asConfidence(detection.confidence),
      ),
      box: detection.box ?? null,
      image: detection.image || null,
      used: false,
    });
  }

  const slots = [];
  for (const line of ocr) {
    if (!line) continue;
    if (!line.name) {
      slots.push({
        ocrName: null,
        ocrConfidence: 0,
        alternatives: [],
        box: line.box ?? null,
        image: line.image || null,
        sight: null,
        blankNote: line.note || "The title could not be read.",
      });
      continue;
    }
    slots.push({
      ocrName: line.name,
      ocrConfidence: asConfidence(line.confidence),
      alternatives: asAlternatives(line.alternatives, "ocr", asConfidence(line.confidence)),
      box: line.box ?? null,
      image: line.image || null,
      sight: null,
      blankNote: null,
    });
  }

  const byConfidence = sights
    .map((sight, index) => index)
    .sort((a, b) => sights[b].confidence - sights[a].confidence);

  for (const index of byConfidence) {
    const sight = sights[index];
    const slot = slots.find((item) => !item.sight && sameCard(item.ocrName, sight.name));
    if (!slot) continue;
    slot.sight = sight;
    sight.used = true;
  }

  for (const sight of sights) {
    if (sight.used) continue;
    const slot = slots.find((item) => !item.sight && mutualDisagree(item, sight));
    if (!slot) continue;
    slot.sight = sight;
    sight.used = true;
  }

  const result = [];
  for (const slot of slots) {
    const image = slot.image || slot.sight?.image || null;
    if (!slot.sight) {
      if (slot.blankNote) {
        result.push(finish(null, "choose", 0, ["ocr"], [], slot.box, slot.blankNote, image));
        continue;
      }
      result.push(
        singleSource(slot.ocrName, slot.ocrConfidence, ["ocr"], slot.alternatives, slot.box, image),
      );
      continue;
    }
    if (sameCard(slot.ocrName, slot.sight.name)) {
      const confidence = Math.max(slot.ocrConfidence, slot.sight.confidence);
      const name = slot.sight.confidence > slot.ocrConfidence ? slot.sight.name : slot.ocrName;
      result.push(finish(name, "agreed", confidence, ["ocr", "cardsight"], [], slot.box, undefined, image));
      continue;
    }
    const bucket = [];
    mergeCandidate(bucket, {
      name: slot.ocrName,
      confidence: slot.ocrConfidence,
      sources: ["ocr"],
    });
    mergeCandidate(bucket, {
      name: slot.sight.name,
      confidence: slot.sight.confidence,
      sources: ["cardsight"],
    });
    for (const alt of slot.alternatives) mergeCandidate(bucket, alt);
    for (const alt of slot.sight.suggestions) mergeCandidate(bucket, alt);
    const candidates = sortedCandidates(bucket);
    result.push(
      finish(null, "choose", candidates[0]?.confidence ?? 0, ["ocr", "cardsight"], candidates, slot.box, undefined, image),
    );
  }

  for (const sight of sights) {
    if (sight.used) continue;
    result.push(
      singleSource(sight.name, sight.confidence, ["cardsight"], sight.suggestions, sight.box, sight.image),
    );
  }
  return result;
}

export function turnPoint(cx, cy, turns) {
  let x = cx;
  let y = cy;
  const steps = ((turns % 4) + 4) % 4;
  for (let i = 0; i < steps; i += 1) {
    const nextX = 1 - y;
    const nextY = x;
    x = nextX;
    y = nextY;
  }
  return { cx: x, cy: y };
}

// Local axes: +x is that seat's right, +y is toward that seat and away from center.
function localAxes(seat, dx, dy) {
  switch (seat) {
    case "seat4":
      return { x: dx, y: dy };
    case "seat2":
      return { x: -dx, y: -dy };
    case "seat3":
      return { x: dy, y: dx };
    case "seat1":
      return { x: -dy, y: -dx };
    default:
      return { x: 0, y: 0 };
  }
}

export function placementFor(card, orientation = 0, commanders = {}) {
  const box = card?.box;
  if (!box || !Number.isFinite(box.cx) || !Number.isFinite(box.cy)) {
    return {
      controller: null,
      zone: "battlefield",
      reason: "No position in the photo. Pick a seat.",
    };
  }
  const { cx, cy } = turnPoint(box.cx, box.cy, orientation);
  const dx = cx - 0.5;
  const dy = cy - 0.5;
  const reach = Math.hypot(dx, dy);
  if (reach < CENTER) {
    return {
      controller: null,
      zone: "stack",
      reason: "Center of the photo. Guessed the stack. Order is a guess.",
    };
  }
  const controller =
    Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "seat3" : "seat1") : dy > 0 ? "seat4" : "seat2";
  const local = localAxes(controller, dx, dy);
  const label = seatOrderName(controller);
  const commander = commanders?.[controller];
  if (
    commander &&
    card.name &&
    sameCard(card.name, commander) &&
    reach > OUTER &&
    Math.abs(local.x) <= SIDE
  ) {
    return {
      controller,
      zone: "command",
      reason: `Matches ${label}'s commander. Guessed the command zone.`,
    };
  }
  if (reach > OUTER && local.x > SIDE) {
    return {
      controller,
      zone: "graveyard",
      reason: `${label}'s right edge. Guessed the graveyard.`,
    };
  }
  if (reach > OUTER && local.x < -SIDE) {
    return {
      controller,
      zone: "exile",
      reason: `${label}'s left edge. Guessed exile.`,
    };
  }
  if (reach > OUTER) {
    return {
      controller,
      zone: "library",
      reason: `${label}'s outer edge. Guessed the library. Only the top card can be read.`,
    };
  }
  return {
    controller,
    zone: "battlefield",
    reason: `${label}'s side of the table. Guessed the battlefield.`,
  };
}

function restack(cards) {
  const ordered = cards
    .filter((card) => card.zone === "stack" && card.stackIndex != null)
    .sort((a, b) => a.stackIndex - b.stackIndex || a.id.localeCompare(b.id));
  const fresh = cards
    .filter((card) => card.zone === "stack" && card.stackIndex == null)
    .sort((a, b) => (a.box?.cy ?? 0) - (b.box?.cy ?? 0) || a.id.localeCompare(b.id));
  const index = new Map([...ordered, ...fresh].map((card, i) => [card.id, i]));
  return cards.map((card) =>
    card.zone === "stack"
      ? { ...card, stackIndex: index.get(card.id) }
      : { ...card, stackIndex: null },
  );
}

export function assembleScan(
  payload,
  { orientation = 0, commanders = {}, controller = null, zone = null, photoId = null } = {},
) {
  const slots = vote(payload?.cardsight, payload?.ocr);
  const controllerId = SEATS.includes(seatId(controller)) ? seatId(controller) : null;
  const pinned = Boolean(controllerId);
  const pinnedZone = PIN_ZONES.includes(zone) ? zone : "battlefield";
  const cards = slots.map((slot, index) => {
    let identity = slot.identity;
    let note = slot.note;
    if (slot.name && isTokenName(slot.name) && identity !== "choose") {
      identity = "confirm";
      note = "Token. Confirm the name.";
    }
    const card = {
      id: `card-${index + 1}`,
      name: slot.name,
      candidates: slot.candidates,
      identity,
      confidence: slot.confidence,
      sources: slot.sources,
      box: slot.box,
      stackIndex: null,
      placement: "guess",
      note,
      photoId: photoId ?? null,
      image: slot.image || null,
    };
    if (pinned) {
      return {
        ...card,
        controller: controllerId,
        zone: pinnedZone,
        placement: "accepted",
        reason: "Scanned from this seat.",
      };
    }
    return { ...card, ...placementFor(card, orientation, commanders) };
  });
  return restack(cards);
}
