import { makeCandidate, pairs } from "../candidate.js";

function regenerates(card) {
  return card.families.includes("regenerate") || /(^|\n)\s*regenerate\b/i.test(card.oracle_text ?? "");
}

export function detect(_state, focus, cards) {
  const found = [];
  for (const [left, right] of pairs(cards)) {
    const shield = regenerates(left) ? left : regenerates(right) ? right : null;
    const spell = shield === left ? right : shield === right ? left : null;
    if (!shield || !spell || !/\bdestroy\b/i.test(spell.oracle_text ?? "")) continue;
    found.push(
      makeCandidate({
        shape: "regenerate",
        headline: `Does ${shield.name} survive destroy?`,
        cards: [shield, spell],
        focus,
      }),
    );
  }
  return found;
}
