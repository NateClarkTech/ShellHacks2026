import { useEffect, useRef, useState } from "react";
import { ClarifyPanel, OracleDisclosure } from "./ClarifyPanel.jsx";
import { SEATS, seatOrderName } from "./game.js";
import { ZONE_LABEL, ZONES } from "./board.js";
import { scanView } from "./scanProgress.js";
import { sameCard } from "./vision.js";

const ZONE_ORDER = ["command", "battlefield", "graveyard", "exile", "library", "hand"];
const SCAN_ZONES = ["battlefield", "graveyard", "exile", "command"];
// Each photo turn moves the bottom edge clockwise: seat 4, seat 1, seat 2, seat 3.
const BOTTOM_EDGE = ["seat4", "seat1", "seat2", "seat3"];

function sourceLabel(sources) {
  const parts = [];
  if (sources?.includes("cardsight")) parts.push("CardSight");
  if (sources?.includes("ocr")) parts.push("title scan");
  if (parts.length === 0) return "";
  return parts.join(" · ");
}

function playerName(seat, seatNames) {
  return seatNames[seat] || seatOrderName(seat);
}

function rowMeta(card, seatNames) {
  const who = card.controller ? playerName(card.controller, seatNames) : "No seat";
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
  const pose = [card.tapped ? "Tapped" : "", card.stacked ? "Stacked" : ""].filter(Boolean);
  return [kind, who, ZONE_LABEL[card.zone], ...pose].join(" · ");
}

function NameField({ label, value, onChange, placeholder, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const request = useRef(0);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) return undefined;
    const id = request.current + 1;
    request.current = id;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
        if (!response.ok) return;
        const body = await response.json();
        if (request.current === id) setOptions(Array.isArray(body.suggestions) ? body.suggestions : []);
      } catch {
        if (request.current === id) setOptions([]);
      }
    }, 160);
    return () => clearTimeout(timer);
  }, [value]);

  function choose(option) {
    onChange({ name: option.name, detail: option.detail || "" });
    setOpen(false);
  }

  return (
    <div className="card-name-field">
      {label && <span>{label}</span>}
      <input
        aria-label={ariaLabel || label || "Card name"}
        placeholder={placeholder}
        value={value}
        maxLength={80}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChange({ name: event.target.value, detail: "" });
          setOpen(true);
        }}
      />
      {open && value.trim().length >= 2 && options.length > 0 && (
        <div className="suggest" role="listbox">
          {options.map((option) => (
            <button
              key={`${option.name}|${option.detail}`}
              type="button"
              role="option"
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
            >
              <span className="suggest-name">{option.name}</span>
              {option.detail && <span className="card-meta">{option.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Editor({ card, draft, setDraft, commanders, seatNames, send }) {
  const same =
    draft.name === card.name &&
    draft.controller === card.controller &&
    draft.zone === card.zone &&
    Boolean(draft.tapped) === Boolean(card.tapped);
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

  function pickName(name, detail = "") {
    setDraft((current) => {
      const commander = commanders[current.controller];
      const zone =
        current.zone === "library" && commander && sameCard(name, commander) ? "command" : current.zone;
      const kept = detail || (sameCard(name, current.name) ? current.detail : "");
      return { ...current, name, detail: kept || "", zone };
    });
  }

  return (
    <div className="card-edit">
      {typeof card.image === "string" && card.image.startsWith("data:image/") && (
        <img className="card-crop" src={card.image} alt={card.name ? `${card.name} from the photo` : "Card from the photo"} />
      )}
      <NameField
        label="Name"
        ariaLabel="Card name"
        value={draft.name ?? ""}
        onChange={({ name, detail }) => pickName(name, detail)}
      />
      {card.note && !(draft.name && (
        card.note === "The read was uncertain. Pick the card."
        || card.note === "The two readers disagree. Pick the card."
      )) && <p>{card.note}</p>}
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
        <button
          type="button"
          className={draft.tapped ? "on" : ""}
          onClick={() => setDraft((current) => ({ ...current, tapped: !current.tapped }))}
        >
          {draft.tapped ? "Tapped" : "Untapped"}
        </button>
      </div>
      <div className="choice-row">
        {SEATS.map((seat) => (
          <button
            key={seat}
            type="button"
            className={draft.controller === seat ? "on" : ""}
            onClick={() => setDraft((current) => ({ ...current, controller: seat }))}
          >
            {playerName(seat, seatNames)}
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
              detail: draft.detail ?? "",
              tapped: Boolean(draft.tapped),
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

function ScanMeter({ progress }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, []);
  const view = scanView(progress, now);
  const pct = Math.round(view.fraction * 100);
  return (
    <div className="scan-meter">
      <div
        className="scan-meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Scan progress"
      >
        <div className="scan-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="scan-meter-time">{view.label}</p>
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

  const who = scan.seat ? playerName(scan.seat, seatNames) : "";
  const where = ZONE_LABEL[scan.zone];

  return (
    <section className="scan-panel board-scan" aria-label="Scan">
      {scan.step === "player" && (
        <>
          <p className="scan-note">Which player is this photo of?</p>
          <div className="choice-row">
            {SEATS.map((seat) => (
              <button key={seat} type="button" disabled={scan.busy} onClick={() => scan.onSeat(seat)}>
                {playerName(seat, seatNames)}
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
          {scan.busy && <ScanMeter progress={scan.progress} />}
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

function CardRow({ card, seatNames, selected, extra, onOpen, children }) {
  return (
    <div className="card-block">
      <button
        type="button"
        className={selected ? "card-row on" : "card-row"}
        onClick={onOpen}
      >
        <span className="card-name">{card.name || "Unidentified"}</span>
        {card.detail && <span className="card-meta">{card.detail}</span>}
        <span className="card-meta">{rowMeta(card, seatNames)}</span>
      </button>
      {(selected || extra) && children}
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
  send,
  scan,
  clarifyOn = false,
  session = null,
  onClarifyToggle = () => {},
  onSample = () => {},
  onUseTable = () => {},
  onToggleFocus = () => {},
}) {
  const [facing, setFacing] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adding, setAdding] = useState("");
  const [addingDetail, setAddingDetail] = useState("");
  const [addSeat, setAddSeat] = useState(SEATS[0]);
  const [hintId, setHintId] = useState(null);
  const askingTable = clarifyOn && session?.source === "table";
  const [clarifySeen, setClarifySeen] = useState(clarifyOn);
  if (clarifySeen !== clarifyOn) {
    setClarifySeen(clarifyOn);
    if (clarifyOn) {
      setSelectedId(null);
      setDraft(null);
      setHintId(null);
    }
  }

  function open(card, nextDraft) {
    if (!nextDraft && card.id === selectedId) {
      setSelectedId(null);
      setDraft(null);
      return;
    }
    setSelectedId(card.id);
    setDraft({
      name: card.name,
      controller: card.controller,
      zone: card.zone,
      detail: card.detail ?? "",
      tapped: Boolean(card.tapped),
      ...nextDraft,
    });
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
  const seats = SEATS.map((seat) => ({
    seat,
    zones: ZONE_ORDER.map((zone) => ({
      zone,
      cards: placed.filter((card) => card.controller === seat && card.zone === zone),
    })).filter((group) => group.cards.length > 0),
  })).filter((group) => group.zones.length > 0);

  function renderCard(card) {
    const named = Boolean(card.name) && card.identity !== "confirm";
    const inFocus = askingTable && session.focus.selected_object_ids.includes(card.id);
    return (
      <CardRow
        key={card.id}
        card={card}
        seatNames={seatNames}
        selected={askingTable ? inFocus : card.id === selectedId}
        extra={askingTable && hintId === card.id && !named}
        onOpen={() => {
          if (!clarifyOn) {
            setHintId(null);
            open(card);
            return;
          }
          if (!askingTable || !named) {
            setHintId(card.id);
            return;
          }
          setHintId(null);
          onToggleFocus(card.id);
        }}
      >
        {askingTable && hintId === card.id && !named && (
          <p className="board-limit">Name this card before asking about it.</p>
        )}
        {askingTable && inFocus && named && <OracleDisclosure name={card.name} />}
        {!clarifyOn && draft && card.id === selectedId && (
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
        <div className="board-actions">
          <button
            type="button"
            className={clarifyOn ? "on" : ""}
            aria-pressed={clarifyOn}
            onClick={onClarifyToggle}
          >
            Clarify
          </button>
          <button type="button" disabled={scanning || Boolean(scan?.step)} onClick={scan?.onStart}>
            Scan
          </button>
          <button type="button" disabled={scanning || Boolean(scan?.step)} onClick={onStaged}>
            {scanning ? "Reading…" : "Staged"}
          </button>
          <button type="button" onClick={() => setFacing((current) => (current + 1) % 4)}>
            Face
            <span className="board-action-sub">{playerName(BOTTOM_EDGE[facing], seatNames)}</span>
          </button>
          <button type="button" disabled={board.past.length === 0} onClick={() => send({ type: "undo" })}>
            Undo
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      {(error || board.warnings.length > 0) && (
        <p className="board-warn">{error || board.warnings.join(" ")}</p>
      )}
      <ScanWizard scan={scan} seatNames={seatNames} />
      <div className="board-rotator" data-facing={facing}>
        <div className="board-facing">
          {clarifyOn && session && (
            <ClarifyPanel
              session={session}
              seatNames={seatNames}
              onSample={onSample}
              onUseTable={onUseTable}
              onToggleFocus={onToggleFocus}
            />
          )}
          {board.cards.length === 0 && !scanning && (
            <p className="board-empty">
              Tap Scan. Pick the player, then the zone, then take or upload a close photo. Agreed
              names stay on that player. A disagreement asks you to pick. Or load the staged board.
            </p>
          )}
          {scanning && !scan?.step && <ScanMeter progress={scan?.progress} />}
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
              <h2>{playerName(group.seat, seatNames)}</h2>
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
              send({ type: "add", name, detail: addingDetail, controller: addSeat, zone: "battlefield" });
              setAdding("");
              setAddingDetail("");
            }}
          >
            <NameField
              ariaLabel="Add a card by name"
              placeholder="Add a card by name"
              value={adding}
              onChange={({ name, detail }) => {
                setAdding(name);
                setAddingDetail(detail);
              }}
            />
            <div className="choice-row">
              {SEATS.map((seat) => (
                <button
                  key={seat}
                  type="button"
                  className={addSeat === seat ? "on" : ""}
                  onClick={() => setAddSeat(seat)}
                >
                  {playerName(seat, seatNames)}
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
