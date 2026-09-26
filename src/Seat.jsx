import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SEAT_ACCENT, SEATS, clockwiseFrom, isDefaultName, lethalReasons, seatOrderName, turnLabel } from "./game.js";

function Field({
  value,
  placeholder,
  label,
  onCommit,
  onCancel,
  className,
  maxLength = 24,
  inputMode,
  autoOpen = false,
}) {
  const [editing, setEditing] = useState(autoOpen);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);
  const barRef = useRef(null);

  useEffect(() => {
    if (!editing) return undefined;
    const input = inputRef.current;
    input?.focus();
    const fit = () => {
      if (!input || !input.clientWidth) return;
      let size = inputMode === "numeric" ? 72 : 64;
      input.style.fontSize = `${size}px`;
      while (size > 20 && input.scrollWidth > input.clientWidth + 1) {
        size -= 1;
        input.style.fontSize = `${size}px`;
      }
    };
    const pin = () => {
      const viewport = window.visualViewport;
      const shell = barRef.current;
      if (shell && viewport) shell.style.top = `${viewport.offsetTop}px`;
      fit();
    };
    pin();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", pin);
    viewport?.addEventListener("scroll", pin);
    return () => {
      viewport?.removeEventListener("resize", pin);
      viewport?.removeEventListener("scroll", pin);
    };
  }, [editing, draft, inputMode]);

  function commit() {
    setEditing(false);
    onCommit(draft);
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
    onCancel?.();
  }

  return (
    <>
      {!autoOpen && (
        <button
          type="button"
          className={`field ${className ?? ""}`}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          {value || placeholder}
        </button>
      )}
      {editing &&
        createPortal(
          <div ref={barRef} className="type-scrim">
            <form
              className="type-card"
              onSubmit={(event) => {
                event.preventDefault();
                commit();
              }}
            >
              <p className="type-label">{label}</p>
              <input
                ref={inputRef}
                aria-label={label}
                value={draft}
                placeholder={placeholder}
                maxLength={maxLength}
                inputMode={inputMode}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancel();
                  }
                }}
              />
              <div className="type-actions">
                <button type="button" onClick={cancel}>
                  Cancel
                </button>
                <button type="submit">Done</button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

function HoldButton({ delta, onDelta, children, ...rest }) {
  const timers = useRef([]);
  const held = useRef(false);
  const fromPointer = useRef(false);

  function stop() {
    for (const id of timers.current) {
      clearTimeout(id);
      clearInterval(id);
    }
    timers.current = [];
  }

  return (
    <button
      type="button"
      className="stepper"
      {...rest}
      onContextMenu={(event) => event.preventDefault()}
      onTouchStart={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        fromPointer.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        held.current = false;
        stop();
        const wait = setTimeout(() => {
          held.current = true;
          onDelta(delta);
          const loop = setInterval(() => onDelta(delta), 70);
          timers.current.push(loop);
        }, 280);
        timers.current.push(wait);
      }}
      onPointerUp={() => {
        const wasHeld = held.current;
        stop();
        held.current = false;
        if (!wasHeld) onDelta(delta);
      }}
      onPointerCancel={() => {
        stop();
        held.current = false;
      }}
      onClick={() => {
        if (fromPointer.current) {
          fromPointer.current = false;
          return;
        }
        onDelta(delta);
      }}
    >
      <span className="stepper-glyph">{children}</span>
    </button>
  );
}

function Track({ label, value, hint, hot, onDelta, className }) {
  return (
    <div className={`track${hot ? " hot" : ""}${className ? ` ${className}` : ""}`}>
      <span className="track-label">{label}</span>
      <HoldButton delta={-1} onDelta={onDelta} aria-label={`${hint} minus 1`}>
        −
      </HoldButton>
      <span className="track-value">{value}</span>
      <HoldButton delta={1} onDelta={onDelta} aria-label={`${hint} plus 1`}>
        +
      </HoldButton>
    </div>
  );
}

function AddCounter({ seat, send }) {
  const [adding, setAdding] = useState(false);
  if (adding) {
    return (
      <Field
        autoOpen
        value=""
        placeholder="Energy, experience…"
        label="New counter"
        onCommit={(name) => {
          setAdding(false);
          if (name.trim()) send({ type: "add-counter", seat, name });
        }}
        onCancel={() => setAdding(false)}
      />
    );
  }
  return (
    <button type="button" className="add-counter" onClick={() => setAdding(true)}>
      Add counter
    </button>
  );
}

const REASON_TEXT = {
  life: "0 life",
  poison: "10 poison",
  commander: "21 commander",
};

export function Seat({ seat, game, choosing, canUndo, send, onFirst, onReset }) {
  const [open, setOpen] = useState(false);
  const player = game.seats[seat];

  useEffect(() => {
    if (!game.turnStart) setOpen(false);
  }, [game.turnStart]);
  const reasons = lethalReasons(game, seat);
  const dealers = SEATS.filter((from) => {
    if ((game.damage?.[from]?.[seat] ?? 0) >= 21) return true;
    return Boolean(game.partners?.[from]) && (game.partnerDamage?.[from]?.[seat] ?? 0) >= 21;
  });
  const customName = player.name && !isDefaultName(player.name) ? player.name : "";
  const shownName = customName || seatOrderName(seat);
  const turn = turnLabel(game.turnStart, seat);
  const partnerOn = Boolean(game.partners?.[seat]);
  const people = clockwiseFrom(seat);

  function personName(id) {
    const name = id === seat ? player.name : game.seats[id].name;
    if (name && !isDefaultName(name)) return name;
    return seatOrderName(id);
  }

  function commanderSources() {
    if (!reasons.includes("commander")) return [];
    const sources = [];
    for (const from of dealers) {
      const owner = game.seats[from];
      const who = owner.name && !isDefaultName(owner.name) ? owner.name : seatOrderName(from);
      if ((game.damage?.[from]?.[seat] ?? 0) >= 21) {
        sources.push(owner.commander ? `${owner.commander} (${who})` : who);
      }
      if (owner && game.partners?.[from] && (game.partnerDamage?.[from]?.[seat] ?? 0) >= 21) {
        sources.push(owner.partnerName ? `${owner.partnerName} (${who})` : `${who}'s partner`);
      }
    }
    return sources.length > 0 ? [`21 commander from ${sources.join(", ")}`] : ["21 commander"];
  }

  return (
    <div
      className={`cell${reasons.length > 0 ? " lethal" : ""}${choosing ? " choose" : ""}`}
      data-seat={seat}
      style={{ "--accent": SEAT_ACCENT[seat] }}
      onClick={choosing ? onFirst : undefined}
    >
      <div className="rotator">
        <section className="panel" aria-label={shownName || "Open seat"}>
          {reasons.length > 0 && (
            <p className="banner">
              {reasons
                .filter((reason) => reason !== "commander")
                .map((reason) => REASON_TEXT[reason])
                .concat(commanderSources())
                .join(" · ")}
            </p>
          )}
          <header className="who">
            <Field
              className="seat-name"
              value={customName}
              placeholder={seatOrderName(seat)}
              label="Player name"
              onCommit={(name) => send({ type: "name", seat, name })}
            />
            {turn && <p className="turn-mark">{turn}</p>}
            <Field
              className="commander"
              value={player.commander}
              placeholder="Commander"
              label="Commander"
              maxLength={48}
              onCommit={(commander) => send({ type: "commander", seat, commander })}
            />
          </header>

          <div className="life">
            <Field
              className="life-num"
              value={String(player.life)}
              placeholder="40"
              label={`${shownName || "Seat"} life total`}
              maxLength={4}
              inputMode="numeric"
              onCommit={(raw) => send({ type: "set-life", seat, life: raw })}
            />
          </div>

          <div className="life-pad">
            {[-1, 1].map((delta) => (
              <HoldButton
                key={delta}
                delta={delta}
                aria-label={`${shownName || "Seat"} life ${delta > 0 ? "plus" : "minus"} 1`}
                onDelta={(amount) => send({ type: "life", seat, delta: amount })}
              >
                {delta > 0 ? "+1" : "−1"}
              </HoldButton>
            ))}
          </div>

          <footer className="tools">
            <button type="button" onClick={() => setOpen(true)}>
              Counters
            </button>
            <button type="button" disabled={!canUndo} onClick={() => send({ type: "undo" })}>
              Undo
            </button>
            <button type="button" onClick={onReset}>
              Reset
            </button>
          </footer>

          {choosing && (
            <div className="choose-face">
              <p className="choose-title">Tap</p>
              <p className="choose-sub">if you go first</p>
            </div>
          )}

          {open && (
            <div className="sheet" role="dialog" aria-label="Counters">
              <div className="sheet-head">
                <p>Counters</p>
                <button type="button" onClick={() => setOpen(false)}>
                  Done
                </button>
              </div>
              <div className="sheet-body">
                <button
                  type="button"
                  className={`switch${partnerOn ? " on" : ""}`}
                  role="switch"
                  aria-checked={partnerOn}
                  onClick={() => send({ type: "partner", seat, on: !partnerOn })}
                >
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-knob" />
                  </span>
                  Partner commanders
                </button>
                {partnerOn && (
                  <Field
                    className="partner-name"
                    value={player.partnerName ?? ""}
                    placeholder="Tap to name your partner"
                    label="Partner commander"
                    maxLength={48}
                    onCommit={(partnerName) => send({ type: "partner-name", seat, partnerName })}
                  />
                )}
                <p className="dealt-label">Commander damage dealt to</p>
                {people.map((id) => {
                  const name = personName(id);
                  const primary = partnerOn
                    ? `${name} · ${player.commander || "Commander"}`
                    : name;
                  return (
                    <div className="damage-group" key={id}>
                      <Track
                        label={primary}
                        value={game.damage?.[seat]?.[id] ?? 0}
                        hot={(game.damage?.[seat]?.[id] ?? 0) >= 21}
                        hint={`Commander damage dealt to ${name}`}
                        onDelta={(delta) => send({ type: "damage", from: seat, to: id, delta })}
                      />
                      {partnerOn && (
                        <Track
                          label={`${name} · ${player.partnerName || "Partner"}`}
                          value={game.partnerDamage?.[seat]?.[id] ?? 0}
                          hot={(game.partnerDamage?.[seat]?.[id] ?? 0) >= 21}
                          hint={`Partner damage dealt to ${name}`}
                          onDelta={(delta) =>
                            send({ type: "damage", from: seat, to: id, delta, which: "b" })
                          }
                        />
                      )}
                    </div>
                  );
                })}
                <Track
                  className="after-damage"
                  label="Poison"
                  value={player.poison}
                  hot={player.poison >= 10}
                  hint={`${shownName || "Seat"} poison`}
                  onDelta={(delta) => send({ type: "poison", seat, delta })}
                />
                <p className="dealt-label">Other counters</p>
                {(game.extras?.[seat] ?? []).map((item) => (
                  <div className="extra" key={item.id}>
                    <Track
                      label={item.name}
                      value={item.value}
                      hint={item.name}
                      onDelta={(delta) => send({ type: "counter", seat, id: item.id, delta })}
                    />
                    <button
                      type="button"
                      className="remove"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => send({ type: "remove-counter", seat, id: item.id })}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <AddCounter seat={seat} send={send} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
