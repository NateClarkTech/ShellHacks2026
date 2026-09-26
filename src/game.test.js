import assert from "node:assert/strict";
import test from "node:test";
import { createGame, lethalReasons, reduce } from "./game.js";

test("life changes and clamps", () => {
  let game = createGame();
  game = reduce(game, { type: "life", seat: "south", delta: -1 });
  assert.equal(game.seats.south.life, 39);
  game = reduce(game, { type: "life", seat: "south", delta: -99 });
  assert.equal(game.seats.south.life, -60);
  game = reduce(game, { type: "life", seat: "south", delta: -99 });
  assert.equal(game.seats.south.life, -99);
  assert.equal(game.past.length, 3);
});

test("a life change that hits the cap does not record history", () => {
  let game = createGame();
  game = reduce(game, { type: "life", seat: "north", delta: 959 });
  const stuck = reduce(game, { type: "life", seat: "north", delta: 5 });
  assert.equal(stuck.seats.north.life, 999);
  assert.equal(stuck.past.length, game.past.length);
});

test("poison stays at zero and is lethal at 10", () => {
  let game = createGame();
  game = reduce(game, { type: "poison", seat: "east", delta: -1 });
  assert.equal(game.seats.east.poison, 0);
  assert.equal(game.past.length, 0);
  game = reduce(game, { type: "poison", seat: "east", delta: 10 });
  assert.deepEqual(lethalReasons(game, "east"), ["poison"]);
});

test("commander damage from two opponents does not add together", () => {
  let game = createGame();
  game = reduce(game, { type: "damage", from: "south", to: "north", delta: 20 });
  game = reduce(game, { type: "damage", from: "east", to: "north", delta: 20 });
  assert.deepEqual(lethalReasons(game, "north"), []);
});

test("commander damage is lethal from a single opponent at 21", () => {
  let game = createGame();
  game = reduce(game, { type: "damage", from: "south", to: "north", delta: 20 });
  assert.deepEqual(lethalReasons(game, "north"), []);
  game = reduce(game, { type: "damage", from: "south", to: "north", delta: 1 });
  assert.equal(game.damage.south.north, 21);
  assert.deepEqual(lethalReasons(game, "north"), ["commander"]);
  assert.deepEqual(lethalReasons(game, "south"), []);
});

test("commander damage does not go below zero and ignores a self hit", () => {
  let game = createGame();
  game = reduce(game, { type: "damage", from: "west", to: "east", delta: -3 });
  assert.equal(game.damage.west.east, 0);
  assert.equal(game.past.length, 0);
  const same = reduce(game, { type: "damage", from: "west", to: "west", delta: 5 });
  assert.equal(same, game);
});

test("life at zero is lethal and stacks with poison", () => {
  let game = reduce(createGame(), { type: "life", seat: "west", delta: -40 });
  game = reduce(game, { type: "poison", seat: "west", delta: 10 });
  assert.deepEqual(lethalReasons(game, "west"), ["life", "poison"]);
});

test("undo restores the previous table and reset is undoable", () => {
  let game = reduce(createGame(), { type: "life", seat: "south", delta: -5 });
  game = reduce(game, { type: "reset" });
  assert.equal(game.seats.south.life, 40);
  game = reduce(game, { type: "undo" });
  assert.equal(game.seats.south.life, 35);
  game = reduce(game, { type: "undo" });
  assert.equal(game.seats.south.life, 40);
  assert.equal(reduce(game, { type: "undo" }), game);
});

test("names and commanders commit once and trim to a limit", () => {
  let game = reduce(createGame(), {
    type: "name",
    seat: "south",
    name: "Paul",
  });
  assert.equal(game.seats.south.name, "Paul");
  const same = reduce(game, { type: "name", seat: "south", name: "Paul" });
  assert.equal(same.past.length, game.past.length);
  game = reduce(game, {
    type: "commander",
    seat: "south",
    commander: "A".repeat(80),
  });
  assert.equal(game.seats.south.commander.length, 48);
});
