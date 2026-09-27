# Commander table

A phone in the middle of a Commander pod, held in portrait. Two players sit on the left edge and two on the right. The corners are Seat 1 through Seat 4, clockwise from the top-left. Tap the player who goes first. That order is marked 1st through 4th, clockwise from them.

Each seat shows a name, a commander, and a life total. Tap the life total to type it. Poison and commander damage are behind Counters. A seat is marked at 0 life, 10 poison, or 21 commander damage from one opponent. Hold +1 or −1 to keep counting. Reset asks for a confirm in the center of the screen. After the first tap, the screen stays awake while the page is open.

The table is saved in this browser. The ruling slip is not in this build.

## Board

Open the board and tap Scan. Pick the player, then the zone. Battlefield, Graveyard, Exile, and Command are the choices. Hold the phone about a hand-span up and add another photo if the board does not fit. The laptop finds the cards locally, sends Azure one image of title strips, and calls CardSight only for the titles it could not read. A name both readers share is accepted. A name only one reader is confident about is a guess. A token asks for one tap. If the readers disagree, pick the card. The staged board is still the overhead sample, and on that sample seat, zone, and stack order are guesses until Accept. The stack lists the top first. Resolve drafts a graveyard for that spell and still waits for Accept.

Staged loads a cached scan with no keys and no network. A live photo uses the API on this laptop. Put `CARDSIGHT_API_KEY`, `AZURE_VISION_KEY`, and `AZURE_VISION_ENDPOINT` in `.env.local`. The phone only talks to this page.

```bash
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
```

`npm run dev` loads `.env.local`, starts the API on port 8000, and starts the page. The page proxies `/api` to that port. Stop the page and the API stops with it. The first title scan downloads the Scryfall card-name catalog into `server/data/`.

```bash
npm install
npm test
npm run dev
```

`npm run dev` listens on the LAN. Open the Network URL on the phone and lay it in the center of the table.
