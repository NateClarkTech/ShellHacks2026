import { useEffect, useRef, useState } from "react";
import { SEAT_ACCENT, lethalReasons, opponentsOf } from "./game.js";

function Field({ value, placeholder, label, onCommit, className }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    onCommit(draft);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={className}
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        maxLength={className === "commander" ? 48 : 24}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
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
  );
}

function HoldButton({ delta, onDelta, children, ...rest }) {
  const timers = useRef([]);
  const held = useRef(false);

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
      {...rest}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        stop();
        const wait = setTimeout(() => {
          held.current = true;
          onDelta(delta);
          const loop = setInterval(() => onDelta(delta), 70);
          timers.current.push(loop);
        }, 280);
        timers.current.push(wait);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        onDelta(delta);
      }}
    >
      {children}
    </button>
  );
}

function Track({ label, value, hint, hot, onDelta }) {
  return (
    <div className={`track${hot ? " hot" : ""}`}>
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

const REASON_TEXT = {
  life: "0 life",
  poison: "10 poison",
  commander: "21 commander",
};

export function Seat({ seat, game, canUndo, resetArmed, send }) {
  const player = game.seats[seat];
  const reasons = lethalReasons(game, seat);
  const dealers = opponentsOf(seat).filter(
    (from) => (game.damage[from]?.[seat] ?? 0) >= 21,
  );

  const incoming = opponentsOf(seat)
    .map((from) => ({
      name: game.seats[from].name || from,
      amount: game.damage[from][seat] ?? 0,
    }))
    .filter((row) => row.amount > 0);

  const dealt = opponentsOf(seat).map((to) => ({
    id: to,
    name: game.seats[to].name || to,
    amount: game.damage[seat][to] ?? 0,
  }));
  return (
    <div
      className={`cell${reasons.length > 0 ? " lethal" : ""}`}
      data-seat={seat}
      style={{ "--accent": SEAT_ACCENT[seat] }}
    >
      <div className="rotator">
        <section className="panel" aria-label={`${player.name || seat} seat`}>
          <header className="who">
            <Field
              className="seat-name"
              value={player.name}
              placeholder={seat}
              label={`${seat} player name`}
              onCommit={(name) => send({ type: "name", seat, name })}
            />
            <Field
              className="commander"
              value={player.commander}
              placeholder="Commander"
              label={`${seat} commander`}
              onCommit={(commander) => send({ type: "commander", seat, commander })}
            />
          </header>

          <div className="life">
            {reasons.length > 0 && (
              <p className="banner">
                {reasons.map((reason) => REASON_TEXT[reason]).join(" · ")}
                {dealers.length > 0 &&
                  ` from ${dealers.map((from) => game.seats[from].name || from).join(", ")}`}
              </p>
            )}
            <div className="life-num" data-life={player.life}>
              {player.life}
            </div>
          </div>

          <div className="life-pad">
            {[-5, -1, 1, 5].map((delta) => (
              <HoldButton
                key={delta}
                delta={delta}
                aria-label={`${player.name || seat} life ${delta > 0 ? "plus" : "minus"} ${Math.abs(delta)}`}
                onDelta={(amount) => send({ type: "life", seat, delta: amount })}
              >
                {delta > 0 ? `+${delta}` : delta}
              </HoldButton>
            ))}
          </div>

          <div className="tracks">
            <Track
              label="Poison"
              value={player.poison}
              hot={player.poison >= 10}
              hint={`${player.name || seat} poison`}
              onDelta={(delta) => send({ type: "poison", seat, delta })}
            />
            <p className="dealt-label">Dealt to</p>
            {dealt.map((opponent) => (
              <Track
                key={opponent.id}
                label={opponent.name}
                value={opponent.amount}
                hot={opponent.amount >= 21}
                hint={`Commander damage to ${opponent.name}`}
                onDelta={(delta) =>
                  send({ type: "damage", from: seat, to: opponent.id, delta })
                }
              />
            ))}
            {incoming.length > 0 && (
              <p className="incoming">
                From {incoming.map((row) => `${row.name} ${row.amount}`).join(" · ")}
              </p>
            )}
          </div>

          <footer className="tools">
            <button type="button" disabled={!canUndo} onClick={() => send({ type: "undo" })}>
              Undo
            </button>
            <button
              type="button"
              className={resetArmed ? "armed" : ""}
              onClick={() => send({ type: "reset" })}
            >
              {resetArmed ? "Confirm" : "Reset"}
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}
