import type { MoveRec } from "./types";
import { BADGE, type Badge } from "./types";
import { fmtEval, moveLabel } from "./format";

interface Props {
  rec: MoveRec;
  playerColor: "white" | "black";
  coachText: string | null;
  inLine: boolean;
  minimal?: boolean; // browsing an unreviewed game: no engine judgment shown
  onStartLine: (kind: "actual" | "better") => void;
  onDrill: () => void;
}

export default function KeyCard({
  rec, playerColor, coachText, inLine, minimal, onStartLine, onDrill,
}: Props) {
  const badge = rec.badge ? BADGE[rec.badge] : null;
  if (minimal) {
    return (
      <div className="keycard">
        <div className="kc-head">
          <span className="kc-move">{moveLabel(rec)}</span>
          <span className="kc-who">{rec.byEngine ? "Stockfish" : "You"}</span>
          {rec.evalCp != null && (
            <span className="kc-eval">{fmtEval(rec.evalCp, playerColor)}</span>
          )}
        </div>
        <p className="kc-best">Browse freely — run a Review for grades and best moves.</p>
      </div>
    );
  }
  const bad = !rec.byEngine && (rec.badge === "mistake" || rec.badge === "blunder");
  const hasBetter = !rec.byEngine && !!rec.bestSan && rec.bestUci !== rec.uci && rec.bestPv.length > 0;

  return (
    <div className="keycard">
      <div className="kc-head">
        <span className="kc-move">{moveLabel(rec)}</span>
        <span className="kc-who">{rec.byEngine ? "Stockfish" : "You"}</span>
        {badge && (
          <span className="pill-badge" style={{ color: badge.color, borderColor: badge.color + "66" }}>
            {badge.label}
          </span>
        )}
        {rec.evalCp != null && (
          <span className="kc-eval">{fmtEval(rec.evalCp, playerColor)}</span>
        )}
      </div>
      {rec.reason && <p className="kc-reason">{rec.reason}</p>}
      {coachText && <p className="kc-coach">{coachText}</p>}
      {hasBetter && !bad && (
        <p className="kc-best">Better was <b>{rec.bestSan}</b>.</p>
      )}
      {(hasBetter || (bad && rec.pvSan.length > 0)) && !inLine && (
        <div className="kc-actions">
          {hasBetter && (
            <button onClick={() => onStartLine("better")}>
              {bad ? "See the better line" : "See the better move"}
            </button>
          )}
          {bad && <button className="accent" onClick={onDrill}>Try it yourself</button>}
        </div>
      )}
      {!inLine && !rec.byEngine && rec.pvSan.length > 1 && (
        <button className="kc-line-btn" onClick={() => onStartLine("actual")}>
          Step through the expected line
        </button>
      )}
    </div>
  );
}
