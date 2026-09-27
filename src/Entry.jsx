import { useEffect, useRef } from "react";
import { DragonMark } from "./DragonMark.jsx";

const WORDS = [
  ["Elder", "-50deg"],
  ["Dragon", "0deg"],
  ["Lawyer", "50deg"],
];

export function Entry({ showMark, onDone }) {
  const done = useRef(false);
  const onDoneRef = useRef(onDone);

  function finish(event) {
    if (event?.animationName && event.animationName !== "entry-fade") return;
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  }

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    const id = setTimeout(() => finish(), 2600);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      className="entry"
      onAnimationEnd={finish}
      onPointerDown={(event) => {
        event.preventDefault();
        finish();
      }}
    >
      <div className="entry-scrim" />
      <div className="entry-vortex" aria-hidden="true">
        {WORDS.map(([word, start]) => (
          <span key={word} className="entry-word" style={{ "--start": start }}>
            {word}
          </span>
        ))}
      </div>
      {showMark && (
        <div className="table-mark mark-arrive">
          <DragonMark arrive />
        </div>
      )}
      <button type="button" className="entry-skip" onClick={() => finish()}>
        Skip
      </button>
    </div>
  );
}
