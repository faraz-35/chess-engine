import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import Board, { type Arrow, type StepMove } from "./Board";
import EvalBar from "./EvalBar";
import EvalGraph from "./EvalGraph";
import GameEnd from "./GameEnd";
import KeyCard from "./KeyCard";
import MoveList from "./MoveList";
import Practice from "./Practice";
import Progress from "./Progress";
import SettingsPage from "./SettingsPage";
import SummaryCard from "./SummaryCard";
import { api, type ExploreResult, type GameSummary } from "./api";
import { arrow, destsFromFen } from "./boardUtils";
import { fmtEval, moveLabel } from "./format";
import { loadSettings, saveSettings, type AppSettings } from "./settings";
import { sfx } from "./sound";
import { BADGE, ARROW_COLORS, type Badge, type GameState, type MoveRec } from "./types";

type Route = "play" | "practice" | "progress" | "settings";

function currentRoute(): Route {
  const hash = window.location.hash.replace("#/", "");
  return ["practice", "progress", "settings"].includes(hash) ? (hash as Route) : "play";
}

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

interface Toast {
  id: number;
  text: string;
  tone: "error" | "info";
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
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const updateSetting = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [line, setLine] = useState<LineState | null>(null);
  const [manualBetter, setManualBetter] = useState<boolean | null>(null); // null = automatic
  const [explore, setExplore] = useState<{ fen: string; result: ExploreResult } | null>(null);
  const [step, setStep] = useState<StepMove | null>(null);
  const exploreCache = useRef<Map<string, ExploreResult>>(new Map());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState<Route>(currentRoute);
  const [recent, setRecent] = useState<GameSummary[] | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [modalClosed, setModalClosed] = useState<string | null>(null);
  const stageTimer = useRef<number | null>(null);
  const toastId = useRef(0);

  const notify = useCallback((text: string, tone: Toast["tone"] = "error") => {
    const id = ++toastId.current;
    setToasts((list) => [...list, { id, text, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);

  useEffect(() => {
    const sync = () => setRoute(currentRoute());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    api.games().then((list) => setRecent(list.slice(0, 6))).catch(() => setRecent([]));
  }, []);

  const goto = useCallback((next: Route) => {
    window.location.hash = next === "play" ? "" : `/${next}`;
    setRoute(next);
  }, []);

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
  // On a reviewed mistake the better plan is the story — show it by default.
  const autoBetter = Boolean(
    !live && session?.reviewed && rec && !rec.byEngine
    && (rec.badge === "mistake" || rec.badge === "blunder" || rec.badge === "inaccuracy")
    && rec.bestUci && rec.bestUci !== rec.uci && rec.bestPv.length > 0
    && !drill && !line,
  );
  const showBetter = manualBetter ?? autoBetter;

  const startGame = useCallback(async () => {
    setToasts([]);
    setBusy(true);
    if (stageTimer.current != null) {
      window.clearTimeout(stageTimer.current);
      stageTimer.current = null;
    }
    try {
      const s = await api.newGame(skill, color, opponent, elo);
      setSession(s);
      setSel(null);
      setCoach({});
      setDrill(null);
      setLine(null);
      setExplore(null);
      setManualBetter(null);
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }, [skill, color, opponent, elo]);

  const openGame = useCallback(async (file: string) => {
    setToasts([]);
    setBusy(true);
    if (stageTimer.current != null) {
      window.clearTimeout(stageTimer.current);
      stageTimer.current = null;
    }
    try {
      const s = await api.loadGame(file);
      setSession(s);
      setSel(null);
      setCoach({});
      setDrill(null);
      setLine(null);
      setExplore(null);
      setManualBetter(null);
      setStep(null);
      goto("play");
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }, [goto, notify]);

  const startReview = useCallback(async () => {
    if (!session || progress != null) return;
    setProgress("Preparing…");
    setDrill(null);
    setLine(null);
    setExplore(null);
    try {
      const s = await api.review(session.id, (done, total) =>
        setProgress(total ? `Analysing your moves ${done} / ${total}` : "Analysing…"),
      );
      setSession(s);
      const firstBad = s.moves.find(
        (m) => !m.byEngine && (m.badge === "mistake" || m.badge === "blunder"),
      );
      setStep(null);
      setStep(null);
      setManualBetter(null);
      setSel(firstBad ? firstBad.ply : s.moves.length - 1);
    } catch (e) {
      notify(String(e));
    } finally {
      setProgress(null);
    }
  }, [session, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Optional: review automatically when a game ends (Settings).
  useEffect(() => {
    if (!settings.autoReview) return;
    if (!session || session.status !== "finished" || session.reviewed) return;
    void startReview();
  }, [session, settings.autoReview]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = useCallback(
    (ply: number) => {
      if (!session || !moves.length) return;
      const target = Math.max(0, Math.min(session.moves.length - 1, ply));
      // Stepping exactly one ply forward animates the move on the board;
      // landing on the live position returns to the real game.
      if (target === selPly + 1 && moves[target]) {
        const next = moves[target];
        setStep({
          fen: next.fenAfter,
          preFen: target > 0 ? moves[target - 1].fenAfter : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          from: next.uci.slice(0, 2),
          to: next.uci.slice(2, 4),
        });
      } else {
        setStep(null);
      }
      setSel(target >= lastPly ? null : target);
      setDrill(null);
      setLine(null);
      setExplore(null);
      setManualBetter(null);
    },
    [session, moves, lastPly, selPly],
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
      if (!session || busy) return;
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
          notify(String(e));
        }
        return;
      }
      // Real game moves only when following the live position; browsing history
      // (sel != null) turns the board into a tangent analysis branch — the game
      // record is untouched and Esc or → returns to the live position.
      if (session.status === "playing" && sel == null) {
        setBusy(true);
        setSel(null);
        setStep(null);
        setLine(null);
        setExplore(null);
        try {
          const next = await api.move(session.id, uci);
          const last = next.moves[next.moves.length - 1];
          if (!last?.byEngine) {
            // my move ended the game — show it directly
            recSound(last, settings.soundOn);
            endSound(next, settings.soundOn);
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
          recSound(mine, settings.soundOn);
          // Stage 2: after a beat, the reply arrives and the piece animates from its square.
          if (stageTimer.current != null) window.clearTimeout(stageTimer.current);
          stageTimer.current = window.setTimeout(() => {
            stageTimer.current = null;
            recSound(last, settings.soundOn);
            endSound(next, settings.soundOn);
            setSession(next);
            setBusy(false);
          }, 550);
        } catch (e) {
          notify(String(e));
          setBusy(false);
        }
        return;
      }
      // Exploration: a scratch branch from the position on the board. The game record
      // never changes; pieces can be moved for either side and the engine re-evaluates.
      let baseFen: string;
      let branch: string[];
      let branchSan: string[];
      if (line) {
        baseFen = line.baseFen;
        branch = line.uci.slice(0, line.index + 1);
        branchSan = line.san.slice(0, line.index + 1);
      } else if (rec) {
        baseFen = rec.fenAfter;
        branch = [];
        branchSan = [];
      } else {
        return;
      }
      const game = new Chess(baseFen);
      for (const u of branch) {
        game.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
      }
      let played;
      try {
        played = game.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci[4] : undefined,
        });
      } catch {
        notify("That move is not legal here.");
        return;
      }
      recSound({ san: played.san } as MoveRec, settings.soundOn);
      setLine({
        baseFen,
        uci: [...branch, uci],
        san: [...branchSan, played.san],
        index: branch.length,
        label: line ? "Exploring" : `Exploring after ${moveLabel(rec!)}`,
      });
    },
    [session, busy, drill, settings.soundOn, sel, line, rec],
  );

  const resign = useCallback(async () => {
    if (!session || finished) return;
    // If the engine's staged reply is still pending, drop it — the resign response
    // already carries the full move list, so nothing is lost.
    if (stageTimer.current != null) {
      window.clearTimeout(stageTimer.current);
      stageTimer.current = null;
      setBusy(false);
    }
    try {
      const next = await api.resign(session.id);
      setSession(next);
    } catch (e) {
      notify(String(e));
    }
  }, [session, finished]);

  const startDrill = useCallback(async () => {
    if (!session || selPly == null || rec?.byEngine) return;
    try {
      const d = await api.drill(session.id, selPly);
      setLine(null);
      setExplore(null);
      setDrill({ ply: selPly, fen: d.fen, dests: d.dests, tries: 0, bestUci: null, message: null });
    } catch (e) {
      notify(String(e));
    }
  }, [session, selPly, rec]);

  const openLine = useCallback(
    (kind: "actual" | "better") => {
      if (!rec) return;
      setDrill(null);
      if (kind === "better") {
        setManualBetter(true);
        setLine({
          baseFen: rec.fenBefore,
          uci: rec.bestPv,
          san: rec.bestPvSan,
          index: 0,
          label: `Best line — ${rec.bestSan ?? ""}`,
        });
      } else {
        setLine({ baseFen: rec.fenAfter, uci: rec.pv, san: rec.pvSan, index: 0, label: "Engine line" });
      }
    },
    [rec],
  );

  // Keyboard: arrows navigate, shift+arrows jump between your mistakes, Esc
  // backs out of lines and returns to the live game from history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLine(null);
        setDrill(null);
        setExplore(null);
        setStep(null);
        setSel(null);
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

  // Coach sentences are in-play feedback or post-review analysis — never
  // pushed while simply browsing an unreviewed game.
  const coachAllowed = live ? settings.coach : !!session?.reviewed && settings.coachReview;
  const coachPly = keyRec && !keyRec.byEngine && coachAllowed ? keyRec.ply : null;
  useEffect(() => {
    if (!coachAllowed || !session || coachPly == null) return;
    if (coach[coachPly] !== undefined) return;
    let alive = true;
    api.coach(session.id, coachPly).then((text) => {
      if (alive) setCoach((c) => ({ ...c, [coachPly]: text }));
    });
    return () => { alive = false; };
  }, [coachAllowed, session, coachPly]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayFen = useMemo(() => {
    if (!session) return null;
    if (drill) return drill.fen;
    if (line) return linePosition(line.baseFen, line.uci, line.index).fen;
    if (rec) return rec.fenAfter;
    return session.fen;
  }, [session, drill, line, rec]);

  // Analyse whatever exploration position is on the board (debounced, cached by FEN).
  useEffect(() => {
    if (!line || !displayFen) return;
    const game = new Chess(displayFen);
    if (game.isGameOver()) {
      setExplore(null);
      return;
    }
    const cached = exploreCache.current.get(displayFen);
    if (cached) {
      setExplore({ fen: displayFen, result: cached });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.explore(displayFen);
        exploreCache.current.set(displayFen, result);
        if (!cancelled) setExplore({ fen: displayFen, result });
      } catch {
        /* exploration is best-effort; the last shown analysis stays */
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [line, displayFen]);

  const lineEnd = useMemo(() => {
    if (!line || !displayFen) return null;
    const game = new Chess(displayFen);
    if (game.isCheckmate()) return "Checkmate";
    if (game.isStalemate()) return "Stalemate";
    if (game.isInsufficientMaterial() || game.isDraw()) return "Draw";
    return null;
  }, [line, displayFen]);

  const arrows: Arrow[] = useMemo(() => {
    if (drill) return drill.bestUci ? [arrow(drill.bestUci, "best")] : [];
    if (line) {
      const fresh = explore && explore.fen === displayFen ? explore.result : null;
      if (fresh?.bestUci) {
        const list: Arrow[] = [arrow(fresh.bestUci, "best")];
        fresh.bestPv.slice(1, 4).forEach((u) => list.push(arrow(u, "line")));
        return list;
      }
      return [];
    }
    if (rec) {
      if (!live && !session?.reviewed) return []; // browsing an unreviewed game: no engine arrows
      if (!settings.lineArrows && rec.ply === lastPly) return [];
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
    return settings.openingHints ? (session?.bookArrows ?? []).map((u) => arrow(u, "book")) : [];
  }, [drill, line, explore, displayFen, showBetter, rec, session, settings]);

  const board = useMemo(() => {
    if (!session) return null;
    if (drill) return { fen: drill.fen, last: null, dests: drill.dests, check: false };
    if (line) {
      const pos = linePosition(line.baseFen, line.uci, line.index);
      return { fen: pos.fen, last: pos.last, dests: destsFromFen(pos.fen), check: new Chess(pos.fen).isCheck() };
    }
    const atLive = rec != null && rec.ply === lastPly && session.status === "playing" && sel == null;
    if (showBetter && rec) {
      // The better plan: the position where it was your move, best arrow drawn.
      return { fen: rec.fenBefore, last: null, dests: destsFromFen(rec.fenBefore), check: new Chess(rec.fenBefore).isCheck() };
    }
    if (rec) {
      // Any browsed position is a tangent board: moves for either side are
      // allowed there and only land in the scratch branch.
      const browsing = sel != null || session.status === "finished";
      return {
        fen: rec.fenAfter,
        last: [rec.uci.slice(0, 2), rec.uci.slice(2, 4)] as [string, string],
        dests: browsing ? destsFromFen(rec.fenAfter) : atLive ? session.dests : {},
        check: atLive ? session.check : new Chess(rec.fenAfter).isCheck(),
      };
    }
    return { fen: session.fen, last: session.lastMove, dests: session.dests, check: session.check };
  }, [session, drill, line, rec, lastPly, sel, showBetter]);

  const tabsNav = (
    <nav className="tabs">
      {([["play", "Play"], ["practice", "Practice"], ["progress", "Progress"], ["settings", "Settings"]] as [Route, string][]).map(
        ([key, label]) => (
          <button key={key} className={route === key ? "tab on" : "tab"} onClick={() => goto(key)}>
            {label}
          </button>
        ),
      )}
    </nav>
  );

  if (route !== "play") {
    return (
      <div className="app">
        <header>
          <span className="brand">Chess</span>
          {tabsNav}
          <span className="spacer" />
          {route === "practice" && (
            <span className="chip subtle">
              {session ? `as ${session.playerColor}` : "white to move"}
            </span>
          )}
        </header>
        {route === "practice" && <Practice orientation={session?.playerColor ?? color} />}
        {route === "progress" && <Progress onPractice={() => goto("practice")} onOpenGame={openGame} />}
        {route === "settings" && <SettingsPage settings={settings} onChange={updateSetting} />}
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={"toast " + t.tone}>{t.text}</div>
          ))}
        </div>
      </div>
    );
  }

  if (!session || !board) {
    return (
      <div className="app">
        <header>
          <span className="brand">Chess</span>
          {tabsNav}
        </header>
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
          {recent != null && recent.length > 0 && (
            <div className="field">
              <span className="field-label">Recent games</span>
              <div className="recent-list">
                {recent.map((g) => (
                  <button key={g.file} className="recent-row" onClick={() => openGame(g.file)}>
                    <span className={`outcome ${g.outcome ?? "na"}`}>
                      {g.outcome == null ? "·" : g.outcome === "win" ? "W" : g.outcome === "loss" ? "L" : "D"}
                    </span>
                    <span className="recent-what">
                      vs {g.opponent}
                      <em>{g.reviewed ? " · reviewed" : ""}{g.opening ? ` · ${g.opening}` : ""}</em>
                    </span>
                    <span className="prac-meta">{g.date}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={"toast " + t.tone}>{t.text}</div>
          ))}
        </div>
      </div>
    );
  }

  const v = finished ? verdict(session) : null;
  const exploringHere = explore != null && explore.fen === displayFen && explore.result.evalCp != null;
  const whiteCp = exploringHere
    ? (explore!.result.evalCp as number)               // explore evals are already white POV
    : session.playerColor === "white"
      ? (rec?.evalCp ?? 0)
      : -(rec?.evalCp ?? 0);
  const graphEvals = moves.map((m) =>
    m.evalCp == null ? null : session.playerColor === "black" ? -m.evalCp : m.evalCp,
  );
  const browsingLive = sel != null && !finished && !reviewing;
  const statusText = reviewing
    ? progress
    : finished
      ? v!.text
      : browsingLive
        ? `Viewing ${rec ? moveLabel(rec) : "history"} — moves here are a tangent`
        : session.turn === session.playerColor
          ? "Your move"
          : "Stockfish is thinking…";

  return (
    <div className="app">
      <header>
        <span className="brand">Chess</span>
{tabsNav}
        {route === "play" && (
          <>
            <span className="chip subtle">{opponentLabel(session)}</span>
            {v && <span className={`pill ${v.tone}`}>{v.text}</span>}
            {session.opening && settings.openingHints && (
              <span className="opening">
                {session.opening.eco} {session.opening.name}
              </span>
            )}
          </>
        )}
        <span className="spacer" />
        {route === "play" && (
          <>
            {!finished && (
              <button
                className={confirmResign ? "danger" : ""}
                disabled={reviewing || moves.length === 0}
                onClick={() => {
                  if (confirmResign) {
                    setConfirmResign(false);
                    void resign();
                  } else {
                    setConfirmResign(true);
                    window.setTimeout(() => setConfirmResign(false), 3500);
                  }
                }}
              >
                {confirmResign ? "Sure? Click again" : "Resign"}
              </button>
            )}
            {!session.reviewed && moves.length > 0 && (
              <button disabled={reviewing} onClick={startReview}>
                Review
              </button>
            )}
            <button className="primary" onClick={startGame}>New game</button>
          </>
        )}
      </header>

      {route === "play" && (
      <main>
        <section className="board-area">
          <div className="board-row">
            {settings.evalBar && <EvalBar cp={whiteCp} orientation={session.playerColor} />}
            <Board
              fen={board.fen}
              dests={board.dests}
              lastMove={board.last}
              orientation={session.playerColor}
              check={board.check}
              arrows={arrows}
              step={step}
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
                {lineEnd ? (
                  <b className="suggestion">{lineEnd}</b>
                ) : explore?.fen === displayFen && explore.result.bestSan ? (
                  <b className="suggestion">{explore.result.bestSan}</b>
                ) : null}
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
              <span className={"turn-dot" + (finished || browsingLive ? " done" : session.turn === session.playerColor ? " you" : "")} />
              <span className="status-text">{statusText}</span>
              {finished && !session.reviewed && !reviewing && (
                <button className="accent" onClick={startReview}>Review with Stockfish</button>
              )}
              {browsingLive && (
                <button className="return-btn" onClick={() => { setSel(null); setStep(null); }}>
                  Return to game
                </button>
              )}
              <span className="spacer" />
              <span className="kbd-hints">← → moves · ⇧←→ your mistakes · Esc back</span>
            </div>
          )}
        </section>

        <aside className="panel">
          <span className="section-label">Evaluation</span>
          <EvalGraph evals={graphEvals} index={selPly} markers={session.reviewed ? badPlies : []} onJump={jump} />
          <Legend />
          {session.summary && <SummaryCard summary={session.summary} onJump={jump} />}
          {keyRec && (
            <>
              <span className="section-label">Analysis</span>
              <KeyCard
                rec={keyRec}
                playerColor={session.playerColor}
                coachText={coachAllowed ? (coach[keyRec.ply] ?? null) : null}
                inLine={line != null}
                minimal={(!session.reviewed && !live) || !settings.liveGrades}
                showingBetter={showBetter && rec?.ply === keyRec.ply}
                onToggleBetter={() => setManualBetter(!showBetter)}
                onStartLine={openLine}
                onDrill={startDrill}
              />
            </>
          )}
          <span className="section-label">Moves</span>
          <MoveList moves={moves} activePly={selPly} onJump={jump} showGrades={settings.liveGrades && (session.reviewed || !finished)} />
        </aside>
      </main>
      )}

      {finished && session.reviewed && session.summary
        && modalClosed !== session.id && (
        <GameEnd
          session={session}
          onDismiss={() => setModalClosed(session.id)}
          onNewGame={() => { setModalClosed(session.id); void startGame(); }}
          onPractice={() => { setModalClosed(session.id); goto("practice"); }}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + t.tone}>{t.text}</div>
        ))}
      </div>
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

