import { makeCandidate } from "../candidate.js";

const KEYWORDS = [
  ["deathtouch", /(^|\n)\s*deathtouch\b/i],
  ["first strike", /(^|\n)\s*first strike\b/i],
  ["double strike", /(^|\n)\s*double strike\b/i],
  ["trample", /(^|\n)\s*trample\b/i],
  ["lifelink", /(^|\n)\s*lifelink\b/i],
];

export function detect(_state, focus, cards) {
  if (cards.length < 2) return [];
  const found = [];
  for (const card of cards) {
    for (const [name, pattern] of KEYWORDS) {
      if (!pattern.test(card.oracle_text ?? "")) continue;
      found.push(
        makeCandidate({
          shape: "combat",
          headline: `${card.name} has ${name}`,
          cards: [card],
          focus,
        }),
      );
    }
  }
  return found;
}
