#!/usr/bin/env python3
"""Build the Lessons opening tree: data/openings/*.tsv -> web/public/openings/tree.json.

Every named ECO line becomes a path in one tree of positions. A node carries the
SAN/UCI of its move and the name of the shortest book line passing through it.
Children are ordered by how much theory branches beneath them, so main lines
come first everywhere. Rerun only when data/openings changes.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import chess

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "openings"
OUT = ROOT / "web" / "public" / "openings" / "tree.json"


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
    ordered = sorted(node.children.values(), key=lambda k: (-k.weight, k.best))
    node.children = {child.uci: child for child in ordered}
    for child in node.children.values():
        finalize(child)


def emit(node: Node) -> dict:
    out: dict = {}
    if node.san is not None:
        out["m"], out["u"], out["e"], out["n"] = node.san, node.uci, node.best[1], node.best[2]
    if node.children:
        out["c"] = [emit(child) for child in node.children.values()]
    return out


def main() -> None:
    entries = load_entries()
    if not entries:
        raise SystemExit(f"no opening books in {SRC} — see README")
    root, nodes = build(entries)
    finalize(root)
    tree = emit(root)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(tree, separators=(",", ":")))
    print(f"entries: {len(entries)}")
    print(f"positions: {nodes}")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
