import { LAYER_NAME, LAYER_RANK, layerFamilies } from "./tags.js";

function written(card) {
  return card?.oracle_text ?? "";
}

export function moonCard(card) {
  return (
    /nonbasic lands are mountains/i.test(written(card)) ||
    (card?.tags ?? []).some((tag) => tag.slug === "blood-moon-effect")
  );
}

export function additiveLand(card) {
  return /in addition to (?:its|their) other land types/i.test(written(card));
}

export function setsBase(card) {
  return /lose all abilities/i.test(written(card)) && /base power and toughness 1\/1/i.test(written(card));
}

export function pump(card) {
  if (setsBase(card)) return null;
  const match = written(card).match(/get \+(\d+)\/\+(\d+)/i);
  return match ? { power: match[1], toughness: match[2] } : null;
}

export function asEnters(card) {
  return /\bas (?:this|\w+) enters\b|\benters with\b|\benters as\b/i.test(written(card));
}

export function whenEnters(card) {
  return /\bwhen\b[^.]*\benters\b/i.test(written(card));
}

export function earliestLayer(card) {
  return layerFamilies(card).sort((left, right) => LAYER_RANK[left] - LAYER_RANK[right])[0] ?? null;
}

export function pairKind(left, right) {
  const cards = [left, right];
  if ((moonCard(left) && additiveLand(right)) || (moonCard(right) && additiveLand(left))) return "moon";
  const setter = cards.find(setsBase);
  const bumper = cards.find((card) => pump(card));
  if (setter && bumper && setter !== bumper) return "set-then-pump";
  const leftLayers = new Set(layerFamilies(left));
  const rightLayers = new Set(layerFamilies(right));
  if ((leftLayers.has("layer_copy") && rightLayers.has("layer_type")) || (rightLayers.has("layer_copy") && leftLayers.has("layer_type"))) {
    return "copy-type";
  }
  if ((asEnters(left) && whenEnters(right)) || (asEnters(right) && whenEnters(left))) return "enter-split";
  const shared = [...leftLayers].some((family) => rightLayers.has(family));
  if (shared) return "same";
  if (leftLayers.size && rightLayers.size) return "order";
  return null;
}

export function layerLabel(family) {
  return LAYER_NAME[family] ?? "that effect";
}
