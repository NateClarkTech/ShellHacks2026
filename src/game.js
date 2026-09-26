export const SEATS = ["south", "north", "west", "east"];

export const SEAT_ACCENT = {
  south: "#e3c27a",
  north: "#8fb8c9",
  west: "#7dba8a",
  east: "#d4726a",
};

const DEFAULT_NAMES = {
  south: "South",
  north: "North",
  west: "West",
  east: "East",
};

const HISTORY_LIMIT = 40;

export function opponentsOf(seat) {
  return SEATS.filter((other) => other !== seat);
}

function blankDamage() {
  const damage = {};
  for (const from of SEATS) {
    damage[from] = {};
    for (const to of opponentsOf(from)) damage[from][to] = 0;
  }
  return damage;
}

export function freshTable() {
  return {
    seats: Object.fromEntries(
      SEATS.map((id) => [
        id,
        { name: DEFAULT_NAMES[id], commander: "", life: 40, poison: 0 },
      ]),
    ),
    damage: blankDamage(),
  };
}

export function createGame() {
  return { ...freshTable(), past: [] };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function snapshot(state) {
  return structuredClone({ seats: state.seats, damage: state.damage });
}

function withHistory(state, next) {
  const past = [...state.past, snapshot(state)];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { ...next, past };
}

// 21 combat damage from a single commander, 10 poison, or life at 0 or below.
export function lethalReasons(table, seat) {
  const reasons = [];
  if (table.seats[seat].life <= 0) reasons.push("life");
  if (table.seats[seat].poison >= 10) reasons.push("poison");
  const fromCommander = opponentsOf(seat).some(
    (from) => (table.damage[from]?.[seat] ?? 0) >= 21,
  );
  if (fromCommander) reasons.push("commander");
  return reasons;
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
    case "poison": {
      const seat = state.seats[action.seat];
      const poison = clamp(seat.poison + action.delta, 0, 99);
      if (poison === seat.poison) return state;
      return withHistory(state, {
        seats: { ...state.seats, [action.seat]: { ...seat, poison } },
        damage: state.damage,
      });
    }
    case "damage": {
      if (action.from === action.to) return state;
      const row = state.damage[action.from];
      if (!row || row[action.to] == null) return state;
      const amount = clamp(row[action.to] + action.delta, 0, 99);
      if (amount === row[action.to]) return state;
      return withHistory(state, {
        seats: state.seats,
        damage: {
          ...state.damage,
          [action.from]: { ...row, [action.to]: amount },
        },
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

const STORAGE_KEY = "commander-table-v1";

export function loadGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createGame();
    const parsed = JSON.parse(raw);
    if (!parsed?.seats || !parsed?.damage) return createGame();
    for (const seat of SEATS) {
      if (!parsed.seats[seat] || !parsed.damage[seat]) return createGame();
    }
    return {
      seats: parsed.seats,
      damage: parsed.damage,
      past: Array.isArray(parsed.past) ? parsed.past.slice(-HISTORY_LIMIT) : [],
    };
  } catch {
    return createGame();
  }
}

export function saveGame(game) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
}
