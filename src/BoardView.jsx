import { useRef, useState } from "react";
import { SEATS } from "./game.js";
import { ZONE_LABEL, ZONES } from "./board.js";
import { sameCard } from "./vision.js";

const SEAT_ORDER = ["south", "north", "west", "east"];
const ZONE_ORDER = ["command", "battlefield", "graveyard", "exile", "library", "hand"];
const EDGE = ["South", "West", "North", "East"];

function sourceLabel(sources) {
  const parts = [];
  if (sources?.includes("cardsight")) parts.push("CardSight");
  if (sources?.includes("ocr")) parts.push("title scan");
  if (parts.length === 0) return "";
  return parts.join(" · ");
}

function rowMeta(card, seatNames) {
  const who = card.controller ? seatNames[card.controller] || card.controller : "No seat";
  const kind =
    card.identity === "agreed"
      ? "Agreed"
      : card.identity === "choose"
        ? "Pick"
        : card.placement === "accepted"
          ? "Accepted"
          : "Guess";
  return `${kind} · ${who} · ${ZONE_LABEL[card.zone]}`;
}

function Editor({ card, draft, setDraft, commanders, seatNames, send }) {
  const same =
    draft.name === card.name &&
    draft.controller === card.controller &&
    draft.zone === card.zone;
  const acceptedAsIs = card.placement === "accepted" && same;
  const label = !card.name ? "Use this card" : acceptedAsIs ? "Accepted" : same ? "Accept guess" : "Accept change";
  const resolving = card.zone === "stack" && draft.zone !== "stack";

  function pickName(name) {
    setDraft((current) => {
      const commander = commanders[current.controller];
      const zone =
        current.zone === "library" && commander && sameCard(name, commander) ? "command" : current.zone;
      return { ...current, name, zone };
    });
  }

  return (
    <div className="card-edit">
      <p>{card.note}</p>
      <p>{card.reason}</p>
      {sourceLabel(card.sources) && <p className="card-src">{sourceLabel(card.sources)}</p>}
      {resolving && (
        <p>
          Spells usually go to the graveyard. A permanent that resolves enters the battlefield.
          A countered spell may be exiled. Accept the zone you want.
        </p>
      )}
      {card.candidates.length > 0 && (
        <div className="choice-row">
          {card.candidates.map((candidate) => (
            <button
              key={candidate.name}
              type="button"
              className={draft.name && sameCard(draft.name, candidate.name) ? "on" : ""}
              onClick={() => pickName(candidate.name)}
            >
              {candidate.name}
              <span className="pct">{Math.round(candidate.confidence * 100)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="choice-row">
        {SEATS.map((seat) => (
          <button
            key={seat}
            type="button"
            className={draft.controller === seat ? "on" : ""}
            onClick={() => setDraft((current) => ({ ...current, controller: seat }))}
          >
            {seatNames[seat] || seat}
          </button>
        ))}
      </div>
      <div className="choice-row">
        {ZONES.map((zone) => (
          <button
            key={zone}
            type="button"
            className={draft.zone === zone ? "on" : ""}
            onClick={() => setDraft((current) => ({ ...current, zone }))}
          >
            {ZONE_LABEL[zone]}
          </button>
        ))}
      </div>
      {card.zone === "stack" && draft.zone === "stack" && (
        <div className="choice-row">
          <button type="button" onClick={() => send({ type: "stack-move", id: card.id, direction: 1 })}>
            Toward top
          </button>
          <button type="button" onClick={() => send({ type: "stack-move", id: card.id, direction: -1 })}>
            Toward bottom
          </button>
        </div>
      )}
      <div className="choice-row">
        <button
          type="button"
          className="accept"
          disabled={!draft.name || acceptedAsIs}
          onClick={() =>
            send({
              type: "apply",
              id: card.id,
              name: draft.name,
              controller: draft.controller,
              zone: draft.zone,
            })
          }
        >
          {label}
        </button>
        <button type="button" onClick={() => send({ type: "remove", id: card.id })}>
          Remove
        </button>
      </div>
    </div>
  );
}

function CardRow({ card, seatNames, selected, onOpen, children }) {
  return (
    <div className="card-block">
      <button
        type="button"
        className={selected ? "card-row on" : "card-row"}
        onClick={onOpen}
      >
        <span className="card-name">{card.name || "Unidentified"}</span>
        <span className="card-meta">{rowMeta(card, seatNames)}</span>
      </button>
      {selected && children}
    </div>
  );
}

export function BoardView({
  board,
  seatNames,
  commanders,
  scanning,
  error,
  onClose,
  onScan,
  onStaged,
  onRotatePhoto,
  send,
}) {
  const [facing, setFacing] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adding, setAdding] = useState("");
  const [addSeat, setAddSeat] = useState("south");
  const cameraRef = useRef(null);
  const photoRef = useRef(null);

  function open(card, nextDraft) {
    setSelectedId(card.id);
    setDraft(nextDraft ?? { name: card.name, controller: card.controller, zone: card.zone });
  }

  function take(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onScan(file);
  }

  const pending = board.cards.filter((card) => card.identity === "choose" && !card.name);
  const pendingIds = new Set(pending.map((card) => card.id));
  const placed = board.cards.filter((card) => !pendingIds.has(card.id));
  const stack = placed
    .filter((card) => card.zone === "stack")
    .sort((a, b) => b.stackIndex - a.stackIndex);
  const loose = placed.filter((card) => card.zone !== "stack" && !card.controller);
  const seats = SEAT_ORDER.map((seat) => ({
    seat,
    zones: ZONE_ORDER.map((zone) => ({
      zone,
      cards: placed.filter((card) => card.controller === seat && card.zone === zone),
    })).filter((group) => group.cards.length > 0),
  })).filter((group) => group.zones.length > 0);

  function renderCard(card) {
    return (
      <CardRow
        key={card.id}
        card={card}
        seatNames={seatNames}
        selected={card.id === selectedId}
        onOpen={() => open(card)}
      >
        {draft && card.id === selectedId && (
          <Editor
            card={card}
            draft={draft}
            setDraft={setDraft}
            commanders={commanders}
            seatNames={seatNames}
            send={send}
          />
        )}
      </CardRow>
    );
  }

  return (
    <section className="board-sheet" aria-label="Board">
      <header className="board-bar">
        <strong>Board</strong>
        <div className="board-tools">
          <button type="button" disabled={scanning} onClick={onStaged}>
            Staged
          </button>
          <button type="button" disabled={scanning} onClick={() => cameraRef.current?.click()}>
            {scanning ? "Reading…" : "Camera"}
          </button>
          <button type="button" disabled={scanning} onClick={() => photoRef.current?.click()}>
            Photo
          </button>
          <button type="button" onClick={() => setFacing((current) => (current + 1) % 4)}>
            Face {EDGE[facing]}
          </button>
          <button type="button" onClick={() => onRotatePhoto(1)}>
            Bottom edge: {EDGE[board.orientation]}
          </button>
        </div>
        <button type="button" disabled={board.past.length === 0} onClick={() => send({ type: "undo" })}>
          Undo
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
        <input ref={cameraRef} className="file-clip" type="file" accept="image/*" capture="environment" onChange={take} />
        <input ref={photoRef} className="file-clip" type="file" accept="image/*" onChange={take} />
      </header>
      {(error || board.warnings.length > 0) && (
        <p className="board-warn">{error || board.warnings.join(" ")}</p>
      )}
      <div className="board-rotator" data-facing={facing}>
        <div className="board-facing">
          {board.cards.length === 0 && !scanning && (
            <p className="board-empty">
              Take a photo of the table, or load the staged board. Agreed names are kept. A
              disagreement asks you to pick. Seat, zone, and stack order stay guesses until Accept.
            </p>
          )}
          {scanning && <p className="board-empty">Reading the table…</p>}
          {pending.length > 0 && (
            <section className="board-section">
              <h2>Needs a name</h2>
              {pending.map(renderCard)}
            </section>
          )}
          {stack.length > 0 && (
            <section className="board-section">
              <h2>Stack · top resolves first</h2>
              <button
                type="button"
                disabled={!stack[0]?.name}
                onClick={() =>
                  open(stack[0], {
                    name: stack[0].name,
                    controller: stack[0].controller,
                    zone: "graveyard",
                  })
                }
              >
                Resolve top
              </button>
              {stack.map(renderCard)}
            </section>
          )}
          {seats.map((group) => (
            <section key={group.seat} className="board-section">
              <h2>{seatNames[group.seat] || group.seat}</h2>
              {group.zones.map((zoneGroup) => (
                <div key={zoneGroup.zone}>
                  <h3>{ZONE_LABEL[zoneGroup.zone]}</h3>
                  {zoneGroup.cards.map(renderCard)}
                </div>
              ))}
            </section>
          ))}
          {loose.length > 0 && (
            <section className="board-section">
              <h2>No seat</h2>
              {loose.map(renderCard)}
            </section>
          )}
          <form
            className="add-card"
            onSubmit={(event) => {
              event.preventDefault();
              const name = adding.trim();
              if (!name) return;
              send({ type: "add", name, controller: addSeat, zone: "battlefield" });
              setAdding("");
            }}
          >
            <input
              aria-label="Add a card by name"
              placeholder="Add a card by name"
              value={adding}
              maxLength={80}
              onChange={(event) => setAdding(event.target.value)}
            />
            <div className="choice-row">
              {SEATS.map((seat) => (
                <button
                  key={seat}
                  type="button"
                  className={addSeat === seat ? "on" : ""}
                  onClick={() => setAddSeat(seat)}
                >
                  {seatNames[seat] || seat}
                </button>
              ))}
              <button type="submit">Add</button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
