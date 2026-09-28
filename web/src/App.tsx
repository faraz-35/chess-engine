import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import Board, { type Arrow } from "./Board";
import EvalBar from "./EvalBar";
import EvalGraph from "./EvalGraph";
import KeyCard from "./KeyCard";
import MoveList from "./MoveList";
import SummaryCard from "./SummaryCard";
import { api } from "./api";
import { fmtEval, moveLabel } from "./format";
import { sfx } from "./sound";
import { BADGE, ARROW_COLORS, type Badge, type GameState, type MoveRec } from "./types";

interface Drill {
  ply: number;
  fen: string;
  dests: Record<string, string[]>;
  tries: number;
  bestUci: string | null;
  message: string | null;
}

interface LineState {
  baseFen: string;
  uci: string[];
  san: string[];
  index: number;
  label: string;
}

const PRESETS: [number, string][] = [
  [3, "Beginner"],
  [6, "Casual"],
  [10, "Club"],
  [14, "Strong"],
  [20, "Maximum"],
];

const ELO_PRESETS: [number, string][] = [
  [800, "New"],
  [1000, "Learning"],
  [1150, "Your level"],
  [1400, "Club"],
  [1750, "Strong"],
  [2100, "Expert"],
];

function levelName(skill: number): string {
  if (skill <= 3) return "Beginner";
  if (skill <= 7) return "Casual";
  if (skill <= 12) return "Club";
  if (skill <= 16) return "Strong";
  return "Maximum";
}

function opponentLabel(s: { opponent: "stockfish" | "maia"; skill: number; elo: number }): string {
  return s.opponent === "maia" ? `Maia · ${s.elo}` : `Stockfish · Lv ${s.skill}`;
}

function linePosition(baseFen: string, uci: string[], index: number): { fen: string; last: [string, string] | null } {
  const game = new Chess(baseFen);
  const end = Math.min(index, uci.length - 1);
  for (let i = 0; i <= end; i++) {
    const u = uci[i];
    try {
      game.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
    } catch {
      break;
    }
  }
  const last = end >= 0 ? uci[end] : null;
  return { fen: game.fen(), last: last ? [last.slice(0, 2), last.slice(2, 4)] : null };
}

function arrow(uci: string, brush: string): Arrow {
  return { orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush };
}

function verdict(s: GameState): { text: string; tone: "win" | "lose" | "draw" } {
  if (s.resigned) return { text: "You resigned.", tone: "lose" };
  if (!s.result) return { text: "Game over.", tone: "draw" };
  if (s.result === "1/2-1/2") return { text: "Draw.", tone: "draw" };
  const won = (s.result === "1-0") === (s.playerColor === "white");
  return won ? { text: "You won.", tone: "win" } : { text: "You lost.", tone: "lose" };
}

function recSound(rec: MoveRec, on: boolean) {
  if (!on) return;
  if (rec.san.includes("#")) return;
  if (rec.san.includes("+")) sfx.check();
  else if (rec.san.includes("x")) sfx.capture();
  else sfx.move();
}

function endSound(s: GameState, on: boolean) {
  if (!on) return;
  const v = verdict(s);
  (v.tone === "win" ? sfx.win : v.tone === "lose" ? sfx.lose : sfx.draw)();
}

export default function App() {
  const [session, setSession] = useState<GameState | null>(null);
  const [skill, setSkill] = useState(6);
  const [color, setColor] = useState<"white" | "black">("white");
  const [opponent, setOpponent] = useState<"stockfish" | "maia">("stockfish");
  const [elo, setElo] = useState(1150);
  const [sel, setSel] = useState<number | null>(null); // null = follow the live game
  const [progress, setProgress] = useState<string | null>(null);
  const [coach, setCoach] = useState<Record<number, string>>({});
  const [coachOn, setCoachOn] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [line, setLine] = useState<LineState | null>(null);
  const [showBetter, setShowBetter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoReviewed = useRef<string | null>(null);
  const stageTimer = useRef<number | null>(null);

  const moves = session?.moves ?? [];
  const lastPly = moves.length - 1;
  const selPly = sel != null ? Math.min(sel, lastPly) : lastPly;
  const rec = moves.length ? moves[selPly] : null;
  const live = sel == null;
  const keyRec: MoveRec | null = live
    ? ([...moves].reverse().find((m) => !m.byEngine) ?? null)
    : rec;
  const reviewing = progress != null;
  const finished = session?.status === "finished";

  const startGame = useCallback(async () => {
    setError(null);
    setBusy(true);
    if (stageTimer.current != null) {
      window.clearTimeout(stageTimer.current);
      stageTimer.current = null;
    }
    try {
      const s = await api.newGame(skill, color, opponent, elo);
      autoReviewed.current = null;
      setSession(s);
      setSel(null);
      setCoach({});
      setDrill(null);
      setLine(null);
      setShowBetter(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [skill, color, opponent, elo]);

  const startReview = useCallback(async () => {
    if (!session || progress != null) return;
    setProgress("Preparing…");
    setDrill(null);
    setLine(null);
    setShowBetter(false);
    try {
      const s = await api.review(session.id, (done, total) =>
        setProgress(`Analysing your moves ${done} / ${total}`),
      );
      setSession(s);
      const firstBad = s.moves.find(
        (m) => !m.byEngine && (m.badge === "mistake" || m.badge === "blunder"),
      );
      setSel(firstBad ? firstBad.ply : s.moves.length - 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress(null);
    }
  }, [session, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Review automatically once a game ends.
  useEffect(() => {
    if (!session || session.status !== "finished" || session.reviewed) return;
    if (autoReviewed.current === session.id) return;
    autoReviewed.current = session.id;
    void startReview();
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = useCallback(
    (ply: number) => {
      if (!session || !moves.length) return;
      setSel(Math.max(0, Math.min(session.moves.length - 1, ply)));
      setDrill(null);
      setLine(null);
      setShowBetter(false);
    },
    [session, moves.length],
  );

  const badPlies = useMemo(
    () =>
      moves
        .filter((m) => !m.byEngine && (m.badge === "mistake" || m.badge === "blunder"))
        .map((m) => m.ply),
    [moves],
  );

  const stepMistake = useCallback(
    (dir: 1 | -1) => {
      const target = dir === 1 ? badPlies.find((p) => p > selPly) : [...badPlies].reverse().find((p) => p < selPly);
      if (target != null) jump(target);
    },
    [badPlies, selPly, jump],
  );

  const play = useCallback(
    async (uci: string) => {
      if (!session || busy || finished) return;
      if (drill) {
        try {
          const result = await api.drillTry(session.id, drill.ply, uci);
          const tries = drill.tries + 1;
          if (result.correct) {
            setDrill({ ...drill, tries, message: "Found it — that was the best move." });
          } else if (tries >= 2 && result.bestUci) {
            setDrill({
              ...drill,
              tries,
              bestUci: result.bestUci,
              message: `Not it (${BADGE[result.badge as Badge]?.label ?? result.badge}). The best move is shown on the board — ${result.bestSan}.`,
            });
          } else {
            setDrill({
              ...drill,
              tries,
              message: `Not it (${BADGE[result.badge as Badge]?.label ?? result.badge}). Look again.`,
            });
          }
        } catch (e) {
          setError(String(e));
        }
        return;
      }
      setBusy(true);
      setSel(null);
      setShowBetter(false);
      setLine(null);
      try {
        const next = await api.move(session.id, uci);
        const last = next.moves[next.moves.length - 1];
        if (!last?.byEngine) {
          // my move ended the game — show it directly
          recSound(last, soundOn);
          endSound(next, soundOn);
          setSession(next);
          setBusy(false);
          return;
        }
        // Stage 1: my move lands (the piece is already where I played it).
        const mine = next.moves[next.moves.length - 2];
        const engineTurn: "white" | "black" = session.playerColor === "white" ? "black" : "white";
        setSession({
          ...next,
          fen: mine.fenAfter,
          lastMove: [mine.uci.slice(0, 2), mine.uci.slice(2, 4)],
          dests: {},
          turn: engineTurn,
          check: new Chess(mine.fenAfter).isCheck(),
        });
        recSound(mine, soundOn);
        // Stage 2: after a beat, the reply arrives and the piece animates from its square.
        if (stageTimer.current != null) window.clearTimeout(stageTimer.current);
        stageTimer.current = window.setTimeout(() => {
          stageTimer.current = null;
          recSound(last, soundOn);
          endSound(next, soundOn);
          setSession(next);
          setBusy(false);
        }, 550);
      } catch (e) {
        setError(String(e));
        setBusy(false);
      }
    },
    [session, busy, finished, drill, soundOn],
  );

  const resign = useCallback(async () => {
    if (!session || finished) return;
    try {
      const next = await api.resign(session.id);
      setSession(next);
    } catch (e) {
      setError(String(e));
    }
  }, [session, finished]);

  const startDrill = useCallback(async () => {
    if (!session || selPly == null || rec?.byEngine) return;
    try {
      const d = await api.drill(session.id, selPly);
      setLine(null);
      setShowBetter(false);
      setDrill({ ply: selPly, fen: d.fen, dests: d.dests, tries: 0, bestUci: null, message: null });
    } catch (e) {
      setError(String(e));
    }
  }, [session, selPly, rec]);

  const openLine = useCallback(
    (kind: "actual" | "better") => {
      if (!rec) return;
      setDrill(null);
      if (kind === "better") {
        setLine({
          baseFen: rec.fenBefore,
          uci: rec.bestPv,
          san: rec.bestPvSan,
          index: 0,
          label: `Best line — ${rec.bestSan ?? ""}`,
        });
        setShowBetter(true);
      } else {
        setLine({ baseFen: rec.fenAfter, uci: rec.pv, san: rec.pvSan, index: 0, label: "Engine line" });
      }
    },
    [rec],
  );

  // Keyboard: arrows navigate, shift+arrows jump between your mistakes, Esc backs out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLine(null);
        setDrill(null);
        setShowBetter(false);
        return;
      }
      if (!session || !moves.length || reviewing) return;
      if (line) {
        if (e.key === "ArrowRight") setLine((l) => (l && l.index < l.uci.length - 1 ? { ...l, index: l.index + 1 } : l));
        if (e.key === "ArrowLeft") setLine((l) => (l && l.index >= 0 ? { ...l, index: l.index - 1 } : l));
        return;
      }
      if (drill) return;
      if (e.key === "ArrowRight" && !e.shiftKey) { e.preventDefault(); jump(selPly + 1); }
      else if (e.key === "ArrowLeft" && !e.shiftKey) { e.preventDefault(); jump(selPly - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); stepMistake(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); stepMistake(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, moves.length, reviewing, line, drill, selPly, jump, stepMistake]);

  const coachPly = keyRec && !keyRec.byEngine ? keyRec.ply : null;
  useEffect(() => {
    if (!coachOn || !session || coachPly == null) return;
    if (coach[coachPly] !== undefined) return;
    let alive = true;
    api.coach(session.id, coachPly).then((text) => {
      if (alive) setCoach((c) => ({ ...c, [coachPly]: text }));
    });
    return () => { alive = false; };
  }, [coachOn, session, coachPly]); // eslint-disable-line react-hooks/exhaustive-deps

  const arrows: Arrow[] = useMemo(() => {
    if (drill) return drill.bestUci ? [arrow(drill.bestUci, "best")] : [];
    if (line) return [];
    if (showBetter && rec) {
      const list: Arrow[] = rec.bestUci ? [arrow(rec.bestUci, "best")] : [];
      rec.bestPv.slice(1, 4).forEach((u) => list.push(arrow(u, "line")));
      return list;
    }
    if (rec) {
      // Position after the played move: first expected reply is colored red when
      // it hurts (captures a piece or gives check/mate), the rest is the line.
      const list: Arrow[] = [];
      if (rec.pv.length) {
        const firstSan = rec.pvSan[0] ?? "";
        list.push(arrow(rec.pv[0], /x|[+#]/.test(firstSan) ? "threat" : "line"));
        rec.pv.slice(1, 3).forEach((u) => list.push(arrow(u, "line")));
      }
      return list;
    }
    return (session?.bookArrows ?? []).map((u) => arrow(u, "book"));
  }, [drill, line, showBetter, rec, session]);

  const board = useMemo(() => {
    if (!session) return null;
    if (drill) return { fen: drill.fen, last: null, dests: drill.dests, check: false };
    if (line) {
      const pos = linePosition(line.baseFen, line.uci, line.index);
      return { fen: pos.fen, last: pos.last, dests: {}, check: false };
    }
    if (showBetter && rec) return { fen: rec.fenBefore, last: null, dests: {}, check: false };
    const atLive = rec != null && rec.ply === lastPly && session.status === "playing";
    if (rec) {
      return {
        fen: rec.fenAfter,
        last: [rec.uci.slice(0, 2), rec.uci.slice(2, 4)] as [string, string],
        dests: atLive ? session.dests : {},
        check: atLive ? session.check : false,
      };
    }
    return { fen: session.fen, last: session.lastMove, dests: session.dests, check: session.check };
  }, [session, drill, line, showBetter, rec, lastPly]);

  if (!session || !board) {
    return (
      <div className="center">
        <div className="card">
          <h1>Chess</h1>
          <p className="hint">
            Play Stockfish on this Mac. Every move you make gets graded, the review shows the
            better line on the board, and mistakes become drills.
          </p>
          <div className="field">
            <span className="field-label">Opponent</span>
            <div className="chips">
              <button
                className={opponent === "stockfish" ? "chip chip-on" : "chip"}
                onClick={() => setOpponent("stockfish")}
              >
                Stockfish
              </button>
              <button
                className={opponent === "maia" ? "chip chip-on" : "chip"}
                onClick={() => setOpponent("maia")}
              >
                Maia · human-like
              </button>
            </div>
            <span className="field-sub">
              {opponent === "maia"
                ? "Maia-3 predicts how real players move — mistakes look human, not random."
                : "Classic engine. Weaker levels slip at random."}
            </span>
          </div>
          {opponent === "stockfish" ? (
            <div className="field">
              <span className="field-label">Level · {levelName(skill)}</span>
              <div className="chips">
                {PRESETS.map(([value, name]) => (
                  <button key={name} className={skill === value ? "chip chip-on" : "chip"} onClick={() => setSkill(value)}>
                    {name}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={1}
                max={20}
                value={skill}
                onChange={(e) => setSkill(Number(e.target.value))}
              />
              <span className="field-sub">Level {skill}</span>
            </div>
          ) : (
            <div className="field">
              <span className="field-label">Strength · {elo} Elo</span>
              <div className="chips">
                {ELO_PRESETS.map(([value, name]) => (
                  <button key={name} className={elo === value ? "chip chip-on" : "chip"} onClick={() => setElo(value)}>
                    {name}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={600}
                max={2600}
                step={50}
                value={elo}
                onChange={(e) => setElo(Number(e.target.value))}
              />
              <span className="field-sub">{elo} Elo</span>
            </div>
          )}
          <div className="field">
            <span className="field-label">Color</span>
            <div className="chips">
              <button className={color === "white" ? "chip chip-on" : "chip"} onClick={() => setColor("white")}>White</button>
              <button className={color === "black" ? "chip chip-on" : "chip"} onClick={() => setColor("black")}>Black</button>
            </div>
          </div>
          <button className="primary big" disabled={busy} onClick={startGame}>
            {busy ? "Starting…" : "Start game"}
          </button>
        </div>
      </div>
    );
  }

  const v = finished ? verdict(session) : null;
  const barCp = rec?.evalCp ?? 0;
  const whiteCp = session.playerColor === "white" ? barCp : -barCp;
  const graphEvals = moves.map((m) =>
    m.evalCp == null ? null : session.playerColor === "black" ? -m.evalCp : m.evalCp,
  );
  const statusText = reviewing
    ? progress
    : finished
      ? v!.text
      : session.turn === session.playerColor
        ? "Your move"
        : "Stockfish is thinking…";

  return (
    <div className="app">
      <header>
        <span className="brand">Chess</span>
        <span className="chip subtle">{opponentLabel(session)}</span>
        {v && <span className={`pill ${v.tone}`}>{v.text}</span>}
        {session.opening && (
          <span className="opening">
            {session.opening.eco} {session.opening.name}
          </span>
        )}
        <span className="spacer" />
        <label className="toggle">
          <input type="checkbox" checked={coachOn} onChange={(e) => setCoachOn(e.target.checked)} />
          Coach
        </label>
        <button
          className={soundOn ? "icon-btn on" : "icon-btn"}
          onClick={() => setSoundOn(!soundOn)}
          title="Toggle sound"
        >
          {soundOn ? "Sound on" : "Sound off"}
        </button>
        {!finished && (
          <button disabled={reviewing || moves.length === 0} onClick={resign}>
            Resign
          </button>
        )}
        {!session.reviewed && moves.length > 0 && (
          <button disabled={reviewing} onClick={startReview}>
            Review
          </button>
        )}
        <button className="primary" onClick={startGame}>New game</button>
      </header>

      <main>
        <section className="board-area">
          <div className="board-row">
            <EvalBar cp={whiteCp} orientation={session.playerColor} />
            <Board
              fen={board.fen}
              dests={board.dests}
              lastMove={board.last}
              orientation={session.playerColor}
              check={board.check}
              arrows={arrows}
              onMove={play}
            />
          </div>
          {line ? (
            <div className="linebar">
              <b>{line.label}</b>
              <span className="line-sans">
                {line.san.map((s, i) => (
                  <b key={i} className={i === line.index ? "on" : ""}>{s}</b>
                ))}
              </span>
              <span className="line-pos">
                {line.index + 1}/{line.uci.length}
              </span>
              <button
                onClick={() => setLine((l) => (l && l.index >= 0 ? { ...l, index: l.index - 1 } : l))}
                disabled={line.index < 0}
              >
                ←
              </button>
              <button
                onClick={() => setLine((l) => (l && l.index < l.uci.length - 1 ? { ...l, index: l.index + 1 } : l))}
                disabled={line.index >= line.uci.length - 1}
              >
                →
              </button>
              <button onClick={() => setLine(null)}>Exit</button>
            </div>
          ) : drill ? (
            <div className="drill">
              <span>
                {drill.message ?? `Find the best move for ${session.playerColor}. Try ${drill.tries}/3`}
              </span>
              <button onClick={() => setDrill(null)}>Back</button>
            </div>
          ) : (
            <div className="under-board">
              <span className={"turn-dot" + (finished ? " done" : session.turn === session.playerColor ? " you" : "")} />
              <span className="status-text">{statusText}</span>
              <span className="spacer" />
              <span className="kbd-hints">← → moves · ⇧←→ your mistakes · Esc back</span>
            </div>
          )}
        </section>

        <aside className="panel">
          <span className="section-label">Evaluation</span>
          <EvalGraph evals={graphEvals} index={selPly} markers={badPlies} onJump={jump} />
          <Legend />
          {session.summary && <SummaryCard summary={session.summary} onJump={jump} />}
          {keyRec && (
            <>
              <span className="section-label">Analysis</span>
              <KeyCard
                rec={keyRec}
                playerColor={session.playerColor}
                coachText={coachOn ? (coach[keyRec.ply] ?? null) : null}
                showBetter={showBetter && rec?.ply === keyRec.ply}
                inLine={line != null}
                onToggleBetter={() => setShowBetter((b) => !b)}
                onStartLine={openLine}
                onDrill={startDrill}
              />
            </>
          )}
          <span className="section-label">Moves</span>
          <MoveList moves={moves} activePly={selPly} onJump={jump} />
        </aside>
      </main>

      {error && (
        <div className="error" onClick={() => setError(null)}>
          {error} — click to dismiss
        </div>
      )}
    </div>
  );
}

const LEGEND: [keyof typeof ARROW_COLORS, string][] = [
  ["best", "your best move"],
  ["threat", "their threat"],
  ["line", "engine line"],
  ["book", "opening"],
];

function Legend() {
  return (
    <div className="legend">
      {LEGEND.map(([name, label]) => (
        <span key={name}>
          <svg width="20" height="10" viewBox="0 0 20 10">
            <line x1="1" y1="5" x2="12" y2="5" stroke={ARROW_COLORS[name]} strokeWidth="4" strokeLinecap="round" />
            <polygon points="11,1 19,5 11,9" fill={ARROW_COLORS[name]} />
          </svg>
          {label}
        </span>
      ))}
    </div>
  );
}

