"""Opening names + main lines from bundled ECO TSVs (niklasf/chess-openings)."""
from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field

import chess

from .config import OPENINGS_DIR

log = logging.getLogger("chess.openings")


@dataclass
class BookHit:
    eco: str
    name: str
    exact: bool                                        # the played sequence is itself a named opening
    remaining_uci: list[str] = field(default_factory=list)  # how the main line continues


class Openings:
    def __init__(self, lines: dict[tuple[str, ...], tuple[str, str]]):
        self._lines = lines
        self.count = len(lines)

    @classmethod
    def load(cls) -> Openings:
        lines: dict[tuple[str, ...], tuple[str, str]] = {}
        files = sorted(OPENINGS_DIR.glob("*.tsv"))
        if not files:
            raise RuntimeError(f"no opening books in {OPENINGS_DIR} — see README")
        for path in files:
            with path.open() as handle:
                reader = csv.reader(handle, delimiter="\t")
                next(reader)  # header: eco, name, pgn
                for row in reader:
                    if len(row) < 3:
                        continue
                    eco, name, pgn = row[0], row[1], row[2]
                    seq = _uci_sequence(pgn)
                    if seq is not None:
                        lines[tuple(seq)] = (eco, name)
        log.info("openings loaded: %d lines", len(lines))
        return cls(lines)

    def lookup(self, uci_seq: list[str]) -> BookHit | None:
        """Longest named prefix of the played moves."""
        seq = tuple(uci_seq)
        for length in range(len(seq), 0, -1):
            key = seq[:length]
            hit = self._lines.get(key)
            if hit is not None:
                return BookHit(eco=hit[0], name=hit[1], exact=length == len(seq),
                               remaining_uci=list(key[length:]))
        return None


def _uci_sequence(pgn_moves: str) -> list[str] | None:
    board = chess.Board()
    seq: list[str] = []
    for token in pgn_moves.split():
        if token[0].isdigit():
            continue
        try:
            mv = board.parse_san(token)
        except ValueError:
            return None
        seq.append(mv.uci())
        board.push(mv)
    return seq
