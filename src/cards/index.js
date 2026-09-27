import catalog from "../../fixtures/cards/catalog.json" with { type: "json" };
import { normName } from "../vision.js";

const byOracle = new Map(Object.entries(catalog));
const byName = new Map();

for (const card of byOracle.values()) {
  const key = normName(card.name);
  if (key) byName.set(key, card);
}

/** Oracle text and Scryfall rulings for a printed name, or null when the local list does not have it. */
export function lookupName(name) {
  const key = normName(name);
  if (!key) return null;
  return byName.get(key) ?? null;
}

export function lookupOracleId(oracleId) {
  if (!oracleId) return null;
  return byOracle.get(oracleId) ?? null;
}
