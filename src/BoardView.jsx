import { useRef, useState } from "react";
import { SEATS } from "./game.js";
import { ZONE_LABEL, ZONES } from "./board.js";
import { sameCard } from "./vision.js";

const SEAT_ORDER = ["south", "north", "west", "east"];
const ZONE_ORDER = ["command", "battlefield", "graveyard", "exile", "library", "hand"];
const SCAN_ZONES = ["battlefield", "graveyard", "exile", "command"];
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
    card.identity === "confirm"
      ? "Confirm"
      : card.identity === "agreed"
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
  const needsConfirm = card.identity === "confirm";
  const acceptedAsIs =
    card.placement === "accepted" && !needsConfirm && card.identity !== "choose" && same;
  const label = !card.name
    ? "Use this card"
    : needsConfirm && same
      ? "Confirm"
      : acceptedAsIs
        ? "Accepted"
        : same
          ? "Accept guess"
          : "Accept change";
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

function ScanWizard({ scan, seatNames }) {
  const cameraRef = useRef(null);
  const fileRef = useRef(null);
  const modeRef = useRef("add");
  if (!scan?.step) return null;

  function openPicker(mode, source) {
    modeRef.current = mode;
    const input = source === "file" ? fileRef.current : cameraRef.current;
    input?.click();
  }

  function take(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) scan.onCapture(file, modeRef.current);
  }

  const who = seatNames[scan.seat] || scan.seat;
  const where = ZONE_LABEL[scan.zone];

  return (
    <section className="scan-panel board-scan" aria-label="Scan">
      {scan.step === "player" && (
        <>
          <p className="scan-note">Which player is this photo of?</p>
          <div className="choice-row">
            {SEAT_ORDER.map((seat) => (
              <button key={seat} type="button" disabled={scan.busy} onClick={() => scan.onSeat(seat)}>
                {seatNames[seat] || seat}
              </button>
            ))}
          </div>
        </>
      )}
      {scan.step === "zone" && (
        <>
          <p className="scan-note">{who}. Which zone?</p>
          <div className="choice-row">
            {SCAN_ZONES.map((zone) => (
              <button key={zone} type="button" disabled={scan.busy} onClick={() => scan.onZone(zone)}>
                {ZONE_LABEL[zone]}
              </button>
            ))}
          </div>
          <button type="button" disabled={scan.busy} onClick={scan.onBack}>
            Change player
          </button>
        </>
      )}
      {scan.step === "shoot" && (
        <>
          <p className="scan-note">
            {scan.note || `${who} · ${where}. Hold the phone a hand-span up, so the titles are readable.`}
          </p>
          {scan.pending ? (
            <div className="scan-actions">
              <button type="button" disabled={scan.busy} onClick={scan.onReplace}>
                Replace last
              </button>
              <button type="button" disabled={scan.busy} onClick={scan.onKeep}>
                Keep both
              </button>
            </div>
          ) : (
            <div className="scan-actions">
              <button type="button" disabled={scan.busy} onClick={() => openPicker("add", "camera")}>
                {scan.busy ? "Reading…" : scan.started ? "Add photo" : "Camera"}
              </button>
              <button type="button" disabled={scan.busy} onClick={() => openPicker("add", "file")}>
                Upload
              </button>
              <button type="button" disabled={scan.busy || !scan.started} onClick={() => openPicker("retake", "camera")}>
                Retake
              </button>
              <button type="button" disabled={scan.busy || !scan.started} onClick={() => openPicker("retake", "file")}>
                Reupload
              </button>
            </div>
          )}
          <button type="button" disabled={scan.busy} onClick={scan.onBack}>
            Change zone
          </button>
          <input
            ref={cameraRef}
            className="file-clip"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={take}
          />
          <input ref={fileRef} className="file-clip" type="file" accept="image/*" onChange={take} />
        </>
      )}
      <button type="button" disabled={scan.busy} onClick={scan.onDone}>
        {scan.added ? "Done" : "Cancel"}
      </button>
    </section>
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
  onStaged,
  onRotatePhoto,
  send,
  scan,
}) {
  const [facing, setFacing] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adding, setAdding] = useState("");
  const [addSeat, setAddSeat] = useState("south");

  function open(card, nextDraft) {
    setSelectedId(card.id);
    setDraft(nextDraft ?? { name: card.name, controller: card.controller, zone: card.zone });
  }

  const pending = board.cards.filter(
    (card) => (card.identity === "choose" && !card.name) || card.identity === "confirm",
  );
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
          <button type="button" disabled={scanning || Boolean(scan?.step)} onClick={scan?.onStart}>
            Scan
          </button>
          <button type="button" disabled={scanning || Boolean(scan?.step)} onClick={onStaged}>
            {scanning ? "Reading…" : "Staged"}
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
      </header>
      {(error || board.warnings.length > 0) && (
        <p className="board-warn">{error || board.warnings.join(" ")}</p>
      )}
      <ScanWizard scan={scan} seatNames={seatNames} />
      <div className="board-rotator" data-facing={facing}>
        <div className="board-facing">
          {board.cards.length === 0 && !scanning && (
            <p className="board-empty">
              Tap Scan. Pick the player, then the zone, then take or upload a close photo. Agreed
              names stay on that player. A disagreement asks you to pick. Or load the staged board.
            </p>
          )}
          {scanning && <p className="board-empty">Reading the table…</p>}
          {board.cards.length > 0 && (
            <p className="board-limit">
              Face-down libraries, cards under other cards, which aura is on which creature, and
              counters are not in the photo.
            </p>
          )}
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
