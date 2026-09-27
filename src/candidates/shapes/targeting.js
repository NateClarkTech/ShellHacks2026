import { makeCandidate, pairs } from "../candidate.js";
import { grantsShield, hardShield, softShield } from "../tags.js";

const TARGETS = /\b(?:destroy|exile)s? target\b|\btarget (?:creature|permanent|spell|player)\b|\bdeals? \S+ damage to (?:any )?target\b/i;

function aims(card) {
  return TARGETS.test(card.oracle_text ?? "");
}

function blocks(card) {
  return hardShield(card) || softShield(card) || grantsShield(card);
}

export function detect(state, focus, cards) {
  const found = [];
  for (const [left, right] of pairs(cards)) {
    const spell = aims(left) ? left : aims(right) ? right : null;
    const shield = spell === left ? right : spell === right ? left : null;
    if (!spell || !shield || !blocks(shield)) continue;
    const needs = [];
    if (!hardShield(shield) && state.unknowns?.includes("targets")) needs.push("targets");
    found.push(
      makeCandidate({
        shape: "targeting",
        headline: `Can ${spell.name} target ${shield.name}?`,
        cards: [spell, shield],
        focus,
        needs_facts: needs,
      }),
    );
  }
  return found;
}
