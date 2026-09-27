import { useEffect, useState } from "react";
import { ZONE_LABEL } from "./board.js";
import { cachedCard, loadCard } from "./cards/load.js";
import { clarify } from "./candidates/engine.js";
import { seatOrderName } from "./game.js";
import { choicesFor, resolveChoice, resolveTemplate } from "./resolver/template.js";
import { SAMPLES } from "./session/fixtures.js";
import { normName } from "./vision.js";

const VERDICT = {
  applies: "Applies",
  does_not_apply: "Doesn't apply",
  depends: "Depends",
  unknown: "Not sure",
  legal: "Legal",
  illegal: "Illegal",
};

function who(controller, seatNames) {
  if (!controller) return "No seat";
  return seatNames[controller] || seatOrderName(controller);
}

function CardWriteup({ object, seatNames, record, status }) {
  const matched = record?.matched_name;
  const showMatch = matched && normName(matched) !== normName(object.name);
  return (
    <div className="clarify-card">
      <p className="card-name">{object.name}</p>
      <p className="card-meta">
        {who(object.controller, seatNames)} · {ZONE_LABEL[object.zone]}
      </p>
      {status === "loading" && <p>Looking up this card.</p>}
      {status === "down" && <p>The scan service is not running, so this card's text can't be loaded.</p>}
      {status === "missing" && <p>Scryfall has no card by that name.</p>}
      {status === "ready" && record && (
        <>
          {showMatch && <p>Scryfall read this as {matched}.</p>}
          <p className="oracle-text">{record.oracle_text}</p>
          {record.rulings?.length > 0 ? (
            <ul className="ruling-list">
              {record.rulings.map((ruling, index) => (
                <li key={`${ruling.published_at}-${index}`}>
                  <time dateTime={ruling.published_at}>{ruling.published_at}</time>
                  {ruling.comment}
                </li>
              ))}
            </ul>
          ) : (
            <p>No official ruling is in the local list.</p>
          )}
        </>
      )}
      {status === "ready" && !record && <p>The local list does not include this card.</p>}
    </div>
  );
}

export function ClarifyPanel({ session, seatNames, onSample, onUseTable, onToggleFocus }) {
  const selectedIds = new Set(session.focus.selected_object_ids);
  const selected = session.game_state.objects.filter((object) => selectedIds.has(object.id));
  const onTable = session.source === "table";
  const selectedKey = selected.map((object) => object.id).join("|");
  const selectedNames = selected.map((object) => object.name).join("|");
  const [remote, setRemote] = useState({});
  const [errors, setErrors] = useState({});
  const [pickKey, setPickKey] = useState(selectedKey);
  const [picks, setPicks] = useState({});
  if (pickKey !== selectedKey) {
    setPickKey(selectedKey);
    setPicks({});
  }

  useEffect(() => {
    if (!onTable) return undefined;
    let cancelled = false;
    for (const name of selectedNames.split("|").filter(Boolean)) {
      const key = normName(name);
      if (!key || cachedCard(name)) continue;
      loadCard(name)
        .then((card) => {
          if (cancelled) return;
          if (card?.missing) {
            setErrors((current) => (current[key] ? current : { ...current, [key]: "missing" }));
            return;
          }
          setRemote((current) => (current[key] ? current : { ...current, [key]: card }));
        })
        .catch(() => {
          if (!cancelled) setErrors((current) => (current[key] ? current : { ...current, [key]: "down" }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [onTable, selectedNames]);

  function statusFor(name) {
    if (!onTable || cachedCard(name)) return "ready";
    const key = normName(name);
    if (!key) return "missing";
    if (remote[key]) return "ready";
    if (errors[key] === "missing") return "missing";
    if (errors[key] === "down") return "down";
    return "loading";
  }

  function recordFor(name) {
    return cachedCard(name) ?? remote[normName(name)] ?? null;
  }

  const pending = onTable && selected.some((object) => statusFor(object.name) === "loading");
  const lookup = (name) => {
    const record = recordFor(name);
    return record?.missing ? null : record;
  };
  const local =
    selected.length >= 2 && !pending ? clarify(session.game_state, session.focus, lookup) : null;
  const focusKey = [...selected.map((object) => object.id)].sort().join("|");
  const [reading, setReading] = useState(false);
  const [modelRows, setModelRows] = useState(null);
  const [modelNote, setModelNote] = useState("");
  const [readKey, setReadKey] = useState("");
  if (readKey && readKey !== focusKey) {
    setReadKey("");
    setModelRows(null);
    setModelNote("");
    setReading(false);
  }

  async function readCards() {
    if (reading || selected.length < 2) return;
    const keyNow = focusKey;
    setReading(true);
    setModelNote("");
    setModelRows(null);
    try {
      const chosen = new Set([
        ...session.focus.selected_object_ids,
        ...(local?.focus.auto_included_object_ids ?? []),
      ]);
      const objects = session.game_state.objects.map((object) => {
        const record = recordFor(object.name);
        const item = {
          id: object.id,
          name: object.name,
          zone: object.zone,
          controller: object.controller,
          type_line: record?.type_line || "",
        };
        if (chosen.has(object.id)) {
          item.oracle_id = record?.oracle_id || object.oracle_id || null;
          item.oracle_text = record?.oracle_text || "";
          item.rulings = record?.rulings || [];
        }
        return item;
      });
      const response = await fetch("/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          game_state: {
            players: session.game_state.players,
            commander_damage: session.game_state.commander_damage,
            unknowns: session.game_state.unknowns,
            objects,
          },
          focus: {
            selected_object_ids: session.focus.selected_object_ids,
            auto_included_object_ids: local?.focus.auto_included_object_ids ?? [],
          },
        }),
      });
      const body = await response.json().catch(() => null);
      if (keyNow !== [...session.focus.selected_object_ids].sort().join("|")) return;
      if (!response.ok || !Array.isArray(body?.clarifications) || body.clarifications.length === 0) {
        setModelNote(body?.detail || "The model did not answer, so this is the short local read.");
        setReadKey(keyNow);
        return;
      }
      setModelRows(body.clarifications);
      setReadKey(keyNow);
    } catch {
      setModelNote("The model did not answer, so this is the short local read.");
      setReadKey(keyNow);
    } finally {
      setReading(false);
    }
  }

  const showLocal = Boolean(modelNote) && !reading && !modelRows;

  return (
    <section className="clarify-panel" aria-label="Clarify">
      <div className="choice-row">
        <button type="button" className={onTable ? "on" : ""} aria-pressed={onTable} onClick={onUseTable}>
          This table
        </button>
        {SAMPLES.map((sample) => (
          <button
            key={sample.id}
            type="button"
            className={session.fixture_id === sample.id ? "on" : ""}
            aria-pressed={session.fixture_id === sample.id}
            onClick={() => onSample(sample.id)}
          >
            {sample.label}
          </button>
        ))}
      </div>
      {onTable && session.game_state.objects.length === 0 && (
        <p>No cards on the table yet. Scan, load the staged board, or open a sample.</p>
      )}
      {!onTable && <p>Sample. The cards on the table stay as they are.</p>}
      {selected.length === 0 && <p>Select the cards in the argument.</p>}
      {!onTable &&
        session.game_state.objects.map((object) => (
          <button
            key={object.id}
            type="button"
            className={selectedIds.has(object.id) ? "card-row on" : "card-row"}
            aria-pressed={selectedIds.has(object.id)}
            onClick={() => onToggleFocus(object.id)}
          >
            <span className="card-name">{object.name}</span>
            <span className="card-meta">
              {who(object.controller, seatNames)} · {ZONE_LABEL[object.zone]}
            </span>
          </button>
        ))}
      <section className="board-section" aria-label="Clarifications">
        <h2>Clarifications</h2>
        {selected.length === 1 && <p className="board-limit">Select the cards in the argument.</p>}
        {selected.length >= 2 && pending && <p className="board-limit">Looking up the cards in the argument.</p>}
        {selected.length >= 2 && !pending && !modelRows && (
          <>
            <p className="board-limit">{selected.map((object) => object.name).join(", ")}</p>
            <button type="button" disabled={reading} onClick={readCards}>
              {reading ? "Reading these cards." : "Read these cards"}
            </button>
          </>
        )}
        {modelNote && <p className="board-limit">{modelNote}</p>}
        {modelRows && (
          <ul className="ruling-list">
            {modelRows.map((row) => {
              const picked = picks[row.candidate_id];
              const choice = (row.choices || []).find((item) => item.id === picked);
              return (
                <li key={row.candidate_id}>
                  <p className="card-name">{row.headline}</p>
                  <p>{choice?.one_liner || row.one_liner}</p>
                  <p className="card-meta">{VERDICT[row.verdict] ?? "Not sure"}</p>
                  {!picked && (row.choices || []).length > 0 && (
                    <div className="choice-row">
                      {row.choices.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setPicks((current) => ({ ...current, [row.candidate_id]: item.id }))}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {picked && (
                    <button
                      type="button"
                      onClick={() =>
                        setPicks((current) => {
                          const next = { ...current };
                          delete next[row.candidate_id];
                          return next;
                        })
                      }
                    >
                      Change
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {showLocal && local && local.candidates.length === 0 && (
          <p className="board-limit">Nothing in these cards raises one of the questions this table knows.</p>
        )}
        {showLocal && local && local.candidates.length > 0 && (
          <ul className="ruling-list">
            {local.candidates.map((candidate) => {
              const choices = choicesFor(session.game_state, candidate, lookup);
              const picked = picks[candidate.id];
              const answer = picked
                ? resolveChoice(session.game_state, candidate, lookup, picked)
                : resolveTemplate(session.game_state, local.focus, candidate, lookup);
              return (
                <li key={candidate.id}>
                  <p className="card-name">{answer?.headline || candidate.headline}</p>
                  {answer && <p>{answer.one_liner}</p>}
                  {answer && <p className="card-meta">{VERDICT[answer.verdict] ?? "Not sure"}</p>}
                  {choices.length > 0 && !picked && (
                    <div className="choice-row">
                      {choices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => setPicks((current) => ({ ...current, [candidate.id]: choice.id }))}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {picked && (
                    <button
                      type="button"
                      onClick={() =>
                        setPicks((current) => {
                          const next = { ...current };
                          delete next[candidate.id];
                          return next;
                        })
                      }
                    >
                      Change
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {selected.map((object) => (
        <CardWriteup
          key={object.id}
          object={object}
          seatNames={seatNames}
          record={recordFor(object.name)}
          status={statusFor(object.name)}
        />
      ))}
    </section>
  );
}
