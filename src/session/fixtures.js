import bloodMoon from "../../fixtures/boards/blood-moon-urborg.json" with { type: "json" };
import graveyard from "../../fixtures/boards/graveyard-pair.json" with { type: "json" };
import humility from "../../fixtures/boards/humility-anthem.json" with { type: "json" };

export const SAMPLES = [
  { id: "blood-moon-urborg", label: "Blood Moon", state: bloodMoon },
  { id: "humility-anthem", label: "Humility", state: humility },
  { id: "graveyard-pair", label: "Graveyard", state: graveyard },
];

export function sampleById(id) {
  return SAMPLES.find((sample) => sample.id === id) ?? null;
}
