import type { MoveRec } from "./types";
import { BADGE, type Badge } from "./types";
import { fmtEval, moveLabel } from "./format";

interface Props {
  rec: MoveRec;
  playerColor: "white" | "black";
  coachText: string | null;
  showBetter: boolean;
  inLine: boolean;
  onToggleBetter: () => void;
  onStartLine: (kind: "actual" | "better") => void;
  onDrill: () => void;
}

export default function KeyCard({
  rec, playerColor, coachText, showBetter, inLine, onToggleBetter, onStartLine, onDrill,
}: Props) {
  const badge = rec.badge ? BADGE[rec.badge] : null;
  const bad = !rec.byEngine && (rec.badge === "mistake" || rec.badge === "blunder");

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
      {!rec.byEngine && rec.bestSan && rec.bestUci !== rec.uci && !bad && (
        <p className="kc-best">Better was <b>{rec.bestSan}</b>.</p>
      )}
      {(bad || (showBetter && rec.bestPv.length > 0)) && (
        <div className="kc-actions">
          {rec.bestSan && rec.bestPv.length > 0 && (
            <button onClick={onToggleBetter}>
              {showBetter ? "Back to the game" : "See the better move"}
            </button>
          )}
          {bad && !inLine && <button className="accent" onClick={onDrill}>Try it yourself</button>}
        </div>
      )}
      {!rec.byEngine && rec.pvSan.length > 1 && !showBetter && (
        <button className="kc-line-btn" onClick={() => onStartLine("actual")}>
          Step through the engine line
        </button>
      )}
      {showBetter && rec.bestPvSan.length > 1 && (
        <button className="kc-line-btn" onClick={() => onStartLine("better")}>
          Step through the best line
        </button>
      )}
    </div>
  );
}
