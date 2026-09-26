# Commander table

A phone in the middle of a Commander pod. Four quadrants, one per seat. South reads upright, north is rotated 180°, and east and west face the side edges.

Each seat has life (start at 40), poison, and the commander damage that seat's commander has dealt to the other three. The rows under "Dealt to" are that damage. "From" lists damage coming in. A seat is marked at 0 life, 10 poison, or 21 commander damage from one opponent. Damage from two commanders is not added together. Hold a button to keep counting. Undo steps back one change. Reset asks for a second tap. After the first tap, the screen stays awake while the page is open.

The table is saved in this browser. The ruling slip is not in this build.

## Board

Open the board and tap Scan. Pick the player, then the zone. Battlefield, Graveyard, Exile, and Command are the choices. Hold the phone about a hand-span up and add another photo if the board does not fit. The laptop finds the cards locally, sends Azure one image of title strips, and calls CardSight only for the titles it could not read. A name both readers share is accepted. A name only one reader is confident about is a guess. A token asks for one tap. If the readers disagree, pick the card. The staged board is still the overhead sample, and on that sample seat, zone, and stack order are guesses until Accept. The stack lists the top first. Resolve drafts a graveyard for that spell and still waits for Accept.

Staged loads a cached scan with no keys and no network. A live photo needs the API process, with `CARDSIGHT_API_KEY`, `AZURE_VISION_KEY`, and `AZURE_VISION_ENDPOINT` on the laptop. The phone only talks to this page.

```bash
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
.venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8000
```

Run that beside `npm run dev`. The dev server proxies `/api` to port 8000. The first title scan downloads the Scryfall card-name catalog into `server/data/`.

```bash
npm install
npm test
npm run dev
```

`npm run dev` listens on the LAN. Open the Network URL on the phone and lay it in the center of the table.
