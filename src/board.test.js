import assert from "node:assert/strict";
import test from "node:test";
import { boardFromScan, reduceBoard, replaceWithScan } from "./board.js";

function scan() {
  return boardFromScan({
    cardsight: [
      { name: "Swords to Plowshares", confidence: "High" },
      { name: "Damnation", confidence: "Medium", suggestions: ["Wrath of God"] },
    ],
    ocr: [
      { name: "Swords to Plowshares", confidence: 1, box: { cx: 0.45, cy: 0.75 } },
      {
        name: "Wrath of God",
        confidence: 0.92,
        alternatives: ["Damnation"],
        box: { cx: 0.5, cy: 0.5 },
      },
    ],
  });
}

test("accepting a guess keeps the seat and marks it accepted", () => {
  let board = scan();
  const swords = board.cards.find((card) => card.name === "Swords to Plowshares");
  assert.equal(swords.placement, "guess");
  board = reduceBoard(board, {
    type: "apply",
    id: swords.id,
    name: swords.name,
    controller: swords.controller,
    zone: swords.zone,
  });
  const accepted = board.cards.find((card) => card.id === swords.id);
  assert.equal(accepted.placement, "accepted");
  assert.equal(accepted.controller, "seat4");
  assert.equal(accepted.zone, "battlefield");
});

test("a dispute stays unnamed until the table accepts one candidate", () => {
  let board = scan();
  const dispute = board.cards.find((card) => card.identity === "choose");
  const skipped = reduceBoard(board, {
    type: "apply",
    id: dispute.id,
    name: "",
    controller: "seat4",
    zone: "stack",
  });
  assert.equal(skipped, board);
  board = reduceBoard(board, {
    type: "apply",
    id: dispute.id,
    name: "Wrath of God",
    controller: "seat2",
    zone: "stack",
  });
  const named = board.cards.find((card) => card.id === dispute.id);
  assert.equal(named.name, "Wrath of God");
  assert.equal(named.identity, "chosen");
  assert.equal(named.controller, "seat2");
  assert.equal(named.placement, "accepted");
  assert.equal(named.zone, "stack");
});

test("moving a card onto the stack puts it on top, and resolve is an accepted zone change", () => {
  let board = scan();
  const swords = board.cards.find((card) => card.name === "Swords to Plowshares");
  const wrath = board.cards.find((card) => card.zone === "stack");
  board = reduceBoard(board, {
    type: "apply",
    id: wrath.id,
    name: "Wrath of God",
    controller: "seat4",
    zone: "stack",
  });
  board = reduceBoard(board, {
    type: "apply",
    id: swords.id,
    name: swords.name,
    controller: "seat4",
    zone: "stack",
  });
  const stack = board.cards
    .filter((card) => card.zone === "stack")
    .sort((a, b) => a.stackIndex - b.stackIndex);
  assert.deepEqual(
    stack.map((card) => card.name),
    ["Wrath of God", "Swords to Plowshares"],
  );
  board = reduceBoard(board, {
    type: "apply",
    id: swords.id,
    name: swords.name,
    controller: "seat4",
    zone: "graveyard",
  });
  const resolved = board.cards.find((card) => card.id === swords.id);
  assert.equal(resolved.zone, "graveyard");
  assert.equal(resolved.stackIndex, null);
  assert.equal(board.cards.filter((card) => card.zone === "stack").length, 1);
});

test("stack order can move and undo restores the previous zone", () => {
  let board = scan();
  const swords = board.cards.find((card) => card.name === "Swords to Plowshares");
  board = reduceBoard(board, {
    type: "apply",
    id: swords.id,
    name: swords.name,
    controller: "seat3",
    zone: "exile",
  });
  assert.equal(board.cards.find((card) => card.id === swords.id).zone, "exile");
  board = reduceBoard(board, { type: "undo" });
  assert.equal(board.cards.find((card) => card.id === swords.id).zone, "battlefield");
  assert.equal(board.cards.find((card) => card.id === swords.id).placement, "guess");
});

test("rotating the photo re-guesses only cards the table has not accepted", () => {
  let board = scan();
  const swords = board.cards.find((card) => card.name === "Swords to Plowshares");
  board = reduceBoard(board, {
    type: "apply",
    id: swords.id,
    name: swords.name,
    controller: "seat4",
    zone: "battlefield",
  });
  board = reduceBoard(board, { type: "rotate", direction: 1, commanders: {} });
  board = reduceBoard(board, { type: "rotate", direction: 1, commanders: {} });
  const kept = board.cards.find((card) => card.id === swords.id);
  assert.equal(kept.controller, "seat4");
  assert.equal(kept.placement, "accepted");
  const wrath = board.cards.find((card) => card.zone !== "battlefield" || card.id !== swords.id);
  assert.equal(board.orientation, 2);
  assert.equal(wrath.zone, "stack");
});

test("toward the top moves a stack card above the one that was on top", () => {
  let board = scan();
  const swords = board.cards.find((card) => card.name === "Swords to Plowshares");
  const wrath = board.cards.find((card) => card.zone === "stack");
  board = reduceBoard(board, {
    type: "apply",
    id: wrath.id,
    name: "Wrath of God",
    controller: "seat4",
    zone: "stack",
  });
  board = reduceBoard(board, {
    type: "apply",
    id: swords.id,
    name: swords.name,
    controller: "seat4",
    zone: "stack",
  });
  board = reduceBoard(board, { type: "stack-move", id: wrath.id, direction: 1 });
  const stack = board.cards
    .filter((card) => card.zone === "stack")
    .sort((a, b) => a.stackIndex - b.stackIndex);
  assert.deepEqual(
    stack.map((card) => card.name),
    ["Swords to Plowshares", "Wrath of God"],
  );
});

test("a new scan undoes back to the board it replaced", () => {
  const first = scan();
  const next = replaceWithScan(first, {
    cardsight: [],
    ocr: [{ name: "Island", confidence: 1, box: { cx: 0.2, cy: 0.8 } }],
  });
  assert.equal(next.cards.some((card) => card.name === "Island"), true);
  const restored = reduceBoard(next, { type: "undo" });
  assert.equal(restored.cards.some((card) => card.name === "Swords to Plowshares"), true);
  assert.equal(restored.cards.some((card) => card.name === "Island"), false);
});

test("add and remove", () => {
  let board = reduceBoard(scan(), {
    type: "add",
    name: "Rhystic Study",
    controller: "seat1",
    zone: "battlefield",
  });
  const added = board.cards.find((card) => card.name === "Rhystic Study");
  assert.equal(added.controller, "seat1");
  assert.equal(added.placement, "accepted");
  assert.equal(added.identity, "manual");
  board = reduceBoard(board, { type: "remove", id: added.id });
  assert.equal(board.cards.some((card) => card.name === "Rhystic Study"), false);
});
