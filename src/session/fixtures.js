import bloodMoon from "../../fixtures/boards/blood-moon.json" with { type: "json" };

export const SAMPLES = [{ id: "blood-moon", label: "Example: Blood Moon", state: bloodMoon }];

export function sampleById(id) {
  return SAMPLES.find((sample) => sample.id === id) ?? null;
}
