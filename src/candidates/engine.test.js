import assert from "node:assert/strict";
import test from "node:test";
import { lookupName } from "../cards/index.js";
import { parseGameState } from "../schema/gs.v1.js";
import { sampleById } from "../session/fixtures.js";
import { clarify } from "./engine.js";
import { choicesFor, resolveChoice, resolveTemplate } from "../resolver/template.js";

const PLAYERS = ["seat1", "seat2", "seat3", "seat4"].map((id, index) => ({
  id,
  display_name: `Seat ${index + 1}`,
  life: 40,
  poison: 0,
  commander_names: [],
  commander_oracle_ids: [],
}));

function blank(id, name, extra = {}) {
  return {
    id,
    oracle_id: null,
    name,
    zone: "battlefield",
    controller: "seat1",
    owner: null,
    status: [],
    attachments: [],
    counters: {},
    cv_confidence: null,
    ...extra,
  };
}

function table(objects, unknowns = ["timestamps", "targets", "phase"]) {
  return parseGameState({
    schema: "gs.v1",
    format: "commander",
    players: PLAYERS,
    objects,
    unknowns,
    active_player: null,
    phase: null,
  });
}

function focusOn(...ids) {
  return { selected_object_ids: ids, auto_included_object_ids: [], reasons: {} };
}

function catalogLookup(extra = {}) {
  return (name) => {
    const card = lookupName(name);
    if (!card) return extra[name] ?? null;
    return { ...card, tags: extra[name]?.tags ?? [], matched_name: null };
  };
}

test("Blood Moon and Urborg raise a layer question", () => {
  const state = parseGameState(sampleById("blood-moon-urborg").state);
  const lookup = catalogLookup({
    "Blood Moon": { tags: [{ id: "moon-tag", slug: "blood-moon-effect", family: "layer_type" }] },
  });
  const { candidates } = clarify(state, focusOn("obj-blood-moon", "obj-urborg"), lookup);
  const layer = candidates.find((candidate) => candidate.shape === "layer_type");
  assert.ok(layer);
  assert.ok(candidates.indexOf(layer) < 7);
  assert.deepEqual(layer.object_ids, ["obj-blood-moon", "obj-urborg"]);
  const answer = resolveTemplate(state, focusOn("obj-blood-moon", "obj-urborg"), layer, lookup);
  assert.equal(answer.verdict, "applies");
  assert.match(answer.one_liner, /does not turn lands into Swamps/);
  assert.equal(choicesFor(state, layer, lookup).length, 0);
});

test("Humility and Glorious Anthem raise a layer question", () => {
  const state = parseGameState(sampleById("humility-anthem").state);
  const lookup = catalogLookup();
  const { candidates } = clarify(state, focusOn("obj-humility", "obj-anthem"), lookup);
  const layer = candidates.find((candidate) => candidate.shape === "layer_type");
  const answer = resolveTemplate(state, focusOn("obj-humility", "obj-anthem"), layer, lookup);
  assert.match(answer.one_liner, /still gives \+1\/\+1/);
  assert.equal(choicesFor(state, layer, lookup).length, 0);
});

test("a third card in the same family is included and ranks below the tapped pair", () => {
  const state = table([
    blank("obj-blood-moon", "Blood Moon", { controller: "seat1" }),
    blank("obj-urborg", "Urborg, Tomb of Yawgmoth", { controller: "seat2" }),
    blank("obj-honor", "Honor of the Pure", { controller: "seat3" }),
  ]);
  const lookup = catalogLookup({
    "Blood Moon": { tags: [{ id: "moon-tag", slug: "blood-moon-effect", family: "layer_type" }] },
    "Honor of the Pure": { tags: [{ id: "anthem-tag", slug: "anthem", family: "layer_type" }] },
  });
  const result = clarify(state, focusOn("obj-blood-moon", "obj-urborg"), lookup);
  assert.deepEqual(result.focus.auto_included_object_ids, ["obj-honor"]);
  assert.match(result.focus.reasons["obj-honor"], /types|power/i);
  const top = result.candidates.find((candidate) => candidate.shape === "layer_type");
  assert.deepEqual(top.object_ids, ["obj-blood-moon", "obj-urborg"]);
  assert.ok(top.priority > result.candidates.find((candidate) => candidate.object_ids.includes("obj-honor")).priority);
});

test("damage increasers and multipliers collide, and taxes stack", () => {
  const state = table([
    blank("obj-torbran", "Torbran, Thane of Red Fell"),
    blank("obj-furnace", "Furnace of Rath"),
    blank("obj-ghostly", "Ghostly Prison"),
    blank("obj-sphere", "Sphere of Resistance"),
  ]);
  const tagged = (name) => {
    const tags = {
      "Torbran, Thane of Red Fell": [{ id: "inc", slug: "damage-increaser", family: "damage" }],
      "Furnace of Rath": [{ id: "mult", slug: "damage-multiplier", family: "damage" }],
      "Ghostly Prison": [{ id: "atk", slug: "tax-attack", family: "tax" }],
      "Sphere of Resistance": [{ id: "cost", slug: "cost-increaser", family: "tax" }],
    };
    return { name, oracle_text: "", tags: tags[name] ?? [], rulings: [] };
  };
  const damage = clarify(state, focusOn("obj-torbran", "obj-furnace"), tagged);
  const damageQuestion = damage.candidates.find((candidate) => candidate.shape === "damage");
  assert.ok(damageQuestion);
  const tax = clarify(state, focusOn("obj-ghostly", "obj-sphere"), tagged);
  const taxQuestion = tax.candidates.find((candidate) => candidate.shape === "tax");
  assert.ok(taxQuestion);
  const answer = resolveTemplate(state, tax.focus, taxQuestion, tagged);
  assert.equal(answer.verdict, "applies");
  assert.match(answer.one_liner, /does not replace/);
});

test("two bonuses in the same layer can be tapped", () => {
  const state = table([
    blank("obj-anthem", "Glorious Anthem"),
    blank("obj-honor", "Honor of the Pure"),
  ]);
  const lookup = () => ({ oracle_text: "Creatures you control get +1/+1.", tags: [], rulings: [] });
  const { candidates } = clarify(state, focusOn("obj-anthem", "obj-honor"), lookup);
  const layer = candidates.find((candidate) => candidate.shape === "layer_type");
  const choices = choicesFor(state, layer, lookup);
  assert.equal(choices.length, 2);
  const answer = resolveChoice(state, layer, lookup, "obj-honor");
  assert.match(answer.one_liner, /Honor of the Pure is applied after Glorious Anthem/);
  assert.match(answer.headline, /Honor of the Pure is newer/);
});

test("a copy is applied before a type change", () => {
  const state = table([
    blank("obj-clone", "Clone"),
    blank("obj-moon", "Blood Moon"),
  ]);
  const lookup = (name) =>
    name === "Clone"
      ? {
          name,
          oracle_text: "You may have this creature enter as a copy of any creature on the battlefield.",
          tags: [{ id: "clone-tag", slug: "clone", family: "layer_copy" }],
          rulings: [],
        }
      : catalogLookup()(name);
  const { candidates } = clarify(state, focusOn("obj-clone", "obj-moon"), lookup);
  const question = candidates.find((candidate) => candidate.shape === "layer_order");
  assert.ok(question);
  assert.equal(choicesFor(state, question, lookup).length, 0);
  const answer = resolveTemplate(state, focusOn("obj-clone", "obj-moon"), question, lookup);
  assert.match(answer.one_liner, /Clone is applied first/);
  assert.match(answer.one_liner, /type change is applied after/);
});

test("as this enters is not the same question as when this enters", () => {
  const state = table([
    blank("obj-as", "Guardian of Faith"),
    blank("obj-when", "Eternal Witness"),
  ]);
  const lookup = (name) =>
    name === "Guardian of Faith"
      ? { name, oracle_text: "As this enters, you may pay {1}. If you don't, it enters tapped.", tags: [], rulings: [] }
      : { name, oracle_text: "When this enters, you may return target card from your graveyard to your hand.", tags: [], rulings: [] };
  const { candidates } = clarify(state, focusOn("obj-as", "obj-when"), lookup);
  const question = candidates.find((candidate) => candidate.shape === "enter_split");
  assert.ok(question);
  assert.equal(candidates.some((candidate) => candidate.shape === "trigger_fires"), false);
  const answer = resolveTemplate(state, focusOn("obj-as", "obj-when"), question, lookup);
  assert.match(answer.one_liner, /changes how it enters/);
  assert.match(answer.one_liner, /on the battlefield/);
});

test("two legendary permanents with the same name ask the legend rule", () => {
  const state = table([
    blank("obj-a", "Rat Colony", { type_line: "Legendary Creature — Rat" }),
    blank("obj-b", "Rat Colony", { type_line: "Legendary Creature — Rat" }),
  ]);
  const lookup = (name) => ({ name, oracle_text: "", type_line: "Legendary Creature — Rat", tags: [], rulings: [] });
  const { candidates } = clarify(state, focusOn("obj-a", "obj-b"), lookup);
  const question = candidates.find((candidate) => candidate.shape === "legend");
  const answer = resolveTemplate(state, focusOn("obj-a", "obj-b"), question, lookup);
  assert.equal(answer.one_liner, "Choose one. The other goes to the graveyard.");
});

test("hexproof stops a spell that destroys a target creature", () => {
  const state = table([
    blank("obj-spell", "Swords to Plowshares"),
    blank("obj-bogle", "Slippery Bogle"),
  ]);
  const lookup = (name) =>
    name === "Swords to Plowshares"
      ? { name, oracle_text: "Destroy target creature.", tags: [], rulings: [] }
      : { name, oracle_text: "Hexproof", tags: [], rulings: [] };
  const { candidates } = clarify(state, focusOn("obj-spell", "obj-bogle"), lookup);
  const question = candidates.find((candidate) => candidate.shape === "targeting");
  assert.ok(question);
  const answer = resolveTemplate(state, focusOn("obj-spell", "obj-bogle"), question, lookup);
  assert.equal(answer.verdict, "does_not_apply");
});
