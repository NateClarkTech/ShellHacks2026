import assert from "node:assert/strict";
import test from "node:test";
import { clearCardCache, loadCard } from "./load.js";

test("a catalog card does not fetch", async () => {
  clearCardCache();
  let calls = 0;
  const card = await loadCard("Blood Moon", async () => {
    calls += 1;
    throw new Error("should not fetch");
  });
  assert.equal(calls, 0);
  assert.match(card.oracle_text, /Nonbasic lands are Mountains/);
});

test("a name outside the catalog is fetched once and then reused", async () => {
  clearCardCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        name: "Rhystic Study",
        oracle_id: "study",
        oracle_text: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
        rulings: [],
        tags: [],
        matched_name: null,
      }),
    };
  };
  const first = await loadCard("Rhystic Study", fetchImpl);
  const second = await loadCard("Rhystic Study", fetchImpl);
  assert.equal(calls, 1);
  assert.equal(first.oracle_text, second.oracle_text);
  assert.match(first.oracle_text, /unless that player pays/);
});
