# Commander table — ShellHacks Microsoft track

A phone lies in the middle of the table. The screen is four quadrants, one per seat, each rotated so that player reads upright. The quadrants are the life counter: life, commander damage, poison. A photo of the board becomes a shared board of recognized cards. A dispute starts by tapping cards on that board. A model trained this weekend proposes which interaction those cards are likely to be confused about. The table answers a few choices. A ruling slip comes back, and Apply can change a life total.

## Why this fits Microsoft

The missing thing is a Commander table that can see the cards in front of it. Life apps do not know the board. Rules lookups do not know which permanents are actually out. This app is the table first. The model is the step that turns a selected set of cards into a specific interaction and a cited slip.

The judged path never opens a chat window. Players tap cards, then tap choices the app generated from those cards. A single “describe it” field exists as a failsafe for boards the tags do not cover. The three-minute demo does not open that field. The core experience does not depend on it.

## The table

One phone, flat in the center. No accounts and no second device.

- 2×2 quadrants. South is upright. North is rotated 180°. East and west are rotated so each seat’s text and buttons face that player.
- Each quadrant: seat name, commander name, life starting at 40, poison, commander damage dealt to each of the other three seats, large plus and minus, undo, reset.
- Commander damage 21, poison 10, and life 0 mark that seat. The app does not run the rest of the rules engine by itself.
- Dispute is a button in every quadrant. The board and the slip open in the center, with a control to rotate that overlay toward the player who raised it. Life controls stay in the corners.

## Seeing the board

Each player taps Scan on their own quadrant. That tap is the seat. The other three quadrants stay on life. The zone chip defaults to Battlefield; Graveyard, Exile, and Command apply to the whole photo and are set before the shutter. Hold the phone about a hand-span up, so a dozen titles are readable. Add another photo for the rest of a wide board. Retake drops only the photo just added. Done puts the life pad back.

The laptop finds card rectangles locally, before any API call. A photo whose cards are too small (median long side under 200 pixels on the prepared image) returns “Move closer” and spends nothing. Azure Read gets one JPEG of title strips per photo, both short edges, and the name match picks the upright end. CardSight runs only on crops whose title is missing or under 0.75, at most 8 per photo, and it receives the warped card rather than the table. The same upload bytes are not sent twice.

Two Forests in one photo stay two cards. Nothing merges on the name or the artwork. An identical file is replayed from memory. A new photo whose names are mostly names already on that seat and zone asks Replace last photo or Keep both.

Seat and zone on a scanned card are final. A token-sheet name (Rat, Squirrel, Faerie, Clue, and the rest of that list) still asks for one tap. Agreed names do not. The staged board is still one overhead photo: CardSight and the title scan both read the whole frame, and seats are wedges from the center. A live table photo does not use that guess.

CardSight and a title scan both read a crop. Neither one knows the game. The page builds the board, and the table still corrects a name. Nothing about a name moves until Accept, except that the seat and zone came from the tap.

CardSight `POST https://api.cardsight.ai/v1/identify/card/mtg` takes the image as `image/jpeg` and the key in `X-API-Key`. The segment shortname is `mtg`, not `magic`. Magic is a live segment, 1993 through current sets. A detection is a tier, not a coordinate:

- High is 90–100%. The name is filled in. `card.suggestions` is omitted.
- Medium is 75–89%. Low is 50–74%. Those include other cards the model still considers, best first.
- There is no bounding box, so CardSight alone cannot put a card on a seat.
- It does not report tapped, counters, auras, tokens, zones, or controller.

mtgscan (fortierq/mtgscan) is the right idea and the wrong client to call. It OCRs with Azure Read, then fuzzy-matches the text to a card-name list. The boxes on those title lines are the only positions we get. The published client calls `/vision/v3.1/read/analyze`, and Computer Vision 3.1 retired on 13 September 2026. This app calls Read v3.2 and matches names against the Scryfall card-name catalog. mtgscan was built for a decklist photo. A table photo also contains rules text, rotated cards, and piles, so keyword lines (Flying, Instant, Creature) are dropped and lines that sit on the same card are collapsed to one title. The web demo at mtgscan.net is down. Do not depend on it.

The title scan owns each slot, because it has the box. CardSight names are matched onto those slots. A CardSight name with no slot stays unplaced.

- Both names are the same card, including either face of a double-faced name: accept it.
- The names differ, and each side lists the other as an alternative: do not pick. Show the candidates, higher confidence first.
- A one-way near-miss stays two cards, so a fuzzy accident does not hide a real card.
- Only one reader has a name. At or above 0.75, fill it and mark a guess. Below that, show the candidates and leave the name blank. CardSight High is 0.95, Medium 0.82, Low 0.62. An exact title is 1. A fuzzy title is the match ratio.
- If a reader errors or its key is missing, it abstains. The other reader still fills the board, and the warning is shown. `public/staged-scan.json` runs with no network.

Each card then has a controller (a seat, or none), a zone, and a stack index when the zone is the stack. Zones are battlefield, graveyard, exile, command, library, hand, and stack. The stack is one list. The highest index is the top and resolves first. Resolve drafts the graveyard for that card and still requires Accept, because a permanent enters and a countered spell may be exiled.

On the staged overhead photo, position is a guess. The bottom of the photo is South until someone turns that mapping. Seats are the four wedges from the center, so a card in the middle of an edge belongs to that seat. A scan from a seat does not use these wedges.

- Near the center: the stack, controller unknown. Order in the photo is only a guess.
- A seat's inner area: battlefield.
- Outer right: graveyard. Outer left: exile. Outer middle: library, top card only. If that name is the commander typed for the seat, command zone instead.
- No box: unplaced. The table picks the seat.

Select a card to draft a different name, controller, zone, or stack position, then Accept. Add a missing card by name. Remove a miss.

What a photo still does not contain: tapped or untapped, counters, which aura is on which creature, tokens with no printed name, cards under other cards, and which of two identical names entered first. Exile and graveyard look the same when the pile is not on the usual side. The guess says so.

## Tags

Download Scryfall’s Oracle Cards bulk file and the Oracle Tags bulk file once (https://scryfall.com/docs/api/bulk-data and https://scryfall.com/docs/api/tags). Join taggings to cards on `oracle_id`. Tags are community data from Tagger. Slugs change. Keep the tag UUID, and expect holes: many cards have no replacement-effect or layer tag.

Use tags to mark cards that can matter even when nobody tapped them: replacement effects, continuous effects that set or modify power and toughness, effects that remove abilities, trigger conditions. Also keep a small keyword fallback on oracle text for untagged cards: “instead” for replacement, “enters” for an enter-the-battlefield trigger, “as” / “this enters” for a replacement enter, characteristic-defining phrases for layer 7. The fallback is a lookup, not a second model.

## The model you train, and the limits

Train a classifier, not a rules engine. Input is a multi-hot vector of oracle-tag UUIDs for the cards the table selected, plus the same vector for other recognized cards that carry a replacement or layer tag. Output is a ranked list of interaction families: replacement effect, layer conflict, trigger order, state-based action, commander damage. scikit-learn logistic regression or gradient boosting is enough. About 40 to 80 hand-labeled rows: you pick the cards, record their tags, and label the family. Training is local and finishes in seconds. The demo can show the training set, the fit, and a live case where Humility plus an anthem ranks “layer conflict,” and two damage-replacers rank “replacement effect.”

Limits of that trained model:

- It only ranks a confusion you put in the label set. A family you never labeled will not be proposed.
- It only sees tags Tagger has, plus the small oracle-text fallback. An untagged permanent is invisible to it until someone adds the card and the fallback fires, or until someone uses the failsafe field.
- It does not know timestamps, dependencies, or whose turn it is. For a layer conflict it asks which effect is newer. It does not announce the layer order by itself.
- It does not see counters, zones, or targets. Those are choices on the next screen.
- Forty to eighty rows will overfit. That is acceptable if the pitch uses rows you checked by hand, and you say the model proposes the question rather than ruling the game.

Limits of training the kind of model that would read the Comprehensive Rules and answer like a judge:

- The xAI API serves inference (`grok-4.7` and the current models on https://docs.x.ai). It does not offer a fine-tuning job you can point at a corpus this weekend. A generative fine-tune means a local LoRA on an open model, via MLX on a Mac or a free GPU notebook.
- There is no dataset of full Commander boards paired with correct, cited rulings. Judge practice questions are prose. Turning them into board states, tag vectors, and checked answers is most of the weekend, and a few dozen of them will not teach the layer system.
- Layers (Comprehensive Rules 613) are a procedure over timestamps and dependencies. A small fine-tune imitates the wording of a ruling and invents rule numbers. At a table, a confident wrong rule number is worse than a slip that says to call a judge.
- You cannot evaluate it honestly before Sunday. A falling loss on the examples you wrote does not mean it is right on the next board.
- A laptop LoRA that does finish will still be weaker, on these questions, than one `grok-4.7` call constrained to the oracle text and a short rules excerpt. Spend the overnight on the classifier and the scripted disputes, not on that LoRA.

The slip itself is one server-side `grok-4.7` call. It may use only: oracle text of the selected cards, oracle text of the bystander cards the table agreed to include, the rules excerpt for the chosen family, and the choices the table tapped. It returns JSON: cards involved, what the table should do, rule numbers that appear in the excerpt, and an optional life change. If the excerpt does not cover the choice, the slip says to call a judge. Rule numbers that are not in the excerpt are rejected before the slip is shown.

The rules excerpts are short passages you type for the five families above, with the rule number on each passage. The full Comprehensive Rules do not go in the repo.

## Dispute flow

1. A player taps Dispute. The camera takes the board, or the staged photo loads.
2. The center shows every recognized card on its guessed seat. Players fix seats and names.
3. Players tap the cards in the fight. The classifier runs on that set. It also lists other recognized cards whose tags say they replace the same kind of event or sit in the same layer, and asks whether to include them. This is how a replacement effect or a Humility across the table enters the ruling without the players having to remember it.
4. The app shows choices built from those tags. Typical choices: what is happening (damage, a spell cast, a creature entering, a creature dying, a draw), which of the included cards is involved, and for a layer conflict which effect is newer. Players tap answers. They do not type the ruling.
5. The slip appears. If it includes a life change, Apply writes it through the same undo stack as the plus and minus buttons.
6. Failsafe: “Describe it” opens one text field, sends that sentence with the same card list and excerpts, and returns one slip. It does not start a thread. The pitch does not use this step.

## Demo script

About three minutes.

1. The phone is on the table. Four quadrants at 40, each facing a seat.
2. South’s commander hits North. From South’s upright controls, mark commander damage. North’s life drops. The damage from South to North reaches 21. North’s quadrant marks lethal commander damage.
3. Load the staged board: two damage-replacement effects, or Humility and an anthem. Confirm the names. If a seat or zone is wrong, select the card and accept the change.
4. Tap those cards. The trained model ranks replacement, or layer conflict. Accept the suggested bystander if one is shown. Tap the event, and for the layer case tap which effect is newer.
5. Read the slip: the cards, the rule number from the excerpt, the table action. Tap Apply if life changes. Tap Undo once.

## Build order

Friday night — quadrants only. Rotation, life, commander damage, poison, lethal marks, undo, reset. No camera and no model.

Saturday morning — one photo through CardSight and mtgscan. Merged board, drag between seats, add by name, staged photo cached. Download the Scryfall oracle-card and oracle-tag bulk files.

Saturday afternoon — label 40 to 80 rows and train the classifier. Include-bystander list. Choice screen for event and timestamp.

Saturday night — the slip endpoint, Apply, and the two scripted disputes (replacement, and a layer conflict). Reject any slip that cites a rule number outside the excerpt.

Sunday morning — phone brightness, rotation check from all four sides, staged photo on venue Wi-Fi. Leave the describe-it field in place and out of the script.

## Stack

- Frontend: one mobile page, Vite and React. Quadrant rotation is CSS. Scan is a file input with capture on the seat that tapped it, plus the staged image.
- Backend: FastAPI on the laptop. Holds the bulk-data indexes, the classifier, the rules excerpts, and the only model call.
- Keys, server-side only: `XAI_API_KEY`, `CARDSIGHT_API_KEY` sent as `X-API-Key`, `AZURE_VISION_KEY` and `AZURE_VISION_ENDPOINT` for the title scan (Read v3.2, not mtgscan's retired v3.1 client). Before writing the Grok call, read the current quickstart on https://docs.x.ai and use the model id on that page. `grok-4.7` is the current text model as of the docs checked for this plan.
- Classifier: scikit-learn, saved next to the training CSV so you can retrain on the spot if you add a row.

## What still breaks a live pod

A real Commander board does not fit in one top-down photo, and it does not fit in one close photo when cards touch or a title is foiled. Face-down libraries, cards under other cards, which aura is on which creature, and counters are not in the photo. The include-bystander step only finds cards the photos or the typed names already contain. The slip is a cited recommendation the table can apply or ignore, not a judge.
