import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import type { MoveRec } from "./types";
import { BADGE } from "./types";

interface Props {
  moves: MoveRec[];
  activePly: number;
  onJump: (ply: number) => void;
  showGrades: boolean;
}

function Cell({ rec, active, onJump, showGrades }: { rec: MoveRec; active: boolean; onJump: (ply: number) => void; showGrades: boolean }) {
  const badge = rec.badge ? BADGE[rec.badge] : null;
  return (
    <button
      data-ply={rec.ply}
      className={"move" + (active ? " active" : "") + (rec.byEngine ? " engine" : "")}
      onClick={() => onJump(rec.ply)}
    >
      <span>{rec.san}</span>
      {badge && showGrades && (
        <span className="nag" style={{ color: badge.color }}>
          {badge.glyph}
        </span>
      )}
    </button>
  );
}

export default function MoveList({ moves, activePly, onJump, showGrades }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current?.querySelector(`[data-ply="${activePly}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activePly, moves.length]);

  const rows: ReactElement[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push(
      <div className="row" key={i}>
        <span className="num">{i / 2 + 1}</span>
        <Cell rec={moves[i]} active={activePly === i} onJump={onJump} showGrades={showGrades} />
        {moves[i + 1] ? (
          <Cell rec={moves[i + 1]} active={activePly === i + 1} onJump={onJump} showGrades={showGrades} />
        ) : (
          <span />
        )}
      </div>,
    );
  }
  return (
    <div className="movelist" ref={boxRef}>
      {rows.length ? rows : <p className="movelist-empty">Moves will appear here.</p>}
    </div>
  );
}
