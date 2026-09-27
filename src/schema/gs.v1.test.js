import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lookupName } from "../cards/index.js";
import { sampleById } from "../session/fixtures.js";
import { parseGameState } from "./gs.v1.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("a fixture parses as gs.v1", () => {
  const state = parseGameState(sampleById("blood-moon-urborg").state);
  assert.equal(state.schema, "gs.v1");
  assert.equal(state.format, "commander");
  assert.equal(state.objects.length, 2);
  assert.equal(state.active_player, null);
  assert.equal(state.phase, null);
});

test("lookup files agree with the boards and the catalog", () => {
  for (const id of ["blood-moon-urborg", "humility-anthem", "graveyard-pair"]) {
    const expected = JSON.parse(readFileSync(join(root, "fixtures/expected", `${id}.lookup.json`), "utf8"));
    const state = parseGameState(sampleById(id).state);
    assert.equal(expected.board, id);
    for (const card of expected.cards) {
      const row = lookupName(card.name);
      assert.ok(row);
      assert.equal(row.oracle_id, card.oracle_id);
      assert.ok(row.oracle_text);
      assert.ok(row.rulings.length >= card.min_rulings);
      assert.ok(state.objects.some((object) => object.name === card.name && object.oracle_id === card.oracle_id));
    }
  }
});

test("a board missing the schema is rejected", () => {
  assert.throws(() => parseGameState({ format: "commander" }), /schema/);
});
