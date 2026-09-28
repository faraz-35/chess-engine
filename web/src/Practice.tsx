import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import Board from "./Board";
import { api, type PracticeItem } from "./api";
import { arrow, destsFromFen } from "./boardUtils";
import { sfx } from "./sound";
import { BADGE, REASON_LABEL, type Badge } from "./types";

const SOLVED_KEY = "practiceSolved";

function loadSolved(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SOLVED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function Practice({ orientation }: { orientation: "white" | "black" }) {
  const [items, setItems] = useState<PracticeItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [tries, setTries] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [solved, setSolved] = useState<string[]>(loadSolved);
  const [flash, setFlash] = useState<"good" | "bad" | null>(null);

  useEffect(() => {
    api.practice().then((list) => {
      setItems(list);
      setIndex(0);
    }).catch(() => setItems([]));
  }, []);

  const item = items?.[index] ?? null;

  const bestUci = useMemo(() => {
    if (!item?.bestSan) return null;
    try {
      const move = new Chess(item.fen).move(item.bestSan);
      return move ? `${move.from}${move.to}` : null;
    } catch {
      return null;
    }
  }, [item]);

  const markSolved = useCallback((fen: string) => {
    setSolved((prev) => {
      if (prev.includes(fen)) return prev;
      const next = [...prev, fen];
      localStorage.setItem(SOLVED_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const go = useCallback((next: number) => {
    setIndex(next);
    setTries(0);
    setMessage(null);
    setRevealed(false);
    setFlash(null);
  }, []);

  const advance = useCallback(() => {
    if (items && index < items.length - 1) go(index + 1);
    else setMessage("That was the last one. Play more games to feed the queue.");
  }, [items, index, go]);

  const play = useCallback(
    async (uci: string) => {
      if (!item || revealed) return;
      try {
        const result = await api.practiceCheck(item.fen, uci);
        if (result.correct) {
          sfx.win();
          setFlash("good");
          setMessage("Correct — that was the best move.");
          markSolved(item.fen);
          window.setTimeout(() => {
            setFlash(null);
            advance();
          }, 1100);
        } else {
          sfx.capture();
          setFlash("bad");
          window.setTimeout(() => setFlash(null), 450);
          setTries((t) => t + 1);
          const label = BADGE[(result.badge ?? "") as Badge]?.label ?? result.badge ?? "?";
          if (tries >= 1) {
            setRevealed(true);
            const best = result.bestSan ?? item.bestSan;
            setMessage(`Not it (${label}). Best was ${best} — shown in green.`);
          } else {
            setMessage(`Not it (${label}). Try again.`);
          }
        }
      } catch {
        setMessage("That move is not legal here.");
      }
    },
    [item, revealed, tries, advance, markSolved],
  );

  const arrows = useMemo(() => {
    return revealed && bestUci ? [arrow(bestUci, "best")] : [];
  }, [revealed, bestUci]);

  if (items == null) {
    return <div className="page"><p className="hint">Loading your mistakes…</p></div>;
  }
  if (items.length === 0) {
    return (
      <div className="page">
        <div className="card">
          <h1>Practice</h1>
          <p className="hint">
            Nothing to practice yet. Play a game — every mistake you make becomes a
            position to solve here.
          </p>
        </div>
      </div>
    );
  }

  const solvedCount = items.filter((it) => solved.includes(it.fen)).length;

  return (
    <div className="page practice">
      <div className="page-head">
        <div>
          <h1>Practice</h1>
          <p className="hint">
            Positions from your games where you went wrong. Find the best move — after
            two tries the answer appears.
          </p>
        </div>
        <span className="chip subtle">{solvedCount}/{items.length} solved</span>
      </div>
      <div className="practice-grid">
        <div className={"board-wrap" + (flash ? ` flash-${flash}` : "")}>
          {item && (
            <Board
              key={item.fen + tries}
              fen={item.fen}
              dests={destsFromFen(item.fen)}
              lastMove={null}
              orientation={orientation}
              check={false}
              arrows={arrows}
              onMove={play}
            />
          )}
          <div className="drill">
            <span>{message ?? "Your move — find the best move."}</span>
            <button
              onClick={() => {
                setRevealed(true);
                setMessage(item?.bestSan ? `Best was ${item.bestSan}.` : "Revealed on the board.");
                window.setTimeout(advance, 2200);
              }}
            >
              Skip
            </button>
          </div>
        </div>
        <aside className="panel">
          <span className="section-label">Queue · worst first</span>
          <div className="prac-list">
            {items.map((it, i) => (
              <button
                key={it.fen + it.ply}
                className={"prac-item" + (i === index ? " on" : "")}
                onClick={() => go(i)}
              >
                <span
                  className="nag"
                  style={{ color: BADGE[(it.badge ?? "mistake") as Badge]?.color }}
                >
                  {BADGE[(it.badge ?? "mistake") as Badge]?.glyph}
                </span>
                <span className="prac-what">
                  {REASON_LABEL[it.reasonKey ?? ""] ?? "Mistake"}
                  <em>{it.opening ?? "opening"}</em>
                </span>
                <span className="prac-meta">{it.date}</span>
                {solved.includes(it.fen) && <span className="prac-done">✓</span>}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
