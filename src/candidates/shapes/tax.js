import { makeCandidate, pairs } from "../candidate.js";

export function detect(_state, focus, cards) {
  const pool = cards.filter((card) => card.families.includes("tax"));
  return pairs(pool).map(([left, right]) =>
    makeCandidate({
      shape: "tax",
      headline: `Do ${left.name} and ${right.name} both have to be paid?`,
      cards: [left, right],
      focus,
    }),
  );
}
