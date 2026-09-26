import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleScan, duplicateShare, placementFor, sameCard, vote } from "./vision.js";

test("the same card includes either face of a double-faced name", () => {
  assert.equal(sameCard("Fire // Ice", "Fire"), true);
  assert.equal(sameCard("Swords to Plowshares", "swords to plowshares"), true);
  assert.equal(sameCard("Lightning Bolt", "Bolt"), false);
});

test("readers that agree accept the name", () => {
  const [card] = vote(
    [{ name: "Swords to Plowshares", confidence: "High", suggestions: [] }],
    [{ name: "Swords to Plowshares", confidence: 1, alternatives: [], box: { cx: 0.4, cy: 0.7 } }],
  );
  assert.equal(card.identity, "agreed");
  assert.equal(card.name, "Swords to Plowshares");
  assert.equal(card.box.cx, 0.4);
  assert.deepEqual(card.candidates, []);
});

test("a mutual disagreement asks the table to pick and does not fill a name", () => {
  const [card] = vote(
    [{ name: "Damnation", confidence: "Medium", suggestions: ["Wrath of God"] }],
    [
      {
        name: "Wrath of God",
        confidence: 0.92,
        alternatives: ["Damnation"],
        box: { cx: 0.5, cy: 0.5 },
      },
    ],
  );
  assert.equal(card.identity, "choose");
  assert.equal(card.name, null);
  assert.deepEqual(
    card.candidates.map((item) => item.name),
    ["Wrath of God", "Damnation"],
  );
  assert.ok(card.candidates[0].confidence > card.candidates[1].confidence);
});

test("a one-way near miss stays two cards", () => {
  const cards = vote(
    [{ name: "Damnation", confidence: "High", suggestions: [] }],
    [{ name: "Wrath of God", confidence: 1, alternatives: ["Damnation"], box: { cx: 0.2, cy: 0.2 } }],
  );
  assert.equal(cards.length, 2);
  assert.equal(cards[0].name, "Wrath of God");
  assert.equal(cards[0].identity, "guess");
  assert.equal(cards[1].name, "Damnation");
  assert.equal(cards[1].box, null);
});

test("one confident reader is a guess, and a weak read is a choice", () => {
  const [sure] = vote([], [{ name: "Sol Ring", confidence: 1, box: { cx: 0.2, cy: 0.8 } }]);
  assert.equal(sure.identity, "guess");
  assert.equal(sure.name, "Sol Ring");

  const [weak] = vote(
    [{ name: "Atraxa, Praetors' Voice", confidence: "Low", suggestions: ["Atraxa, Grand Unifier"] }],
    [],
  );
  assert.equal(weak.identity, "choose");
  assert.equal(weak.name, null);
  assert.equal(weak.candidates[0].name, "Atraxa, Praetors' Voice");
  assert.equal(weak.candidates[1].name, "Atraxa, Grand Unifier");
});

test("two copies stay two slots when both readers see both", () => {
  const cards = vote(
    [
      { name: "Sol Ring", confidence: "High" },
      { name: "Sol Ring", confidence: "High" },
    ],
    [
      { name: "Sol Ring", confidence: 1, box: { cx: 0.2, cy: 0.7 } },
      { name: "Sol Ring", confidence: 1, box: { cx: 0.8, cy: 0.3 } },
    ],
  );
  assert.equal(cards.length, 2);
  assert.ok(cards.every((card) => card.identity === "agreed" && card.name === "Sol Ring"));
  assert.notEqual(cards[0].box.cx, cards[1].box.cx);
});

test("position guesses seat, zone, and the stack", () => {
  const board = {
    battlefield: placementFor({ name: "Birds", box: { cx: 0.45, cy: 0.75 } }),
    graveyard: placementFor({ name: "Witness", box: { cx: 0.9, cy: 0.68 } }),
    exile: placementFor({ name: "Path", box: { cx: 0.9, cy: 0.32 } }),
    library: placementFor({ name: "Island", box: { cx: 0.52, cy: 0.96 } }),
    command: placementFor(
      { name: "Atraxa, Praetors' Voice", box: { cx: 0.52, cy: 0.96 } },
      0,
      { south: "Atraxa, Praetors' Voice" },
    ),
    stack: placementFor({ name: "Wrath", box: { cx: 0.5, cy: 0.5 } }),
    north: placementFor({ name: "Humility", box: { cx: 0.55, cy: 0.22 } }),
    unplaced: placementFor({ name: "Rest in Peace", box: null }),
  };
  assert.equal(board.battlefield.zone, "battlefield");
  assert.equal(board.battlefield.controller, "south");
  assert.equal(board.graveyard.zone, "graveyard");
  assert.equal(board.graveyard.controller, "east");
  assert.equal(board.exile.zone, "exile");
  assert.equal(board.exile.controller, "east");
  assert.equal(board.library.zone, "library");
  assert.equal(board.library.controller, "south");
  assert.equal(board.command.zone, "command");
  assert.equal(board.stack.zone, "stack");
  assert.equal(board.stack.controller, null);
  assert.equal(board.north.controller, "north");
  assert.equal(board.north.zone, "battlefield");
  assert.equal(board.unplaced.controller, null);
  assert.match(board.unplaced.reason, /No position/);
});

test("turning the photo a half turn sends the bottom edge to north", () => {
  const card = { name: "Birds", box: { cx: 0.45, cy: 0.75 } };
  assert.equal(placementFor(card, 0).controller, "south");
  assert.equal(placementFor(card, 2).controller, "north");
});

test("the staged scan is a full board with an agreement, a dispute, and a stack", () => {
  const payload = JSON.parse(
    readFileSync(new URL("../public/staged-scan.json", import.meta.url), "utf8"),
  );
  const cards = assembleScan(payload, { commanders: { south: "Atraxa, Praetors' Voice" } });
  const byName = Object.fromEntries(cards.filter((card) => card.name).map((card) => [card.name, card]));
  assert.equal(byName["Swords to Plowshares"].identity, "agreed");
  assert.equal(byName["Swords to Plowshares"].controller, "south");
  assert.equal(byName["Humility"].controller, "north");
  assert.equal(byName["Sol Ring"].identity, "guess");
  assert.equal(byName["Sol Ring"].zone, "battlefield");
  assert.equal(byName["Eternal Witness"].zone, "graveyard");
  assert.equal(byName["Path to Exile"].zone, "exile");
  const dispute = cards.find((card) => card.identity === "choose" && card.zone === "stack");
  assert.ok(dispute);
  assert.equal(dispute.name, null);
  assert.equal(dispute.stackIndex, 0);
  const atraxa = cards.find((card) => card.candidates.some((item) => item.name.startsWith("Atraxa")));
  assert.equal(atraxa.identity, "choose");
  assert.equal(atraxa.zone, "library");
  const peace = byName["Rest in Peace"];
  assert.equal(peace.identity, "guess");
  assert.equal(peace.box, null);
});

test("a cardsight-only crop keeps the quad, and an unread crop asks for a name", () => {
  const [seen] = vote(
    [{ name: "Sol Ring", confidence: "High", suggestions: [], box: { cx: 0.2, cy: 0.3 } }],
    [],
  );
  assert.equal(seen.name, "Sol Ring");
  assert.equal(seen.box.cx, 0.2);
  const [missed] = vote([], [{ name: null, box: { cx: 0.4, cy: 0.4 }, note: "Glare. Retake this photo." }]);
  assert.equal(missed.name, null);
  assert.equal(missed.identity, "choose");
  assert.match(missed.note, /Glare/);
});

test("a seat scan pins the seat and zone, and a token still asks", () => {
  const cards = assembleScan(
    {
      cardsight: [],
      ocr: [
        { name: "Forest", confidence: 1, box: { cx: 0.2, cy: 0.2 } },
        { name: "Squirrel", confidence: 1, box: { cx: 0.8, cy: 0.2 } },
      ],
    },
    { controller: "north", zone: "graveyard", photoId: "p1" },
  );
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.equal(card.controller, "north");
    assert.equal(card.zone, "graveyard");
    assert.equal(card.placement, "accepted");
    assert.equal(card.photoId, "p1");
  }
  const squirrel = cards.find((card) => card.name === "Squirrel");
  assert.equal(squirrel.identity, "confirm");
  assert.equal(cards.find((card) => card.name === "Forest").identity, "guess");
});

test("duplicate share counts two forests twice and ignores a different one", () => {
  assert.equal(duplicateShare(["Forest", "Forest", "Sol Ring"], ["Forest", "Island"]), 0.5);
  assert.equal(duplicateShare(["Forest"], ["Forest", "Forest"]), 0.5);
  assert.equal(duplicateShare([], ["Forest"]), 0);
});
