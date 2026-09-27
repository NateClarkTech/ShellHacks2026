import { lookupName } from "../cards/index.js";
import { SEATS, isDefaultName, seatOrderName } from "../game.js";
import { SCHEMA_ID, UNKNOWN_KINDS, parseGameState } from "../schema/gs.v1.js";

function commanderNames(game, seat) {
  const row = game.seats[seat];
  const names = [];
  if (row.commander) names.push(row.commander);
  if (game.partners?.[seat] && row.partnerName) names.push(row.partnerName);
  return names;
}

function confidenceOf(card) {
  if (typeof card.confidence !== "number" || !Number.isFinite(card.confidence)) return null;
  return Math.min(1, Math.max(0, card.confidence));
}

/**
 * Project the live life counter and board into a GameState.
 * A photo does not know stack order, timestamps, phase, priority, targets, attachments, counters, or modes.
 */
export function projectTable(game, board) {
  const players = SEATS.map((seat) => {
    const row = game.seats[seat];
    const names = commanderNames(game, seat);
    const display = row.name && !isDefaultName(row.name) ? row.name : seatOrderName(seat);
    return {
      id: seat,
      display_name: display,
      life: row.life,
      poison: row.poison,
      commander_names: names,
      commander_oracle_ids: names.map((name) => lookupName(name)?.oracle_id).filter(Boolean),
    };
  });

  const objects = (board?.cards ?? []).map((card) => {
    const known = card.name ? lookupName(card.name) : null;
    return {
      id: card.id,
      oracle_id: known?.oracle_id ?? null,
      name: card.name ?? "",
      zone: card.zone,
      controller: card.controller ?? null,
      owner: null,
      status: [],
      attachments: [],
      counters: {},
      cv_confidence: confidenceOf(card),
    };
  });

  return parseGameState({
    schema: SCHEMA_ID,
    format: "commander",
    players,
    objects,
    unknowns: [...UNKNOWN_KINDS],
    active_player: null,
    phase: null,
    commander_damage: game.damage,
  });
}
