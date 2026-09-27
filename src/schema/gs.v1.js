export const SCHEMA_ID = "gs.v1";

export const UNKNOWN_KINDS = Object.freeze([
  "stack",
  "timestamps",
  "phase",
  "priority",
  "targets",
  "attachments",
  "counters",
  "modes",
]);

export const ZONES = Object.freeze([
  "battlefield",
  "graveyard",
  "exile",
  "command",
  "library",
  "hand",
  "stack",
]);

export const VERDICTS = Object.freeze([
  "legal",
  "illegal",
  "applies",
  "does_not_apply",
  "depends",
  "unknown",
]);

export const SOURCE_TIERS = Object.freeze(["ruling", "template", "rag", "llm", "engine"]);

const UNKNOWN = new Set(UNKNOWN_KINDS);
const ZONE = new Set(ZONES);
const VERDICT = new Set(VERDICTS);
const TIER = new Set(SOURCE_TIERS);

function fail(path, message) {
  const error = new Error(`${path}: ${message}`);
  error.name = "SchemaError";
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value, path) {
  if (typeof value !== "string") fail(path, "must be a string");
  return value;
}

function asStringList(value, path) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(path, "must be a list of strings");
  }
  return [...value];
}

function parsePlayer(value, path) {
  if (!isObject(value)) fail(path, "must be an object");
  const id = asString(value.id, `${path}.id`);
  if (!id) fail(`${path}.id`, "must be set");
  if (typeof value.life !== "number" || !Number.isFinite(value.life)) fail(`${path}.life`, "must be a number");
  if (typeof value.poison !== "number" || !Number.isFinite(value.poison)) fail(`${path}.poison`, "must be a number");
  return {
    id,
    display_name: asString(value.display_name, `${path}.display_name`),
    life: value.life,
    poison: value.poison,
    commander_names: asStringList(value.commander_names, `${path}.commander_names`),
    commander_oracle_ids: asStringList(value.commander_oracle_ids, `${path}.commander_oracle_ids`),
  };
}

function parseObject(value, path, playerIds) {
  if (!isObject(value)) fail(path, "must be an object");
  const id = asString(value.id, `${path}.id`);
  if (!id) fail(`${path}.id`, "must be set");
  const zone = asString(value.zone, `${path}.zone`);
  if (!ZONE.has(zone)) fail(`${path}.zone`, "is not a zone");
  const controller = value.controller == null ? null : asString(value.controller, `${path}.controller`);
  if (controller && !playerIds.has(controller)) fail(`${path}.controller`, "must be a player");
  const owner = value.owner == null ? null : asString(value.owner, `${path}.owner`);
  if (owner && !playerIds.has(owner)) fail(`${path}.owner`, "must be a player");
  const oracleId = value.oracle_id == null ? null : asString(value.oracle_id, `${path}.oracle_id`);
  if (oracleId === "") fail(`${path}.oracle_id`, "must be set or null");
  let confidence = null;
  if (value.cv_confidence != null) {
    if (typeof value.cv_confidence !== "number" || !Number.isFinite(value.cv_confidence)) {
      fail(`${path}.cv_confidence`, "must be a number or null");
    }
    if (value.cv_confidence < 0 || value.cv_confidence > 1) fail(`${path}.cv_confidence`, "must be from 0 to 1");
    confidence = value.cv_confidence;
  }
  if (!isObject(value.counters)) fail(`${path}.counters`, "must be an object");
  const counters = {};
  for (const [name, amount] of Object.entries(value.counters)) {
    if (typeof amount !== "number" || !Number.isFinite(amount)) fail(`${path}.counters.${name}`, "must be a number");
    counters[name] = amount;
  }
  return {
    id,
    oracle_id: oracleId,
    name: asString(value.name, `${path}.name`),
    zone,
    controller,
    owner,
    status: asStringList(value.status, `${path}.status`),
    attachments: asStringList(value.attachments, `${path}.attachments`),
    counters,
    cv_confidence: confidence,
  };
}

function parseDamage(value) {
  if (!isObject(value)) fail("commander_damage", "must be an object");
  const damage = {};
  for (const [from, row] of Object.entries(value)) {
    if (!isObject(row)) fail(`commander_damage.${from}`, "must be an object");
    damage[from] = {};
    for (const [to, amount] of Object.entries(row)) {
      if (typeof amount !== "number" || !Number.isFinite(amount)) {
        fail(`commander_damage.${from}.${to}`, "must be a number");
      }
      damage[from][to] = amount;
    }
  }
  return damage;
}

export function parseGameState(value) {
  if (!isObject(value)) fail("game_state", "must be an object");
  if (value.schema !== SCHEMA_ID) fail("schema", `must be ${SCHEMA_ID}`);
  if (value.format !== "commander") fail("format", "must be commander");
  if (!Array.isArray(value.players) || value.players.length === 0) fail("players", "must list the seats");
  const players = value.players.map((player, index) => parsePlayer(player, `players[${index}]`));
  const playerIds = new Set(players.map((player) => player.id));
  if (playerIds.size !== players.length) fail("players", "ids must be unique");
  if (!Array.isArray(value.objects)) fail("objects", "must be a list");
  const objects = value.objects.map((object, index) => parseObject(object, `objects[${index}]`, playerIds));
  const objectIds = new Set(objects.map((object) => object.id));
  if (objectIds.size !== objects.length) fail("objects", "ids must be unique");
  if (!Array.isArray(value.unknowns)) fail("unknowns", "must be a list");
  const unknowns = [];
  for (const kind of value.unknowns) {
    if (!UNKNOWN.has(kind)) fail("unknowns", `${String(kind)} is not a known gap`);
    if (!unknowns.includes(kind)) unknowns.push(kind);
  }
  let active = null;
  if (value.active_player != null) {
    active = asString(value.active_player, "active_player");
    if (!playerIds.has(active)) fail("active_player", "must be a player");
  }
  const state = {
    schema: SCHEMA_ID,
    format: "commander",
    players,
    objects,
    unknowns,
    active_player: active,
    phase: value.phase == null ? null : asString(value.phase, "phase"),
  };
  if (value.commander_damage !== undefined) state.commander_damage = parseDamage(value.commander_damage);
  return state;
}

export function emptyFocus() {
  return { selected_object_ids: [], auto_included_object_ids: [], reasons: {} };
}

export function createCandidate(input) {
  if (!isObject(input)) fail("candidate", "must be an object");
  const id = asString(input.id, "candidate.id");
  if (!id) fail("candidate.id", "must be set");
  const shape = asString(input.shape, "candidate.shape");
  if (!shape) fail("candidate.shape", "must be set");
  const headline = asString(input.headline, "candidate.headline");
  if (!headline) fail("candidate.headline", "must be set");
  if (typeof input.priority !== "number" || !Number.isFinite(input.priority)) {
    fail("candidate.priority", "must be a number");
  }
  if (!Array.isArray(input.needs_facts) || input.needs_facts.some((fact) => !UNKNOWN.has(fact))) {
    fail("candidate.needs_facts", "must be known gaps");
  }
  return {
    id,
    shape,
    headline,
    object_ids: asStringList(input.object_ids, "candidate.object_ids"),
    priority: input.priority,
    needs_facts: [...input.needs_facts],
  };
}

export function createClarification(input) {
  if (!isObject(input)) fail("clarification", "must be an object");
  const verdict = asString(input.verdict, "clarification.verdict");
  if (!VERDICT.has(verdict)) fail("clarification.verdict", "is not a verdict");
  const source = asString(input.source_tier, "clarification.source_tier");
  if (!TIER.has(source)) fail("clarification.source_tier", "is not a tier");
  if (typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1) {
    fail("clarification.confidence", "must be from 0 to 1");
  }
  const candidateId = asString(input.candidate_id, "clarification.candidate_id");
  const headline = asString(input.headline, "clarification.headline");
  const oneLiner = asString(input.one_liner, "clarification.one_liner");
  if (!candidateId || !headline || !oneLiner) fail("clarification", "needs a candidate, a headline, and one line");
  return {
    candidate_id: candidateId,
    verdict,
    headline,
    one_liner: oneLiner,
    citations: asStringList(input.citations, "clarification.citations"),
    depends_on: asStringList(input.depends_on, "clarification.depends_on"),
    confidence: input.confidence,
    source_tier: source,
  };
}
