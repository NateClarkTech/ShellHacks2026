import { makeCandidate, pairs } from "../candidate.js";

export function detect(_state, focus, cards) {
  const pool = cards.filter((card) => card.families.includes("replacement"));
  return pairs(pool).map(([left, right]) =>
    makeCandidate({
      shape: "replacement_collision",
      headline: `Which of ${left.name} and ${right.name} replaces the event first?`,
      cards: [left, right],
      focus,
    }),
  );
}
