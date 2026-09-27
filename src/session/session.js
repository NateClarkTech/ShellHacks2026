import { fixtureSource, tableSource } from "../game-state/source.js";
import { SCHEMA_ID, emptyFocus } from "../schema/gs.v1.js";

export function createSession(game, board) {
  return sessionFromTable(game, board);
}

export function selectToggle(session, objectId) {
  const current = session.focus?.selected_object_ids ?? [];
  const selected = current.includes(objectId) ? current.filter((id) => id !== objectId) : [...current, objectId];
  return {
    ...session,
    schema: SCHEMA_ID,
    focus: { selected_object_ids: selected, auto_included_object_ids: [], reasons: {} },
    accepted_clarification_ids: session.accepted_clarification_ids ?? [],
  };
}

export function sessionFromFixture(fixture, fixtureId) {
  return {
    schema: SCHEMA_ID,
    game_state: fixtureSource(fixture).parse(),
    focus: emptyFocus(),
    accepted_clarification_ids: [],
    source: "fixture",
    fixture_id: fixtureId,
  };
}

export function sessionFromTable(game, board) {
  return {
    schema: SCHEMA_ID,
    game_state: tableSource(game, board).parse(),
    focus: emptyFocus(),
    accepted_clarification_ids: [],
    source: "table",
    fixture_id: null,
  };
}
