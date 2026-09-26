import { useEffect, useState } from "react";
import { Seat } from "./Seat.jsx";
import { loadGame, reduce, saveGame } from "./game.js";

const ORDER = ["west", "north", "south", "east"];
const FACES_LEFT = new Set(["west", "south"]);

export default function App() {
  const [game, setGame] = useState(() => loadGame());
  const [resetAsk, setResetAsk] = useState(null);

  useEffect(() => {
    saveGame(game);
  }, [game]);

  useEffect(() => {
    let lock = null;
    let stopped = false;

    async function stayAwake() {
      if (stopped || !navigator.wakeLock) return;
      if (lock && !lock.released) return;
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        lock = null;
      }
    }

    stayAwake();
    const onVisible = () => {
      if (document.visibilityState === "visible") stayAwake();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", stayAwake);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", stayAwake);
      lock?.release();
    };
  }, []);

  function send(action) {
    setGame((current) => reduce(current, action));
  }

  const choosing = !game.turnStart;

  return (
    <main className="table">
      {ORDER.map((seat) => (
        <Seat
          key={seat}
          seat={seat}
          game={game}
          choosing={choosing}
          canUndo={game.past.length > 0}
          send={send}
          onFirst={() => send({ type: "first", seat })}
          onReset={() => setResetAsk(seat)}
        />
      ))}
      {resetAsk && (
        <div className="scrim">
          <div
            className={`confirm ${FACES_LEFT.has(resetAsk) ? "left" : "right"}`}
            role="dialog"
            aria-label="Reset the game"
          >
            <p>Are you sure you want to reset the game?</p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setResetAsk(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setResetAsk(null);
                  send({ type: "reset" });
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
