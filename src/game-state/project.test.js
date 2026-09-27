import assert from "node:assert/strict";
import test from "node:test";
import { emptyBoard } from "../board.js";
import { createGame, reduce } from "../game.js";
import { UNKNOWN_KINDS } from "../schema/gs.v1.js";
import { sampleById } from "../session/fixtures.js";
import { createSession, selectToggle, sessionFromFixture, sessionFromTable } from "../session/session.js";
import { projectTable } from "./project.js";

function card(id, name, extra = {}) {
  return {
    id,
    name,
    zone: "battlefield",
    controller: "seat1",
    confidence: 1,
    identity: "agreed",
    ...extra,
  };
}

test("projectTable keeps the seat, the life, and the zone", () => {
  let game = createGame();
  game = reduce(game, { type: "name", seat: "seat1", name: "Ada" });
  game = reduce(game, { type: "life", seat: "seat4", delta: -3 });
  const board = emptyBoard();
  board.cards = [
    card("card-1", "Humility", { controller: "seat2" }),
    card("card-2", "Sol Ring", { controller: "seat3" }),
    card("card-3", "Not a Real Card", { controller: "seat1", confidence: 0.4 }),
  ];
  const state = projectTable(game, board);
  assert.equal(state.players.find((player) => player.id === "seat1").display_name, "Ada");
  assert.equal(state.players.find((player) => player.id === "seat4").life, 37);
  const humility = state.objects.find((object) => object.name === "Humility");
  assert.equal(humility.controller, "seat2");
  assert.equal(humility.zone, "battlefield");
  assert.ok(humility.oracle_id);
  assert.equal(humility.owner, null);
  const ring = state.objects.find((object) => object.name === "Sol Ring");
  assert.ok(ring.oracle_id);
  assert.equal(ring.controller, "seat3");
  assert.equal(state.objects.find((object) => object.name === "Not a Real Card").oracle_id, null);
  assert.deepEqual(state.unknowns, [...UNKNOWN_KINDS]);
  assert.equal(state.active_player, null);
});

test("selectToggle adds and removes an id and leaves auto-include empty", () => {
  const game = createGame();
  const board = emptyBoard();
  board.cards = [card("card-1", "Sol Ring")];
  let session = sessionFromTable(game, board);
  assert.equal(createSession(game, board).source, "table");
  session = selectToggle(session, "card-1");
  assert.deepEqual(session.focus.selected_object_ids, ["card-1"]);
  assert.deepEqual(session.focus.auto_included_object_ids, []);
  session = selectToggle(session, "card-1");
  assert.deepEqual(session.focus.selected_object_ids, []);
  assert.deepEqual(session.focus.auto_included_object_ids, []);
});

test("loading a fixture does not mutate the board passed to useTable", () => {
  const game = createGame();
  const board = emptyBoard();
  board.cards = [card("card-1", "Sol Ring")];
  const before = structuredClone(board);
  const session = sessionFromTable(game, board);
  sessionFromFixture(sampleById("blood-moon").state, "blood-moon");
  assert.deepEqual(board, before);
  assert.equal(session.game_state.objects[0].name, "Sol Ring");
});
