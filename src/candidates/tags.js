import families from "./families.json" with { type: "json" };
import muted from "./muted-tags.json" with { type: "json" };

const MUTED = new Set(muted);

export const FAMILY_REASON = {
  layer_copy: "Also copies an object",
  layer_control: "Also changes control",
  layer_text: "Also changes text",
  layer_type: "Also changes types",
  layer_color: "Also changes colors",
  layer_ability: "Also removes abilities",
  layer_pt_set: "Also sets power and toughness",
  layer_pt_modify: "Also changes power and toughness",
  layer_pt_switch: "Also switches power and toughness",
  replacement: "Also replaces an event",
  regenerate: "Also regenerates",
  damage: "Also changes damage",
  tax: "Also changes a cost",
  commander: "Also changes commander tax",
  shield: "Also stops targeting",
  trigger: "Also copies a trigger",
  combat: "Also changes combat damage",
};

export const LAYER_RANK = {
  layer_copy: 1,
  layer_control: 2,
  layer_text: 3,
  layer_type: 4,
  layer_color: 5,
  layer_ability: 6,
  layer_pt_set: 70,
  layer_pt_modify: 71,
  layer_pt_switch: 72,
};

export const LAYER_NAME = {
  layer_copy: "the copy",
  layer_control: "control",
  layer_text: "text",
  layer_type: "types",
  layer_color: "color",
  layer_ability: "abilities",
  layer_pt_set: "setting power and toughness",
  layer_pt_modify: "changing power and toughness",
  layer_pt_switch: "switching power and toughness",
};

const PHRASES = [
  ["layer_type", /are mountains|in addition to (?:its|their) other (?:land )?types/i],
  ["layer_ability", /lose all abilities/i],
  ["layer_pt_set", /base power and toughness/i],
  ["layer_pt_modify", /get \+\d+\/\+\d+/i],
  ["layer_pt_switch", /switch(?:es)? power and toughness/i],
  ["layer_control", /gain control of/i],
  ["replacement", /\binstead\b|\bas (?:this|\w+) enters\b|\benters with\b|\benters as\b/i],
  ["regenerate", /(^|\n)\s*regenerate\b/i],
  [
    "damage",
    /damage can't be prevented|prevent(?:s|ed)?\b[^.]*\bdamage|deals? (?:double|twice)\b/i,
  ],
  ["tax", /unless (?:you|that player|they|its controller) pays?|costs? \{[^}]+\} more|attack unless/i],
  ["shield", /hexproof|shroud|protection from|ward\b|can(?:'|’)t be the target/i],
  ["trigger", /\bwhen\b[^.]*\benters\b|triggers? an additional time/i],
  ["combat", /(^|\n)\s*(?:deathtouch|first strike|double strike|trample|lifelink)\b/i],
];

export function layerFamilies(card) {
  return (card?.families ?? []).filter((family) => family in LAYER_RANK);
}

export function familiesFor(card) {
  const found = new Set();
  for (const tag of card?.tags ?? []) {
    if (!tag?.family || MUTED.has(tag.id)) continue;
    if (families[tag.family]) found.add(tag.family);
  }
  const text = card?.oracle_text ?? "";
  if (text) {
    for (const [family, pattern] of PHRASES) {
      if (pattern.test(text)) found.add(family);
    }
  }
  return [...found];
}

export function hardShield(card) {
  const text = card?.oracle_text ?? "";
  return /(^|\n)\s*hexproof\b/i.test(text) || /(^|\n)\s*shroud\b/i.test(text) || /can(?:'|’)t be the target/i.test(text);
}

export function softShield(card) {
  if (hardShield(card)) return false;
  const text = card?.oracle_text ?? "";
  if (/(^|\n)\s*ward\b/i.test(text) || /protection from/i.test(text)) return true;
  return (card?.tags ?? []).some((tag) => /^(ward|old-ward)$/.test(tag.slug ?? ""));
}

export function grantsShield(card) {
  return (card?.tags ?? []).some((tag) => tag.family === "shield" && /^(gives-|gains-)/.test(tag.slug ?? ""));
}
