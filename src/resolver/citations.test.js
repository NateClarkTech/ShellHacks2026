import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("rule citations in the templates appear in the saved RulesGuru answers", () => {
  const answers = JSON.parse(readFileSync(join(root, "fixtures/rules/rulesguru.json"), "utf8"))
    .map((row) => row.answer)
    .join("\n");
  const source = readFileSync(join(root, "src/resolver/template.js"), "utf8");
  const cites = [...source.matchAll(/cr:([0-9]+(?:\.[0-9]+[a-z]?)?)/g)].map((match) => match[1]);
  assert.ok(cites.length > 0);
  for (const cite of new Set(cites)) {
    assert.ok(answers.includes(cite), `${cite} is not in the RulesGuru answers`);
  }
});
