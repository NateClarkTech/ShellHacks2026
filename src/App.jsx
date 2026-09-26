import { useEffect, useState } from "react";
import { BoardView } from "./BoardView.jsx";
import { Seat } from "./Seat.jsx";
import { loadBoard, reduceBoard, replaceWithScan, saveBoard } from "./board.js";
import { SEATS, isDefaultName, loadGame, reduce, saveGame } from "./game.js";

const ORDER = ["seat1", "seat2", "seat4", "seat3"];
const FACES_LEFT = new Set(["seat1", "seat4"]);

function scanMessage(error) {
  if (error?.message === "Failed to fetch") {
    return "The scan service is not running. Start it on the laptop, or load the staged board.";
  }
  return error?.message || "The scan did not finish.";
}

export default function App() {
  const [game, setGame] = useState(() => loadGame());
  const [resetAsk, setResetAsk] = useState(null);
  const [board, setBoard] = useState(() => loadBoard());
  const [boardOpen, setBoardOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [viewKey, setViewKey] = useState(0);

  const commanders = Object.fromEntries(SEATS.map((seat) => [seat, game.seats[seat].commander]));
  const seatNames = Object.fromEntries(
    SEATS.map((seat) => {
      const name = game.seats[seat].name;
      return [seat, name && !isDefaultName(name) ? name : ""];
    }),
  );

  useEffect(() => {
    saveGame(game);
  }, [game]);

  useEffect(() => {
    saveBoard(board);
  }, [board]);

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
      {!boardOpen && !resetAsk && (
        <button type="button" className="board-launch" onClick={() => setBoardOpen(true)}>
          Board
        </button>
      )}
      {boardOpen && (
        <div className="scrim">
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
        </div>
      )}
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
