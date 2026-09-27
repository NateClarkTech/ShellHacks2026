import { makeCandidate } from "../candidate.js";
import { timestampMatters } from "../../resolver/template.js";

export function detect(state, focus, cards) {
  const selected = new Set(focus?.selected_object_ids ?? []);
  const chosen = cards.filter((card) => selected.has(card.id));
  const facts = [];
  const unknowns = new Set(state.unknowns ?? []);
  if (unknowns.has("timestamps") && timestampMatters(cards)) facts.push("timestamps");
  if (unknowns.has("targets") && cards.some((card) => /\btarget\b/i.test(card.oracle_text ?? ""))) {
    facts.push("targets");
  }
  if (facts.length === 0 || chosen.length === 0) return [];
  return [
    makeCandidate({
      shape: "need_fact",
      headline: "A fact on the table would change this answer.",
      cards: chosen,
      focus,
      needs_facts: facts,
      priority: 0,
    }),
  ];
}
