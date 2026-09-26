import assert from "node:assert/strict";
import test from "node:test";
import { createGame, lethalReasons, normalizeStoredGame, reduce, turnLabel } from "./game.js";

test("life changes and clamps", () => {
  let game = createGame();
  game = reduce(game, { type: "life", seat: "seat4", delta: -1 });
  assert.equal(game.seats.seat4.life, 39);
  game = reduce(game, { type: "life", seat: "seat4", delta: -99 });
  assert.equal(game.seats.seat4.life, -60);
  game = reduce(game, { type: "life", seat: "seat4", delta: -99 });
  assert.equal(game.seats.seat4.life, -99);
  assert.equal(game.past.length, 3);
});

test("a life change that hits the cap does not record history", () => {
  let game = createGame();
  game = reduce(game, { type: "life", seat: "seat2", delta: 959 });
  const stuck = reduce(game, { type: "life", seat: "seat2", delta: 5 });
  assert.equal(stuck.seats.seat2.life, 999);
  assert.equal(stuck.past.length, game.past.length);
});

test("poison stays at zero and is lethal at 10", () => {
  let game = createGame();
  game = reduce(game, { type: "poison", seat: "seat3", delta: -1 });
  assert.equal(game.seats.seat3.poison, 0);
  assert.equal(game.past.length, 0);
  game = reduce(game, { type: "poison", seat: "seat3", delta: 10 });
  assert.deepEqual(lethalReasons(game, "seat3"), ["poison"]);
});

test("commander damage from two opponents does not add together", () => {
  let game = createGame();
  game = reduce(game, { type: "damage", from: "seat4", to: "seat2", delta: 20 });
  game = reduce(game, { type: "damage", from: "seat3", to: "seat2", delta: 20 });
  assert.deepEqual(lethalReasons(game, "seat2"), []);
});

test("commander damage is lethal from a single opponent at 21", () => {
  let game = createGame();
  game = reduce(game, { type: "damage", from: "seat4", to: "seat2", delta: 20 });
  assert.deepEqual(lethalReasons(game, "seat2"), []);
  game = reduce(game, { type: "damage", from: "seat4", to: "seat2", delta: 1 });
  assert.equal(game.damage.seat4.seat2, 21);
  assert.deepEqual(lethalReasons(game, "seat2"), ["commander"]);
  assert.deepEqual(lethalReasons(game, "seat4"), []);
});

test("commander damage can come from your own commander", () => {
  let game = createGame();
  game = reduce(game, { type: "damage", from: "seat1", to: "seat1", delta: 21 });
  assert.equal(game.damage.seat1.seat1, 21);
  assert.deepEqual(lethalReasons(game, "seat1"), ["commander"]);
  const stuck = reduce(game, { type: "damage", from: "seat1", to: "seat3", delta: -3 });
  assert.equal(stuck.damage.seat1.seat3, 0);
  assert.equal(stuck.past.length, game.past.length);
});

test("partner commanders keep separate damage totals", () => {
  let game = reduce(createGame(), { type: "partner", seat: "seat4", on: true });
  game = reduce(game, { type: "damage", from: "seat4", to: "seat2", delta: 20 });
  game = reduce(game, { type: "damage", from: "seat4", to: "seat2", delta: 20, which: "b" });
  assert.equal(game.damage.seat4.seat2, 20);
  assert.equal(game.partnerDamage.seat4.seat2, 20);
  assert.deepEqual(lethalReasons(game, "seat2"), []);
  game = reduce(game, { type: "damage", from: "seat4", to: "seat2", delta: 1, which: "b" });
  assert.deepEqual(lethalReasons(game, "seat2"), ["commander"]);
});

test("a seat can keep an extra counter", () => {
  let game = reduce(createGame(), { type: "add-counter", seat: "seat3", name: "Energy", id: "e1" });
  game = reduce(game, { type: "counter", seat: "seat3", id: "e1", delta: 2 });
  assert.deepEqual(game.extras.seat3, [{ id: "e1", name: "Energy", value: 2 }]);
  game = reduce(game, { type: "remove-counter", seat: "seat3", id: "e1" });
  assert.deepEqual(game.extras.seat3, []);
});

test("life at zero is lethal and stacks with poison", () => {
  let game = reduce(createGame(), { type: "life", seat: "seat1", delta: -40 });
  game = reduce(game, { type: "poison", seat: "seat1", delta: 10 });
  assert.deepEqual(lethalReasons(game, "seat1"), ["life", "poison"]);
});

test("typing a life total replaces the current one", () => {
  let game = reduce(createGame(), { type: "set-life", seat: "seat1", life: "27" });
  assert.equal(game.seats.seat1.life, 27);
  game = reduce(game, { type: "set-life", seat: "seat1", life: "nope" });
  assert.equal(game.seats.seat1.life, 27);
  game = reduce(game, { type: "undo" });
  assert.equal(game.seats.seat1.life, 40);
});

test("the first player is 1st and the rest follow clockwise", () => {
  const game = reduce(createGame(), { type: "first", seat: "seat3" });
  assert.equal(game.turnStart, "seat3");
  assert.equal(turnLabel(game.turnStart, "seat3"), "1st");
  assert.equal(turnLabel(game.turnStart, "seat4"), "2nd");
  assert.equal(turnLabel(game.turnStart, "seat1"), "3rd");
  assert.equal(turnLabel(game.turnStart, "seat2"), "4th");
  assert.equal(game.seats.seat3.name, "");
  assert.equal(game.seats.seat1.name, "");
});

test("a typed name stays when the turn order is chosen", () => {
  let game = reduce(createGame(), { type: "name", seat: "seat3", name: "Nate" });
  game = reduce(game, { type: "first", seat: "seat3" });
  assert.equal(game.seats.seat3.name, "Nate");
  assert.equal(game.seats.seat4.name, "");
  assert.equal(turnLabel(game.turnStart, "seat3"), "1st");
});

test("reset clears the first player and undo brings the table back", () => {
  let game = reduce(createGame(), { type: "first", seat: "seat1" });
  game = reduce(game, { type: "life", seat: "seat1", delta: -3 });
  game = reduce(game, { type: "reset" });
  assert.equal(game.turnStart, null);
  assert.equal(game.seats.seat1.life, 40);
  assert.equal(game.seats.seat1.name, "");
  game = reduce(game, { type: "undo" });
  assert.equal(game.turnStart, "seat1");
  assert.equal(game.seats.seat1.life, 37);
  assert.equal(game.seats.seat1.name, "");
  assert.equal(turnLabel(game.turnStart, "seat1"), "1st");
});

test("undo restores the previous table and reset is undoable", () => {
  let game = reduce(createGame(), { type: "life", seat: "seat4", delta: -5 });
  game = reduce(game, { type: "reset" });
  assert.equal(game.seats.seat4.life, 40);
  game = reduce(game, { type: "undo" });
  assert.equal(game.seats.seat4.life, 35);
  game = reduce(game, { type: "undo" });
  assert.equal(game.seats.seat4.life, 40);
  assert.equal(reduce(game, { type: "undo" }), game);
});

test("names and commanders commit once and trim to a limit", () => {
  let game = reduce(createGame(), {
    type: "name",
    seat: "seat4",
    name: "Paul",
  });
  assert.equal(game.seats.seat4.name, "Paul");
  const same = reduce(game, { type: "name", seat: "seat4", name: "Paul" });
  assert.equal(same.past.length, game.past.length);
  game = reduce(game, {
    type: "commander",
    seat: "seat4",
    commander: "A".repeat(80),
  });
  assert.equal(game.seats.seat4.commander.length, 48);
});

test("a saved compass table becomes seat order", () => {
  const blank = { name: "", commander: "", partnerName: "", life: 40, poison: 0 };
  const game = normalizeStoredGame({
    seats: {
      south: { ...blank, name: "Sam", life: 37 },
      north: { ...blank, name: "Ada", commander: "Kinnan" },
      west: { ...blank },
      east: { ...blank },
    },
    damage: { south: { north: 3 }, north: {}, west: {}, east: {} },
    partnerDamage: { south: {}, north: {}, west: {}, east: {} },
    partners: { south: true },
    extras: { east: [{ id: "e", name: "Energy", value: 1 }] },
    turnStart: "west",
    past: [
      {
        seats: {
          south: { ...blank },
          north: { ...blank },
          west: { ...blank },
          east: { ...blank },
        },
        damage: { south: { north: 0 } },
        turnStart: "south",
      },
    ],
  });
  assert.equal(game.seats.seat4.life, 37);
  assert.equal(game.seats.seat4.name, "Sam");
  assert.equal(game.seats.seat2.name, "Ada");
  assert.equal(game.seats.seat2.commander, "Kinnan");
  assert.equal(game.damage.seat4.seat2, 3);
  assert.equal(game.partners.seat4, true);
  assert.equal(game.extras.seat3[0].name, "Energy");
  assert.equal(game.turnStart, "seat1");
  assert.equal(game.past[0].turnStart, "seat4");
  assert.equal(game.past[0].seats.seat4.life, 40);
});
