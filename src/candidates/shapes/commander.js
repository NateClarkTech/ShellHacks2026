import { normName } from "../../vision.js";
import { makeCandidate } from "../candidate.js";

function sameName(left, right) {
  const name = normName(left);
  return Boolean(name) && name === normName(right);
}

function commanderOf(state, card) {
  return (state.players ?? []).find(
    (player) => player.id === card.controller && (player.commander_names ?? []).some((name) => sameName(name, card.name)),
  );
}

export function detect(state, focus, cards) {
  const found = [];
  const selected = cards.filter((card) => (focus.selected_object_ids ?? []).includes(card.id));
  for (const [from, row] of Object.entries(state.commander_damage ?? {})) {
    for (const [to, amount] of Object.entries(row ?? {})) {
      if (amount < 21) continue;
      const loser = (state.players ?? []).find((player) => player.id === to);
      const owner = (state.players ?? []).find((player) => player.id === from);
      const involved = selected.length ? selected : cards.slice(0, 1);
      if (!involved.length) continue;
      found.push(
        makeCandidate({
          shape: "commander_damage",
          headline: `${owner?.display_name ?? "A commander"} has dealt ${amount} combat damage to ${loser?.display_name ?? "a player"}`,
          cards: involved,
          focus,
          priority: 3,
        }),
      );
    }
  }
  for (const card of selected) {
    const owner = commanderOf(state, card);
    if (!owner) continue;
    if (card.zone === "command" || card.families.includes("commander")) {
      found.push(
        makeCandidate({
          shape: "commander_tax",
          headline: `What does ${card.name} cost from the command zone?`,
          cards: [card],
          focus,
        }),
      );
    }
    const other = selected.find((item) => item.id !== card.id);
    if (!other) continue;
    const text = other.oracle_text ?? "";
    if (/\b(?:destroy|exile)\b/i.test(text) && /\b(?:graveyard|exile)\b/i.test(text)) {
      found.push(
        makeCandidate({
          shape: "commander_zone",
          headline: `Can ${card.name} return to the command zone?`,
          cards: [card, other],
          focus,
        }),
      );
    } else if (/\b(?:hand|library)\b/i.test(text) && /\bput\b/i.test(text)) {
      found.push(
        makeCandidate({
          shape: "commander_library",
          headline: `Can ${card.name} return to the command zone instead?`,
          cards: [card, other],
          focus,
        }),
      );
    }
  }
  return found;
}
