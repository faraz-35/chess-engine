#!/usr/bin/env python3
"""Build the Lessons opening tree: data/openings/*.tsv -> web/public/openings/tree.json.

Phase 1 — every named ECO line becomes a path in one tree of positions. A node
carries the SAN/UCI of its move and the name of the shortest book line through
that position. Children are ordered by how much theory branches beneath them,
so main lines come first everywhere.

Phase 2 — branches that end early (most ECO entries stop after a few moves)
are continued with Stockfish's best moves until ~move 11, so any branch can be
walked to the end of the opening. Tails are cached per position in
data/openings/tail-cache.json and a run resumes where the last one stopped.
"""
from __future__ import annotations

import csv
import json
import time
from pathlib import Path

import chess
import chess.engine

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "openings"
OUT = ROOT / "web" / "public" / "openings" / "tree.json"
TAIL_CACHE = ROOT / "data" / "openings" / "tail-cache.json"
STOCKFISH = "/opt/homebrew/bin/stockfish"

TARGET_PLIES = 22      # walk every branch to ~move 11
MOVE_TIME = 0.07       # engine seconds per position
CHECKPOINT_EVERY = 500 # engine positions between progress log + cache save


class Node:
    __slots__ = ("san", "uci", "best", "children", "weight")

    def __init__(self, san: str | None, uci: str | None):
        self.san = san
        self.uci = uci
        self.best: tuple[int, str, str] | None = None  # (line length, eco, name)
        self.children: dict[str, Node] = {}            # uci -> Node
        self.weight = 0                                # book lines passing through

    def see(self, eco: str, name: str, line_len: int) -> None:
        self.weight += 1
        cand = (line_len, eco, name)
        if self.best is None or cand < self.best:
            self.best = cand


def san_uci_pairs(pgn: str) -> list[tuple[str, str]] | None:
    board = chess.Board()
    pairs: list[tuple[str, str]] = []
    for token in pgn.split():
        if token.replace(".", "").isdigit():
            continue  # move numbers
        try:
            move = board.parse_san(token)
        except ValueError:
            return None
        pairs.append((token, move.uci()))
        board.push(move)
    return pairs


def load_entries() -> list[tuple[str, str, list[tuple[str, str]]]]:
    entries = []
    for path in sorted(SRC.glob("*.tsv")):
        with path.open() as handle:
            for row in csv.DictReader(handle, delimiter="\t"):
                pairs = san_uci_pairs(row["pgn"])
                if pairs:
                    entries.append((row["eco"], row["name"], pairs))
    entries.sort(key=lambda e: (e[0], e[1]))
    return entries


def build(entries) -> tuple[Node, int]:
    root = Node(None, None)
    nodes = 1
    for eco, name, pairs in entries:
        node = root
        node.see(eco, name, len(pairs))
        for san, uci in pairs:
            child = node.children.get(uci)
            if child is None:
                child = Node(san, uci)
                node.children[uci] = child
                nodes += 1
            node = child
            node.see(eco, name, len(pairs))
    return root, nodes


def finalize(node: Node) -> None:
    ordered = sorted(node.children.values(), key=lambda k: (-k.weight, k.best or (1 << 30, "", "")))
    node.children = {child.uci: child for child in ordered}
    for child in node.children.values():
        finalize(child)


def load_cache() -> dict:
    if TAIL_CACHE.exists():
        return json.loads(TAIL_CACHE.read_text())
    return {}


def save_cache(memo: dict) -> None:
    TAIL_CACHE.write_text(json.dumps(memo))


def extend(root: Node) -> None:
    """Attach an engine continuation to every branch that ends before TARGET_PLIES."""
    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH)
    engine.configure({"Threads": 1, "Hash": 64})
    memo = load_cache()
    stats = {"calls": 0}
    started = time.time()

    def tail(board: chess.Board, remaining: int) -> list[dict]:
        if remaining <= 0 or board.is_game_over(claim_draw=False):
            return []
        key = f"{board.epd()}|{remaining}"
        if key not in memo:
            result = engine.play(board, chess.engine.Limit(time=MOVE_TIME))
            stats["calls"] += 1
            memo[key] = (
                None if result.move is None
                else {"u": result.move.uci(), "m": board.san(result.move)}
            )
            if stats["calls"] % CHECKPOINT_EVERY == 0:
                save_cache(memo)
                elapsed = int(time.time() - started)
                print(f"engine positions: {stats['calls']} (+{elapsed}s)", flush=True)
        best = memo[key]
        if best is None:
            return []
        board.push(chess.Move.from_uci(best["u"]))
        # Cut the tail when play stops making progress: a position coming
        # around again, or five moves per side with no pawn move or capture —
        # that's the engine dithering in a dead-equal position, not a lesson.
        if board.is_repetition(2) or board.halfmove_clock >= 10:
            board.pop()
            return []
        rest = tail(board, remaining - 1)
        board.pop()
        return [{"u": best["u"], "m": best["m"]}] + rest

    def chain_nodes(steps: list[dict]) -> Node:
        nodes = [Node(s["m"], s["u"]) for s in steps]
        for a, b in zip(nodes, nodes[1:]):
            a.children[b.uci] = b
        return nodes[0]

    def attach(node: Node, board: chess.Board, depth: int) -> None:
        if not node.children:
            if TARGET_PLIES - depth > 0:
                steps = tail(board, TARGET_PLIES - depth)
                if steps:
                    head = chain_nodes(steps)
                    node.children[head.uci] = head
            return
        for child in node.children.values():
            board.push(chess.Move.from_uci(child.uci))
            attach(child, board, depth + 1)
            board.pop()

    attach(root, chess.Board(), 0)
    engine.quit()
    save_cache(memo)
    print(f"engine positions total: {stats['calls']}")


def emit(node: Node) -> dict:
    out: dict = {}
    if node.san is not None:
        out["m"], out["u"] = node.san, node.uci
        if node.best is not None:  # engine-tail nodes carry no ECO name
            out["e"], out["n"] = node.best[1], node.best[2]
    if node.children:
        out["c"] = [emit(child) for child in node.children.values()]
    return out


def main() -> None:
    entries = load_entries()
    if not entries:
        raise SystemExit(f"no opening books in {SRC} — see README")
    root, nodes = build(entries)
    finalize(root)
    extend(root)
    tree = emit(root)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(tree, separators=(",", ":")))
    print(f"entries: {len(entries)}")
    print(f"positions: {nodes}")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
