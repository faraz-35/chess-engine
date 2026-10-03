import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import Board, { type Arrow } from "./Board";
import { arrow, destsFromFen, playUci } from "./boardUtils";
import { sfx } from "./sound";

// The opening book (web/public/openings/tree.json, built by
// scripts/build_opening_tree.py): one tree of positions. Each node is a move
// plus the ECO name of the shortest book line through that position.

interface BookNode {
  m: string; // SAN
  u: string; // UCI
  e: string; // ECO code
  n: string; // opening name at this position
  c?: BookNode[];
}

type BookRoot = { c?: BookNode[] };

// One move on the board. node is null for off-book moves — legal, playable,
// just not theory; stepping back past them returns to the tree.
interface Step {
  uci: string;
  san: string;
  node: BookNode | null;
}

interface NamedEntry {
  eco: string;
  name: string;
  path: string[]; // UCI moves from the start to the named position
}

export default function Lessons() {
  const [book, setBook] = useState<BookRoot | null>(null);
  const [failed, setFailed] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [idx, setIdx] = useState(-1); // -1 = starting position
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/openings/tree.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((root: BookRoot) => setBook(root))
      .catch(() => setFailed(true));
  }, []);

  const named = useMemo<NamedEntry[]>(() => {
    if (!book) return [];
    const out: NamedEntry[] = [];
    const walk = (node: BookNode, path: string[]) => {
      const next = [...path, node.u];
      out.push({ eco: node.e, name: node.n, path: next });
      for (const child of node.c ?? []) walk(child, next);
    };
    for (const child of book.c ?? []) walk(child, []);
    return out;
  }, [book]);

  const pos = useMemo(() => {
    const game = new Chess();
    for (let i = 0; i <= Math.min(idx, steps.length - 1); i++) {
      const s = steps[i];
      try {
        game.move({ from: s.uci.slice(0, 2), to: s.uci.slice(2, 4), promotion: s.uci.length > 4 ? s.uci[4] : undefined });
      } catch {
        break;
      }
    }
    return { fen: game.fen(), check: game.isCheck() };
  }, [steps, idx]);

  // ECO + name of the deepest named position shown on the board.
  const place = useMemo(() => {
    let text = "";
    for (let i = 0; i <= Math.min(idx, steps.length - 1); i++) {
      const node = steps[i].node;
      if (node) text = `${node.e} ${node.n}`;
    }
    return text || null;
  }, [steps, idx]);

  const go = useCallback(
    (uci: string) => {
      const options = idx < 0 ? book?.c ?? [] : steps[idx]?.node?.c ?? [];
      const kept = steps.slice(0, idx + 1);
      const child = options.find((c) => c.u === uci);
      if (child) {
        sfx.move();
        setSteps([...kept, { uci: child.u, san: child.m, node: child }]);
        setIdx(idx + 1);
        return;
      }
      const san = playUci(pos.fen, uci);
      if (!san) return;
      sfx.move();
      setSteps([...kept, { uci, san, node: null }]);
      setIdx(idx + 1);
    },
    [book, steps, idx, pos.fen],
  );

  const jump = useCallback(
    (entry: NamedEntry) => {
      if (!book) return;
      const next: Step[] = [];
      let node: BookRoot | BookNode = book;
      for (const u of entry.path) {
        const child: BookNode | undefined = node.c?.find((c) => c.u === u);
        if (!child) break;
        next.push({ uci: child.u, san: child.m, node: child });
        node = child;
      }
      setSteps(next);
      setIdx(next.length - 1);
      setQuery("");
    },
    [book],
  );

  // Arrow keys step through the line, like the review screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(-1, i - 1));
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(steps.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length]);

  if (failed) {
    return (
      <div className="page">
        <p className="hint">Couldn't load the opening book — run scripts/build_opening_tree.py.</p>
      </div>
    );
  }
  if (!book) {
    return (
      <div className="page">
        <p className="hint">Loading openings…</p>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const results = q
    ? named.filter((e) => e.name.toLowerCase().includes(q) || e.eco.toLowerCase().includes(q)).slice(0, 100)
    : null;

  const cur = idx >= 0 ? steps[idx] : null;
  const branches = idx >= 0 ? steps[idx]?.node?.c ?? [] : [];
  const last: [string, string] | null = cur ? [cur.uci.slice(0, 2), cur.uci.slice(2, 4)] : null;
  const arrows: Arrow[] = branches.slice(0, 6).map((c) => arrow(c.u, "book"));

  return (
    <div className="page lessons">
      <div className="practice-grid">
        <div className="board-wrap">
          <Board
            fen={pos.fen}
            dests={destsFromFen(pos.fen)}
            lastMove={last}
            orientation="white"
            check={pos.check}
            arrows={arrows}
            onMove={go}
          />
          {place && <div className="lesson-place">{place}</div>}
          {steps.length > 0 && (
            <div className="lesson-moves">
              {steps.map((s, i) => (
                <span key={i} className="lesson-mv">
                  {i % 2 === 0 && <i>{i / 2 + 1}.</i>}
                  <button
                    className={"lesson-token" + (i === idx ? " on" : "") + (s.node ? "" : " off")}
                    onClick={() => setIdx(i)}
                  >
                    {s.san}
                  </button>
                </span>
              ))}
            </div>
          )}
          {(idx >= 0 || steps.length > 0) && (
            <div className="lesson-branches">
              <button onClick={() => setIdx((i) => Math.max(-1, i - 1))} disabled={idx < 0}>←</button>
              <button onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))} disabled={idx >= steps.length - 1}>→</button>
              <button onClick={() => { setSteps([]); setIdx(-1); }}>Start</button>
              {branches.map((c) => (
                <button key={c.u} className="branch" title={c.n} onClick={() => go(c.u)}>
                  {c.m}
                </button>
              ))}
            </div>
          )}
        </div>
        <aside className="panel">
          <input
            className="lesson-search"
            placeholder="Find an opening"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="lesson-list">
            {results
              ? results.map((r) => (
                  <button key={r.path.join()} className="lesson-row" onClick={() => jump(r)}>
                    <span>{r.name}</span>
                    <b>{r.eco}</b>
                  </button>
                ))
              : (book.c ?? []).map((c) => (
                  <button key={c.u} className="lesson-row" onClick={() => go(c.u)}>
                    <b>{c.m}</b>
                    <span>{c.n}</span>
                  </button>
                ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
