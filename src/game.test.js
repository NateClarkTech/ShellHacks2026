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

test("commander damage can come from your own commander", () => {
  let game = createGame();
  game = reduce(game, { type: "damage", from: "west", to: "west", delta: 21 });
  assert.equal(game.damage.west.west, 21);
  assert.deepEqual(lethalReasons(game, "west"), ["commander"]);
  const stuck = reduce(game, { type: "damage", from: "west", to: "east", delta: -3 });
  assert.equal(stuck.damage.west.east, 0);
  assert.equal(stuck.past.length, game.past.length);
});

test("partner commanders keep separate damage totals", () => {
  let game = reduce(createGame(), { type: "partner", seat: "south", on: true });
  game = reduce(game, { type: "damage", from: "south", to: "north", delta: 20 });
  game = reduce(game, { type: "damage", from: "south", to: "north", delta: 20, which: "b" });
  assert.equal(game.damage.south.north, 20);
  assert.equal(game.partnerDamage.south.north, 20);
  assert.deepEqual(lethalReasons(game, "north"), []);
  game = reduce(game, { type: "damage", from: "south", to: "north", delta: 1, which: "b" });
  assert.deepEqual(lethalReasons(game, "north"), ["commander"]);
});

test("a seat can keep an extra counter", () => {
  let game = reduce(createGame(), { type: "add-counter", seat: "east", name: "Energy", id: "e1" });
  game = reduce(game, { type: "counter", seat: "east", id: "e1", delta: 2 });
  assert.deepEqual(game.extras.east, [{ id: "e1", name: "Energy", value: 2 }]);
  game = reduce(game, { type: "remove-counter", seat: "east", id: "e1" });
  assert.deepEqual(game.extras.east, []);
});

test("life at zero is lethal and stacks with poison", () => {
  let game = reduce(createGame(), { type: "life", seat: "west", delta: -40 });
  game = reduce(game, { type: "poison", seat: "west", delta: 10 });
  assert.deepEqual(lethalReasons(game, "west"), ["life", "poison"]);
});

test("typing a life total replaces the current one", () => {
  let game = reduce(createGame(), { type: "set-life", seat: "west", life: "27" });
  assert.equal(game.seats.west.life, 27);
  game = reduce(game, { type: "set-life", seat: "west", life: "nope" });
  assert.equal(game.seats.west.life, 27);
  game = reduce(game, { type: "undo" });
  assert.equal(game.seats.west.life, 40);
});

test("the first player becomes seat 1 and the rest follow clockwise", () => {
  const game = reduce(createGame(), { type: "first", seat: "east" });
  assert.equal(game.turnStart, "east");
  assert.equal(game.seats.east.name, "Seat 1");
  assert.equal(game.seats.south.name, "Seat 2");
  assert.equal(game.seats.west.name, "Seat 3");
  assert.equal(game.seats.north.name, "Seat 4");
});

test("a typed name stays when seats are numbered", () => {
  let game = reduce(createGame(), { type: "name", seat: "east", name: "Nate" });
  game = reduce(game, { type: "first", seat: "east" });
  assert.equal(game.seats.east.name, "Nate");
  assert.equal(game.seats.south.name, "Seat 2");
});

test("reset clears the first player and undo brings the table back", () => {
  let game = reduce(createGame(), { type: "first", seat: "west" });
  game = reduce(game, { type: "life", seat: "west", delta: -3 });
  game = reduce(game, { type: "reset" });
  assert.equal(game.turnStart, null);
  assert.equal(game.seats.west.life, 40);
  assert.equal(game.seats.west.name, "");
  game = reduce(game, { type: "undo" });
  assert.equal(game.turnStart, "west");
  assert.equal(game.seats.west.life, 37);
  assert.equal(game.seats.west.name, "Seat 1");
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
