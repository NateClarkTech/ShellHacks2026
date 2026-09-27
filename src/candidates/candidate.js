import { createCandidate } from "../schema/gs.v1.js";

export function pairs(cards) {
  const list = [...cards];
  const found = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) found.push([list[i], list[j]]);
  }
  return found;
}

export function makeCandidate({ shape, headline, cards, focus, needs_facts = [], priority }) {
  const objectIds = cards.map((card) => card.id).sort();
  const auto = new Set(focus?.auto_included_object_ids ?? []);
  const rank = priority ?? (objectIds.some((id) => auto.has(id)) ? 1 : 2);
  return createCandidate({
    id: `shape:${shape}:${objectIds.join(":")}`,
    shape,
    headline,
    object_ids: objectIds,
    priority: rank,
    needs_facts,
  });
}
