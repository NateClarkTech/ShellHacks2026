import { makeCandidate } from "../candidate.js";
import { asEnters, whenEnters } from "../layers.js";

const ENTERS = /\bwhen\b[^.]*\benters\b/i;

export function detect(state, focus, cards) {
  if (cards.some(asEnters) && cards.some(whenEnters)) return [];
  const needs = state.unknowns?.includes("phase") ? ["phase"] : [];
  return cards
    .filter((card) => card.families.includes("trigger") || ENTERS.test(card.oracle_text ?? ""))
    .map((card) =>
      makeCandidate({
        shape: "trigger_fires",
        headline: `Does ${card.name}'s enter ability happen?`,
        cards: [card],
        focus,
        needs_facts: needs,
      }),
    );
}
