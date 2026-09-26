// Clockwise around the phone, looking down: top-left, top-right, bottom-right, bottom-left.
export const SEATS = ["seat1", "seat2", "seat3", "seat4"];
export const CLOCKWISE = SEATS;

export const SEAT_ACCENT = {
  seat1: "#7dba8a",
  seat2: "#8fb8c9",
  seat3: "#d4726a",
  seat4: "#e3c27a",
};

const LEGACY_SEAT = {
  west: "seat1",
  north: "seat2",
  east: "seat3",
  south: "seat4",
};

const COMPASS_NAMES = new Set(["South", "North", "West", "East"]);
const HISTORY_LIMIT = 40;
const STORAGE_KEY = "commander-table-v2";
const LEGACY_KEY = "commander-table-v1";

export function seatId(id) {
  return LEGACY_SEAT[id] ?? id;
}

export function seatOrderName(seat) {
  const index = SEATS.indexOf(seatId(seat));
  return index < 0 ? "Seat" : `Seat ${index + 1}`;
}

export function opponentsOf(seat) {
  return SEATS.filter((other) => other !== seat);
}

export function clockwiseFrom(start) {
  const origin = CLOCKWISE.indexOf(start);
  if (origin < 0) return [...CLOCKWISE];
  return [0, 1, 2, 3].map((step) => CLOCKWISE[(origin + step) % 4]);
}

export function isDefaultName(name) {
  return !name || /^Seat [1-4]$/.test(name) || COMPASS_NAMES.has(name);
}

const TURN = ["1st", "2nd", "3rd", "4th"];

export function turnLabel(turnStart, seat) {
  if (!turnStart) return "";
  const index = clockwiseFrom(turnStart).indexOf(seat);
  return index < 0 ? "" : TURN[index];
}

function blankDamage() {
  const damage = {};
  for (const from of SEATS) {
    damage[from] = {};
    for (const to of SEATS) damage[from][to] = 0;
  }
  return damage;
}

function blankFlags() {
  return Object.fromEntries(SEATS.map((id) => [id, false]));
}

function blankLists() {
  return Object.fromEntries(SEATS.map((id) => [id, []]));
}

export function freshTable() {
  return {
    seats: Object.fromEntries(
      SEATS.map((id) => [id, { name: "", commander: "", partnerName: "", life: 40, poison: 0 }]),
    ),
    damage: blankDamage(),
    partnerDamage: blankDamage(),
    partners: blankFlags(),
    extras: blankLists(),
    turnStart: null,
  };
}

export function createGame() {
  return { ...freshTable(), past: [] };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function snapshot(state) {
  const { past, ...rest } = state;
  return structuredClone(rest);
}

function withHistory(state, next) {
  const past = [...state.past, snapshot(state)];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { ...state, ...next, past };
}

// 21 combat damage from a single commander, 10 poison, or life at 0 or below.
export function lethalReasons(table, seat) {
  const reasons = [];
  if (table.seats[seat].life <= 0) reasons.push("life");
  if (table.seats[seat].poison >= 10) reasons.push("poison");
  const fromCommander = SEATS.some((from) => {
    if ((table.damage?.[from]?.[seat] ?? 0) >= 21) return true;
    return Boolean(table.partners?.[from]) && (table.partnerDamage?.[from]?.[seat] ?? 0) >= 21;
  });
  if (fromCommander) reasons.push("commander");
  return reasons;
}

function adjustMatrix(state, bucket, from, to, delta) {
  const row = { ...(state[bucket]?.[from] ?? {}) };
  const current = row[to] ?? 0;
  const amount = clamp(current + delta, 0, 99);
  if (amount === current) return state;
  return withHistory(state, {
    [bucket]: {
      ...state[bucket],
      [from]: { ...row, [to]: amount },
    },
  });
}

export function reduce(state, action) {
  switch (action.type) {
    case "life": {
      const seat = state.seats[action.seat];
      const life = clamp(seat.life + action.delta, -99, 999);
      if (life === seat.life) return state;
      return withHistory(state, {
        seats: { ...state.seats, [action.seat]: { ...seat, life } },
        damage: state.damage,
      });
    }
    case "set-life": {
      const seat = state.seats[action.seat];
      const life = clamp(Number(action.life), -99, 999);
      if (!Number.isFinite(life) || life === seat.life) return state;
      return withHistory(state, {
        seats: { ...state.seats, [action.seat]: { ...seat, life } },
        damage: state.damage,
      });
    }
    case "poison": {
      const seat = state.seats[action.seat];
      const poison = clamp(seat.poison + action.delta, 0, 99);
      if (poison === seat.poison) return state;
      return withHistory(state, {
        seats: { ...state.seats, [action.seat]: { ...seat, poison } },
        damage: state.damage,
      });
    }
    case "damage":
      return adjustMatrix(
        state,
        action.which === "b" ? "partnerDamage" : "damage",
        action.from,
        action.to,
        action.delta,
      );
    case "partner":
      return withHistory(state, {
        partners: { ...state.partners, [action.seat]: Boolean(action.on) },
      });
    case "partner-name": {
      const seat = state.seats[action.seat];
      const partnerName = String(action.partnerName ?? "").slice(0, 48);
      if (partnerName === (seat.partnerName ?? "")) return state;
      return withHistory(state, {
        seats: { ...state.seats, [action.seat]: { ...seat, partnerName } },
      });
    }
    case "add-counter": {
      const name = String(action.name ?? "").trim().slice(0, 24);
      if (!name) return state;
      const list = state.extras?.[action.seat] ?? [];
      return withHistory(state, {
        extras: {
          ...state.extras,
          [action.seat]: [...list, { id: action.id ?? `${list.length + 1}-${name}`, name, value: 0 }],
        },
      });
    }
    case "counter": {
      const list = state.extras?.[action.seat] ?? [];
      const index = list.findIndex((item) => item.id === action.id);
      if (index < 0) return state;
      const value = clamp(list[index].value + action.delta, 0, 999);
      if (value === list[index].value) return state;
      const next = list.slice();
      next[index] = { ...list[index], value };
      return withHistory(state, {
        extras: { ...state.extras, [action.seat]: next },
      });
    }
    case "rename-counter": {
      const list = state.extras?.[action.seat] ?? [];
      const index = list.findIndex((item) => item.id === action.id);
      if (index < 0) return state;
      const name = String(action.name ?? "").trim().slice(0, 24);
      if (!name || name === list[index].name) return state;
      const next = list.slice();
      next[index] = { ...list[index], name };
      return withHistory(state, {
        extras: { ...state.extras, [action.seat]: next },
      });
    }
    case "remove-counter": {
      const list = state.extras?.[action.seat] ?? [];
      const next = list.filter((item) => item.id !== action.id);
      if (next.length === list.length) return state;
      return withHistory(state, {
        extras: { ...state.extras, [action.seat]: next },
      });
    }
    case "name": {
      const seat = state.seats[action.seat];
      const name = String(action.name ?? "").slice(0, 24);
      if (name === seat.name) return state;
      return withHistory(state, {
        seats: { ...state.seats, [action.seat]: { ...seat, name } },
        damage: state.damage,
      });
    }
    case "commander": {
      const seat = state.seats[action.seat];
      const commander = String(action.commander ?? "").slice(0, 48);
      if (commander === seat.commander) return state;
      return withHistory(state, {
        seats: { ...state.seats, [action.seat]: { ...seat, commander } },
        damage: state.damage,
      });
    }
    case "first": {
      if (!CLOCKWISE.includes(action.seat) || state.turnStart === action.seat) return state;
      return withHistory(state, { turnStart: action.seat });
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return { ...prev, past: state.past.slice(0, -1) };
    }
    case "reset":
      return withHistory(state, freshTable());
    default:
      return state;
  }
}

function remapSeatMap(map) {
  const next = {};
  if (!map || typeof map !== "object") return next;
  for (const [key, value] of Object.entries(map)) next[seatId(key)] = value;
  return next;
}

function remapDamage(damage) {
  const next = {};
  if (!damage || typeof damage !== "object") return next;
  for (const [from, row] of Object.entries(damage)) next[seatId(from)] = remapSeatMap(row);
  return next;
}

function remapTable(table) {
  if (!table || typeof table !== "object") return table;
  const { past, ...rest } = table;
  const next = { ...rest };
  if (rest.seats) next.seats = remapSeatMap(rest.seats);
  if (rest.damage) next.damage = remapDamage(rest.damage);
  if (rest.partnerDamage) next.partnerDamage = remapDamage(rest.partnerDamage);
  if (rest.partners) next.partners = remapSeatMap(rest.partners);
  if (rest.extras) next.extras = remapSeatMap(rest.extras);
  if (rest.turnStart != null) next.turnStart = seatId(rest.turnStart);
  if (Array.isArray(past)) next.past = past.map((entry) => remapTable(entry));
  return next;
}

export function normalizeStoredGame(parsed) {
  return sanitize(remapTable(parsed));
}

function sanitize(parsed) {
  if (!parsed?.seats || !parsed?.damage) return null;
  for (const seat of SEATS) {
    if (!parsed.seats[seat] || !parsed.damage[seat]) return null;
  }
  const seats = { ...parsed.seats };
  let turnStart = CLOCKWISE.includes(parsed.turnStart) ? parsed.turnStart : null;
  for (const seat of SEATS) {
    if (COMPASS_NAMES.has(seats[seat].name)) {
      seats[seat] = { ...seats[seat], name: "" };
      turnStart = null;
    }
    if (seats[seat].partnerName == null) seats[seat] = { ...seats[seat], partnerName: "" };
  }
  const damage = blankDamage();
  const partnerDamage = blankDamage();
  for (const from of SEATS) {
    for (const to of SEATS) {
      damage[from][to] = parsed.damage?.[from]?.[to] ?? 0;
      partnerDamage[from][to] = parsed.partnerDamage?.[from]?.[to] ?? 0;
    }
  }
  const partners = blankFlags();
  const extras = blankLists();
  for (const seat of SEATS) {
    partners[seat] = Boolean(parsed.partners?.[seat]);
    extras[seat] = Array.isArray(parsed.extras?.[seat]) ? parsed.extras[seat] : [];
  }
  return {
    seats,
    damage,
    partnerDamage,
    partners,
    extras,
    turnStart,
    past: Array.isArray(parsed.past) ? parsed.past.slice(-HISTORY_LIMIT) : [],
  };
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return createGame();
    return normalizeStoredGame(JSON.parse(raw)) ?? createGame();
  } catch {
    return createGame();
  }
}

export function saveGame(game) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
}
