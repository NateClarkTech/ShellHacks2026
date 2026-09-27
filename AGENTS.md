# Commander table

`src/schema/gs.v1.js` is the contract for clarifications. GameState, FocusSet, Candidate, and ResolvedClarification stay stable. A new detector is a new file under `src/candidates/shapes/`. It does not change these types.

The screen shows Oracle text, official rulings, and later tap-to-choose rows. A free-text ruling is not the main path.

The life counter (`src/game.js`) and the board (`src/board.js`, `src/vision.js`) stay the table. `projectTable` reads them. Do not import `server/vision` into the candidate or resolver layers, and do not put card-box math in those layers.

After **Read these cards**, `POST /api/clarify` asks Grok (`grok-4.7` at `https://api.x.ai/v1/responses`) with the game state. `XAI_API_KEY` stays on the server. Selecting a card does not call the model. `src/resolver/template.js` is only the fallback when that call does not answer. Do not add interaction pairs to the template table. A clarification must not name a card outside the GameState plus the Oracle text of those cards.

This table loads an unknown name from `GET /api/card`. Samples stay on `fixtures/cards/catalog.json`. Oracle tags are the collision signal; `src/candidates/muted-tags.json` drops a tag UUID. Do not print tag slugs.

Seat ids are `seat1` through `seat4`, clockwise from the top-left. Keys stay in `env.local`. Do not download or embed the full Comprehensive Rules for this feature.
