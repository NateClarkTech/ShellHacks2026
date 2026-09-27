import { FAMILY_REASON, familiesFor } from "./tags.js";
import { detect as detectCombat } from "./shapes/combat.js";
import { detect as detectCommander } from "./shapes/commander.js";
import { detect as detectDamage } from "./shapes/damage.js";
import { detect as detectLayer } from "./shapes/layer.js";
import { detect as detectLegend } from "./shapes/legend.js";
import { detect as detectNeed } from "./shapes/need-fact.js";
import { detect as detectRegenerate } from "./shapes/regenerate.js";
import { detect as detectReplacement } from "./shapes/replacement.js";
import { detect as detectTargeting } from "./shapes/targeting.js";
import { detect as detectTax } from "./shapes/tax.js";
import { detect as detectTrigger } from "./shapes/trigger.js";

const DETECTORS = [
  detectTargeting,
  detectReplacement,
  detectDamage,
  detectTax,
  detectLayer,
  detectTrigger,
  detectLegend,
  detectCommander,
  detectCombat,
  detectRegenerate,
  detectNeed,
];

function present(object, lookup) {
  const card = lookup(object?.name) ?? {};
  const oracleText = card.oracle_text ?? "";
  const tags = Array.isArray(card.tags) ? card.tags : [];
  return {
    ...object,
    name: object.name,
    oracle_text: oracleText,
    oracle_id: card.oracle_id ?? object.oracle_id,
    type_line: card.type_line ?? "",
    tags,
    families: familiesFor({ oracle_text: oracleText, tags }),
  };
}

function include(state, focus, cards) {
  const selected = new Set(focus.selected_object_ids ?? []);
  const selectedCards = cards.filter((card) => selected.has(card.id));
  const selectedFamilies = new Set(selectedCards.flatMap((card) => card.families));
  const auto = [];
  const reasons = {};
  for (const card of cards) {
    if (selected.has(card.id) || card.zone !== "battlefield") continue;
    const shared = card.families.find((family) => selectedFamilies.has(family));
    if (!shared) continue;
    auto.push(card.id);
    reasons[card.id] = FAMILY_REASON[shared] ?? "Also matters to this pair";
  }
  return {
    ...focus,
    auto_included_object_ids: auto,
    reasons,
  };
}

export function clarify(state, focus, lookup) {
  const all = (state.objects ?? []).map((object) => present(object, lookup));
  const tagged = all.filter((card) => card.families.length > 0);
  const nextFocus = include(state, focus, tagged);
  const selected = new Set(nextFocus.selected_object_ids ?? []);
  const auto = new Set(nextFocus.auto_included_object_ids ?? []);
  const pool = all.filter((card) => selected.has(card.id) || auto.has(card.id));
  const found = DETECTORS.flatMap((detect) => detect(state, nextFocus, pool));
  const seen = new Set();
  const candidates = found
    .filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, 7);
  return { focus: nextFocus, candidates };
}
