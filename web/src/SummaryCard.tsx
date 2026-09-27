import type { Summary } from "./types";
import { BADGE, REASON_LABEL, type Badge } from "./types";

interface Props {
  summary: Summary;
  onJump: (ply: number) => void;
}

const COUNT_ORDER: Badge[] = ["blunder", "mistake", "inaccuracy", "best", "excellent"];

export default function SummaryCard({ summary, onJump }: Props) {
  const counts = COUNT_ORDER.filter((b) => summary.counts[b]).map((b) => (
    <span key={b} className="count-pill" style={{ color: BADGE[b].color, borderColor: BADGE[b].color + "55" }}>
      {BADGE[b].glyph} {summary.counts[b]} {BADGE[b].label.toLowerCase()}
      {summary.counts[b] > 1 ? "s" : ""}
    </span>
  ));

  return (
    <div className="summary">
      <div className="sum-acc">
        <b>{summary.accuracy != null ? summary.accuracy.toFixed(1) : "—"}</b>
        <span>your accuracy</span>
      </div>
      <div className="sum-rest">
        {counts.length > 0 && <div className="sum-counts">{counts}</div>}
        {summary.patterns.length > 0 && (
          <div className="sum-patterns">
            {summary.patterns.slice(0, 3).map((p) => (
              <button key={p.key} onClick={() => onJump(p.firstPly)}>
                {REASON_LABEL[p.key] ?? p.key} ×{p.count}
              </button>
            ))}
          </div>
        )}
        {summary.worstPly != null && (
          <button className="sum-worst" onClick={() => onJump(summary.worstPly!)}>
            Jump to your worst move
          </button>
        )}
      </div>
    </div>
  );
}
