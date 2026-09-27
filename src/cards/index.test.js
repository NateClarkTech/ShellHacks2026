import assert from "node:assert/strict";
import test from "node:test";
import { lookupName } from "./index.js";

test("Blood Moon and Urborg resolve to oracle text and a ruling", () => {
  const moon = lookupName("Blood Moon");
  const urborg = lookupName("Urborg, Tomb of Yawgmoth");
  assert.match(moon.oracle_text, /Nonbasic lands are Mountains/);
  assert.match(moon.rulings[0].comment, /\S/);
  assert.ok(moon.rulings.length > 0);
  assert.match(urborg.oracle_text, /Swamp/);
  assert.ok(urborg.rulings.length > 0);
  assert.equal(lookupName(""), null);
  assert.equal(lookupName("Not a Real Card"), null);
});
