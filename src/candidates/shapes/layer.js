import { makeCandidate, pairs } from "../candidate.js";
import { pairKind } from "../layers.js";

export function detect(state, focus, cards) {
  const needs = state.unknowns?.includes("timestamps") ? ["timestamps"] : [];
  const found = [];
  for (const [left, right] of pairs(cards)) {
    const kind = pairKind(left, right);
    if (kind === "moon" || kind === "set-then-pump" || kind === "same") {
      found.push(
        makeCandidate({
          shape: "layer_type",
          headline:
            kind === "same"
              ? `Which of ${left.name} and ${right.name} is newer?`
              : `How do ${left.name} and ${right.name} interact?`,
          cards: [left, right],
          focus,
          needs_facts: kind === "same" ? needs : [],
        }),
      );
    } else if (kind === "copy-type" || kind === "order") {
      found.push(
        makeCandidate({
          shape: "layer_order",
          headline: `Which of ${left.name} and ${right.name} is applied first?`,
          cards: [left, right],
          focus,
        }),
      );
    } else if (kind === "enter-split") {
      found.push(
        makeCandidate({
          shape: "enter_split",
          headline: `Do ${left.name} and ${right.name} change the same event?`,
          cards: [left, right],
          focus,
        }),
      );
    }
  }
  return found;
}
