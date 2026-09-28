from __future__ import annotations

import atexit
import logging
import threading
from pathlib import Path

import chess
import chess.engine

from .config import MAIA3_MODEL, MAIA3_UCI, STOCKFISH_PATH

log = logging.getLogger("chess.engines")

ANALYSIS_THREADS = 2
ANALYSIS_HASH_MB = 256
ANALYSER_WORKERS = 3   # review analyses run across this many Stockfish processes
PLAY_MOVETIME = 0.35
MAIA_PLAY_NODES = 1


def maia_available() -> bool:
    return Path(MAIA3_UCI).exists()


class Engines:
    """Stockfish plays (skill 1-20) and analyses at full strength.

    Maia-3 is an alternative opponent: a human-move predictor that runs as a
    separate UCI process and is spawned lazily on the first Maia game.
    The analysis engine is always Stockfish — Maia's outputs are move
    predictions, not search evaluations.

    Review analyses positions in parallel across ANALYSER_WORKERS identical
    Stockfish processes; analyse_parallel(idx, ...) routes to worker idx with
    its own lock (a SimpleEngine serves one search at a time).
    """

    def __init__(self, path: str = STOCKFISH_PATH):
        self._lock = threading.RLock()
        self._play = chess.engine.SimpleEngine.popen_uci(path)
        self._analyse = chess.engine.SimpleEngine.popen_uci(path)
        self._analyse.configure({"Threads": ANALYSIS_THREADS, "Hash": ANALYSIS_HASH_MB})
        self._analysers = [self._analyse]
        self._analyser_locks = [threading.Lock()]
        for _ in range(ANALYSER_WORKERS - 1):
            worker = chess.engine.SimpleEngine.popen_uci(path)
            worker.configure({"Threads": ANALYSIS_THREADS, "Hash": ANALYSIS_HASH_MB})
            self._analysers.append(worker)
            self._analyser_locks.append(threading.Lock())
        self._skill = -1
        self._maia: chess.engine.SimpleEngine | None = None
        self._maia_elo = -1
        atexit.register(self.quit)
        log.info("stockfish ready (%s), %d analysis workers", path, ANALYSER_WORKERS)

    def set_skill(self, skill: int) -> None:
        with self._lock:
            if skill != self._skill:
                self._play.configure({"Skill Level": skill})
                self._skill = skill
                log.info("play engine skill -> %d", skill)

    def play_opponent(self, board: chess.Board, opponent: str, skill: int, elo: int) -> chess.Move | None:
        """One move from the chosen opponent (stockfish or maia)."""
        with self._lock:
            if board.is_game_over():
                return None
            if opponent == "maia":
                return self._maia_move(board, elo)
            self.set_skill(skill)
            return self._play.play(board, chess.engine.Limit(time=0.35)).move

    def _maia_move(self, board: chess.Board, elo: int) -> chess.Move | None:
        if self._maia is None:
            log.info("spawning maia3 (%s, %s)", MAIA3_MODEL, MAIA3_UCI)
            self._maia = chess.engine.SimpleEngine.popen_uci(
                [MAIA3_UCI, "--model", MAIA3_MODEL, "--use-uci-history"])
            log.info("maia3 ready")
        if elo != self._maia_elo:
            self._maia.configure({"Elo": elo})
            self._maia_elo = elo
            log.info("maia elo -> %d", elo)
        return self._maia.play(board, chess.engine.Limit(nodes=MAIA_PLAY_NODES)).move

    def analyse(self, board: chess.Board, depth: int, multipv: int = 1) -> list[dict]:
        """Best lines for the side to move, scores relative to it (worker 0)."""
        return self.analyse_parallel(0, board, depth, multipv)

    def analyse_parallel(self, worker: int, board: chess.Board, depth: int, multipv: int = 1,
                         cap_s: float | None = None) -> list[dict]:
        """Analyse on the given worker process (each serves one search at a time).

        cap_s bounds the search in wall time, so a loaded machine can stall a
        review but never hang it.
        """
        engine = self._analysers[worker % len(self._analysers)]
        with self._analyser_locks[worker % len(self._analyser_locks)]:
            if board.is_game_over():
                return []
            limit = chess.engine.Limit(depth=depth, time=cap_s) if cap_s else chess.engine.Limit(depth=depth)
            return list(engine.analyse(board, limit, multipv=multipv))

    def quit(self) -> None:
        for engine in (self._play, *self._analysers, self._maia):
            try:
                if engine:
                    engine.quit()
            except Exception:
                pass
