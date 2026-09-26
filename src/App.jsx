import { useEffect, useState } from "react";
import { BoardView } from "./BoardView.jsx";
import { Seat } from "./Seat.jsx";
import { ZONE_LABEL, appendScan, lastPhotoId, loadBoard, reduceBoard, replaceWithScan, saveBoard } from "./board.js";
import { SEATS, loadGame, reduce, saveGame } from "./game.js";
import { assembleScan, duplicateShare } from "./vision.js";

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
  const [scanStep, setScanStep] = useState(null);
  const [scanSeat, setScanSeat] = useState(null);
  const [scanZone, setScanZone] = useState(null);
  const [scanNote, setScanNote] = useState("");
  const [scanStarted, setScanStarted] = useState(false);
  const [pendingDup, setPendingDup] = useState(null);
  const [sessionId] = useState(() => globalThis.crypto?.randomUUID?.() ?? `scan-${Date.now()}`);
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

  function startScan() {
    setScanStep("player");
    setScanSeat(null);
    setScanZone(null);
    setScanNote("");
    setScanStarted(false);
    setPendingDup(null);
    setScanError("");
  }

  function chooseScanSeat(seat) {
    setScanSeat(seat);
    setScanZone(null);
    setScanStep("zone");
    setPendingDup(null);
    setScanNote("");
  }

  function chooseScanZone(zone) {
    setScanZone(zone);
    setScanStep("shoot");
    setPendingDup(null);
    setScanNote("");
  }

  function scanBack() {
    setPendingDup(null);
    setScanNote("");
    if (scanStep === "shoot") {
      setScanZone(null);
      setScanStep("zone");
      return;
    }
    setScanSeat(null);
    setScanStep("player");
  }

  function doneScan() {
    setScanStep(null);
    setPendingDup(null);
    setScanNote("");
  }

  function closeBoard() {
    setBoardOpen(false);
    doneScan();
  }

  function commitScan(payload, replacePhotoId) {
    setBoard((current) =>
      appendScan(current, payload, {
        controller: scanSeat,
        zone: scanZone,
        mode: replacePhotoId ? "retake" : "add",
        replacePhotoId,
        commanders,
      }),
    );
    setScanStarted(true);
    setPendingDup(null);
  }

  async function captureScan(file, mode) {
    if (!scanSeat || !scanZone || !file) return;
    setScanning(true);
    setScanError("");
    setScanNote("Reading…");
    setPendingDup(null);
    try {
      const body = new FormData();
      body.append("image", file);
      body.append("controller", scanSeat);
      body.append("zone", scanZone);
      body.append("session", sessionId);
      body.append("mode", mode);
      const response = await fetch("/api/scan", { method: "POST", body });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.detail;
        throw new Error(typeof detail === "string" ? detail : "The scan did not finish.");
      }
      if (payload.replayed) {
        setScanNote("That photo was already added.");
        return;
      }
      if (payload.scene === "wide" || payload.scene === "empty") {
        setScanNote(payload.warnings?.[0] || "No cards found.");
        return;
      }
      const preview = assembleScan(payload, {
        controller: scanSeat,
        zone: scanZone,
        photoId: payload.photoId,
      });
      const review = preview.some(
        (card) => card.identity === "confirm" || (card.identity === "choose" && !card.name),
      );
      const who = seatNames[scanSeat] || scanSeat;
      const glare = payload.glare ? ` ${payload.glare} washed out.` : "";
      const summary = `${preview.length} on ${who} · ${ZONE_LABEL[scanZone]}.${glare}`;
      const previous = lastPhotoId(board, scanSeat, scanZone);
      const share = duplicateShare(
        board.cards
          .filter((card) => card.controller === scanSeat && card.zone === scanZone)
          .map((card) => card.name),
        preview.map((card) => card.name),
      );
      if (mode === "add" && previous && share >= 0.6) {
        setPendingDup({ payload, replacePhotoId: previous });
        setScanNote(`${summary} This looks like the last photo.`);
        return;
      }
      commitScan(payload, mode === "retake" ? previous : null);
      setScanNote(review ? `${summary} Confirm the rest on the board when you are done.` : summary);
    } catch (error) {
      const message = scanMessage(error);
      setScanNote(message);
      setScanError(message);
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
          onClose={closeBoard}
          onStaged={loadStaged}
          onRotatePhoto={(direction) => sendBoard({ type: "rotate", direction, commanders })}
          send={sendBoard}
          scan={{
            step: scanStep,
            seat: scanSeat,
            zone: scanZone,
            note: scanNote,
            busy: scanning,
            started: Boolean(scanSeat && scanZone && lastPhotoId(board, scanSeat, scanZone)),
            added: scanStarted,
            pending: Boolean(pendingDup),
            onStart: startScan,
            onSeat: chooseScanSeat,
            onZone: chooseScanZone,
            onBack: scanBack,
            onCapture: captureScan,
            onDone: doneScan,
            onReplace: () => {
              if (!pendingDup) return;
              commitScan(pendingDup.payload, pendingDup.replacePhotoId);
              setScanNote("Replaced the last photo.");
            },
            onKeep: () => {
              if (!pendingDup) return;
              commitScan(pendingDup.payload, null);
              setScanNote("Kept both photos.");
            },
          }}
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
