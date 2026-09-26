import { useEffect, useState } from "react";
import { Seat } from "./Seat.jsx";
import { SEATS, loadGame, reduce, saveGame } from "./game.js";

const ORDER = ["west", "north", "south", "east"];

export default function App() {
  const [game, setGame] = useState(() => loadGame());
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => {
    saveGame(game);
  }, [game]);

  useEffect(() => {
    if (!resetArmed) return undefined;
    const id = setTimeout(() => setResetArmed(false), 2500);
    return () => clearTimeout(id);
  }, [resetArmed]);

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
    if (action.type === "reset" && !resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    setGame((current) => reduce(current, action));
  }

  return (
    <main className="table">
      {ORDER.map((seat) => (
        <Seat
          key={seat}
          seat={seat}
          game={game}
          canUndo={game.past.length > 0}
          resetArmed={resetArmed}
          send={send}
        />
      ))}
      <p className="sr">
        Four seats. South is upright, north is upside down, east and west face the side
        edges. Commander damage on a row is damage your commander has dealt to that seat.
        {SEATS.join(", ")}
      </p>
    </main>
  );
}
