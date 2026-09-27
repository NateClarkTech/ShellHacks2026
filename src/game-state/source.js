import { projectTable } from "./project.js";
import { parseGameState } from "../schema/gs.v1.js";

/** Live table. Reads the life counter and the board the scan already produced. */
export function tableSource(game, board) {
  return {
    kind: "table",
    parse() {
      return projectTable(game, board);
    },
  };
}

/** A committed sample. Raw scan JSON is a later adapter. */
export function fixtureSource(board) {
  const state = parseGameState(board);
  return {
    kind: "fixture",
    parse() {
      return state;
    },
  };
}
