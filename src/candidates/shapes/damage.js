import { makeCandidate, pairs } from "../candidate.js";

export function detect(_state, focus, cards) {
  const pool = cards.filter((card) => card.families.includes("damage"));
  return pairs(pool).map(([left, right]) =>
    makeCandidate({
      shape: "damage",
      headline: `How do ${left.name} and ${right.name} change the same damage?`,
      cards: [left, right],
      focus,
      needs_facts: [],
    }),
  );
}
