import { useEffect, useState } from "react";
import { BoardView } from "./BoardView.jsx";
import { Seat } from "./Seat.jsx";
import { loadBoard, reduceBoard, replaceWithScan, saveBoard } from "./board.js";
import { SEATS, loadGame, reduce, saveGame } from "./game.js";

const ORDER = ["west", "north", "south", "east"];

function scanMessage(error) {
  if (error?.message === "Failed to fetch") {
    return "The scan service is not running. Start it on the laptop, or load the staged board.";
  }
  return error?.message || "The scan did not finish.";
}

export default function App() {
  const [game, setGame] = useState(() => loadGame());
  const [board, setBoard] = useState(() => loadBoard());
  const [boardOpen, setBoardOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [viewKey, setViewKey] = useState(0);
  const [resetArmed, setResetArmed] = useState(false);

  const commanders = Object.fromEntries(SEATS.map((seat) => [seat, game.seats[seat].commander]));
  const seatNames = Object.fromEntries(SEATS.map((seat) => [seat, game.seats[seat].name]));

  useEffect(() => {
    saveGame(game);
  }, [game]);

  useEffect(() => {
    saveBoard(board);
  }, [board]);

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

  function sendBoard(action) {
    setBoard((current) => reduceBoard(current, action));
  }

  async function scanFile(file) {
    setScanning(true);
    setScanError("");
    setBoardOpen(true);
    try {
      const body = new FormData();
      body.append("image", file);
      const response = await fetch("/api/scan", { method: "POST", body });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.detail;
        throw new Error(typeof detail === "string" ? detail : "The scan did not finish.");
      }
      setBoard((current) => replaceWithScan(current, payload, { commanders }));
      setViewKey((key) => key + 1);
    } catch (error) {
      setScanError(scanMessage(error));
    } finally {
      setScanning(false);
    }
  }

  async function loadStaged() {
    setScanning(true);
    setScanError("");
    setBoardOpen(true);
    try {
      const response = await fetch("/staged-scan.json");
      if (!response.ok) throw new Error("The staged board is missing.");
      const payload = await response.json();
      setBoard((current) => replaceWithScan(current, payload, { commanders }));
      setViewKey((key) => key + 1);
    } catch (error) {
      setScanError(scanMessage(error));
    } finally {
      setScanning(false);
    }
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
      {!boardOpen && (
        <button type="button" className="board-launch" onClick={() => setBoardOpen(true)}>
          Board
        </button>
      )}
      {boardOpen && (
        <BoardView
          key={viewKey}
          board={board}
          seatNames={seatNames}
          commanders={commanders}
          scanning={scanning}
          error={scanError}
          onClose={() => setBoardOpen(false)}
          onScan={scanFile}
          onStaged={loadStaged}
          onRotatePhoto={(direction) => sendBoard({ type: "rotate", direction, commanders })}
          send={sendBoard}
        />
      )}
      <p className="sr">
        Four seats. South is upright, north is upside down, east and west face the side
        edges. Commander damage on a row is damage your commander has dealt to that seat.
        {SEATS.join(", ")}
      </p>
    </main>
  );
}
