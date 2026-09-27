import { normName } from "../../vision.js";
import { makeCandidate, pairs } from "../candidate.js";

function legendary(card) {
  return /legendary/i.test(card.type_line ?? "");
}

export function detect(_state, focus, cards) {
  const found = [];
  for (const [left, right] of pairs(cards)) {
    if (!legendary(left) || !legendary(right)) continue;
    if (!left.controller || left.controller !== right.controller) continue;
    if (!normName(left.name) || normName(left.name) !== normName(right.name)) continue;
    found.push(
      makeCandidate({
        shape: "legend",
        headline: `Two legendary ${left.name}s`,
        cards: [left, right],
        focus,
      }),
    );
  }
  return found;
}
