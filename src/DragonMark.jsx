export function DragonMark({ arrive = false }) {
  return (
    <div className={`dragon-mark${arrive ? " is-arriving" : ""}`}>
      <span className="dragon-plate">
        <svg className="dragon-head" viewBox="6 2 64 50" aria-hidden="true">
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M17 48L15 39L16 30L11 23L8 14L15 9L24 18L30 13L34 4L42 6L48 14L56 18L63 23L67 28L66 33L58 35L47 37L60 41L57 47L47 48ZM34 21L41 28L50 23L43 19Z"
          />
        </svg>
      </span>
      <p className="dragon-edl">EDL</p>
    </div>
  );
}
