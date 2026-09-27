import { SEATS, seatId } from "./game.js";
import { ZONES, assembleScan, placementFor } from "./vision.js";

const STORAGE_KEY = "commander-board-v1";
const HISTORY_LIMIT = 40;

export { ZONES };

export const ZONE_LABEL = {
  battlefield: "Battlefield",
  graveyard: "Graveyard",
  exile: "Exile",
  command: "Command",
  library: "Library",
  hand: "Hand",
  stack: "Stack",
};

export function emptyBoard() {
  return { cards: [], past: [], orientation: 0, warnings: [], images: {} };
}

export function boardFromScan(payload, options = {}) {
  return {
    cards: assembleScan(payload, options),
    past: [],
    orientation: options.orientation ?? 0,
    warnings: Array.isArray(payload?.warnings) ? payload.warnings.filter((item) => typeof item === "string") : [],
  };
}

export function replaceWithScan(state, payload, options = {}) {
  const next = boardFromScan(payload, options);
  const images = rememberImages(next.cards);
  if (state.cards.length === 0 && state.orientation === 0 && state.past.length === 0) {
    return { ...next, images };
  }
  const past = [...state.past, snapshot(state)];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { ...next, past, images };
}

export function lastPhotoId(state, controller, zone) {
  const cards = state?.cards ?? [];
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (card.controller === controller && card.zone === zone && card.photoId) return card.photoId;
  }
  return null;
}

export function appendScan(state, payload, options = {}) {
  const photoId = payload?.photoId || null;
  const kept =
    options.mode === "retake" && options.replacePhotoId
      ? state.cards.filter((card) => card.photoId !== options.replacePhotoId)
      : state.cards;
  let nextNumber = 0;
  for (const card of kept) {
    const match = /^card-(\d+)$/.exec(card.id);
    if (match) nextNumber = Math.max(nextNumber, Number(match[1]));
  }
  const added = assembleScan(payload, {
    controller: options.controller,
    zone: options.zone,
    photoId,
    commanders: options.commanders,
  }).map((card) => {
    nextNumber += 1;
    return { ...card, id: `card-${nextNumber}`, photoId };
  });
  const warnings = Array.isArray(payload?.warnings)
    ? payload.warnings.filter((item) => typeof item === "string")
    : (state.warnings ?? []);
  const cards = restack([...kept, ...added]);
  return withHistory(state, {
    cards,
    orientation: state.orientation,
    warnings,
    images: rememberImages(added, state.images),
  });
}

function withoutImage(card) {
  if (!card?.image) return card;
  const { image: _image, ...rest } = card;
  return rest;
}

function snapshot(state) {
  return structuredClone({
    cards: state.cards.map(withoutImage),
    orientation: state.orientation,
    warnings: state.warnings ?? [],
  });
}

function withHistory(state, next) {
  const past = [...state.past, snapshot(state)];
  if (past.length > HISTORY_LIMIT) past.shift();
  return {
    ...next,
    past,
    images: next.images ?? state.images ?? {},
    warnings: next.warnings ?? state.warnings ?? [],
  };
}

function rememberImages(cards, images = {}) {
  const next = { ...images };
  for (const card of cards) {
    if (card.image) next[card.id] = card.image;
  }
  return next;
}

function attachImages(cards, images = {}) {
  return cards.map((card) => (card.image || !images[card.id] ? card : { ...card, image: images[card.id] }));
}

function restack(cards) {
  const ordered = cards
    .filter((card) => card.zone === "stack" && card.stackIndex != null)
    .sort((a, b) => a.stackIndex - b.stackIndex || a.id.localeCompare(b.id));
  const fresh = cards
    .filter((card) => card.zone === "stack" && card.stackIndex == null)
    .sort((a, b) => (a.box?.cy ?? 1) - (b.box?.cy ?? 1) || a.id.localeCompare(b.id));
  const index = new Map([...ordered, ...fresh].map((card, i) => [card.id, i]));
  return cards.map((card) =>
    card.zone === "stack"
      ? { ...card, stackIndex: index.get(card.id) }
      : { ...card, stackIndex: null },
  );
}

function nextId(cards) {
  let max = 0;
  for (const card of cards) {
    const match = /^card-(\d+)$/.exec(card.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `card-${max + 1}`;
}

function cleanName(name) {
  return String(name ?? "").trim().slice(0, 80);
}

function cleanDetail(detail) {
  return String(detail ?? "").trim().slice(0, 160);
}

const PICK_NOTES = new Set([
  "The read was uncertain. Pick the card.",
  "The two readers disagree. Pick the card.",
]);

export function reduceBoard(state, action) {
  switch (action.type) {
    case "apply": {
      const card = state.cards.find((item) => item.id === action.id);
      if (!card) return state;
      const name = action.name == null ? card.name : cleanName(action.name);
      if (!name) return state;
      const zone = ZONES.includes(action.zone) ? action.zone : card.zone;
      const controller = SEATS.includes(action.controller) ? action.controller : null;
      const nameChanged = name !== card.name;
      const detail = action.detail == null ? card.detail ?? "" : cleanDetail(action.detail);
      const stayingOnStack = card.zone === "stack" && zone === "stack";
      const cards = restack(
        state.cards.map((item) =>
          item.id !== card.id
            ? item
            : {
                ...item,
                name,
                detail,
                note: PICK_NOTES.has(item.note) ? "" : item.note,
                tapped: action.tapped == null ? Boolean(item.tapped) : Boolean(action.tapped),
                identity: nameChanged || item.identity === "confirm" ? "chosen" : item.identity,
                controller,
                zone,
                stackIndex: stayingOnStack ? item.stackIndex : null,
                placement: "accepted",
              },
        ),
      );
      return withHistory(state, { ...state, cards });
    }
    case "stack-move": {
      const card = state.cards.find((item) => item.id === action.id);
      if (!card || card.zone !== "stack") return state;
      const stack = state.cards
        .filter((item) => item.zone === "stack")
        .sort((a, b) => a.stackIndex - b.stackIndex);
      const index = stack.findIndex((item) => item.id === card.id);
      const next = index + (action.direction > 0 ? 1 : -1);
      if (next < 0 || next >= stack.length) return state;
      const swapped = stack.slice();
      const [item] = swapped.splice(index, 1);
      swapped.splice(next, 0, item);
      const order = new Map(swapped.map((entry, entryIndex) => [entry.id, entryIndex]));
      const cards = state.cards.map((entry) =>
        order.has(entry.id) ? { ...entry, stackIndex: order.get(entry.id) } : entry,
      );
      return withHistory(state, { ...state, cards });
    }
    case "remove": {
      if (!state.cards.some((card) => card.id === action.id)) return state;
      const cards = restack(state.cards.filter((card) => card.id !== action.id));
      return withHistory(state, { ...state, cards });
    }
    case "add": {
      const name = cleanName(action.name);
      if (!name) return state;
      const zone = ZONES.includes(action.zone) ? action.zone : "battlefield";
      const controller = SEATS.includes(action.controller) ? action.controller : SEATS[0];
      const card = {
        id: action.id || nextId(state.cards),
        name,
        candidates: [],
        identity: "manual",
        confidence: 1,
        sources: [],
        box: null,
        controller,
        zone,
        stackIndex: null,
        placement: "accepted",
        note: "Added by name.",
        reason: "Added by name.",
        detail: cleanDetail(action.detail),
      };
      return withHistory(state, { ...state, cards: restack([...state.cards, card]) });
    }
    case "rotate": {
      const orientation = (state.orientation + (action.direction < 0 ? 3 : 1)) % 4;
      const commanders = action.commanders ?? {};
      const cards = state.cards.map((card) => {
        if (card.placement === "accepted" || !card.box) return card;
        const placed = placementFor(card, orientation, commanders);
        const zoneChanged = placed.zone !== card.zone;
        return {
          ...card,
          ...placed,
          stackIndex: zoneChanged ? null : card.stackIndex,
        };
      });
      return withHistory(state, { ...state, orientation, cards: restack(cards) });
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return {
        ...prev,
        cards: attachImages(prev.cards, state.images),
        images: state.images ?? {},
        past: state.past.slice(0, -1),
      };
    }
    case "clear":
      return state.cards.length === 0 && state.orientation === 0
        ? state
        : withHistory(state, emptyBoard());
    default:
      return state;
  }
}

function cardOk(card) {
  return Boolean(card) && typeof card.id === "string" && ZONES.includes(card.zone);
}

function migrateCard(card) {
  const controller = seatId(card?.controller);
  return controller === card?.controller ? card : { ...card, controller };
}

function migrateBoard(board) {
  if (!board || typeof board !== "object") return board;
  const { past, ...rest } = board;
  const next = { ...rest };
  if (Array.isArray(rest.cards)) next.cards = rest.cards.map(migrateCard);
  if (Array.isArray(past)) next.past = past.map((entry) => migrateBoard(entry));
  return next;
}

export function loadBoard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyBoard();
    const parsed = migrateBoard(JSON.parse(raw));
    if (!Array.isArray(parsed?.cards) || !parsed.cards.every(cardOk)) return emptyBoard();
    const images =
      parsed.images && typeof parsed.images === "object" && !Array.isArray(parsed.images)
        ? parsed.images
        : {};
    return {
      cards: attachImages(parsed.cards, images),
      orientation: [0, 1, 2, 3].includes(parsed.orientation) ? parsed.orientation : 0,
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.filter((item) => typeof item === "string")
        : [],
      past: Array.isArray(parsed.past) ? parsed.past.slice(-HISTORY_LIMIT) : [],
      images,
    };
  } catch {
    return emptyBoard();
  }
}

export function saveBoard(board) {
  const images = rememberImages(board.cards ?? [], board.images);
  const cards = (board.cards ?? []).map(withoutImage);
  const past = (board.past ?? []).map((entry) => ({
    ...entry,
    cards: Array.isArray(entry?.cards) ? entry.cards.map(withoutImage) : [],
  }));
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...board, cards, past, images }),
  );
}
