from __future__ import annotations

import atexit
import logging
import threading

import chess
import chess.engine

from .config import STOCKFISH_PATH

log = logging.getLogger("chess.engines")

ANALYSIS_THREADS = 4
ANALYSIS_HASH_MB = 256


class Engines:
    """Two Stockfish processes: one plays at the chosen skill, one analyses at full strength."""

    def __init__(self, path: str = STOCKFISH_PATH):
        self._lock = threading.RLock()
        self._play = chess.engine.SimpleEngine.popen_uci(path)
        self._analyse = chess.engine.SimpleEngine.popen_uci(path)
        self._analyse.configure({"Threads": ANALYSIS_THREADS, "Hash": ANALYSIS_HASH_MB})
        self._skill = -1
        atexit.register(self.quit)
        log.info("stockfish ready (%s)", path)

    def set_skill(self, skill: int) -> None:
        with self._lock:
            if skill != self._skill:
                self._play.configure({"Skill Level": skill})
                self._skill = skill
                log.info("play engine skill -> %d", skill)

    def play_move(self, board: chess.Board, movetime: float) -> chess.Move | None:
        with self._lock:
            if board.is_game_over():
                return None
            return self._play.play(board, chess.engine.Limit(time=movetime)).move

    def analyse(self, board: chess.Board, depth: int, multipv: int = 1) -> list[dict]:
        """Best lines for the side to move, scores relative to it."""
        with self._lock:
            if board.is_game_over():
                return []
            return list(self._analyse.analyse(board, chess.engine.Limit(depth=depth), multipv=multipv))

    def quit(self) -> None:
        for engine in (self._play, self._analyse):
            try:
                if engine:
                    engine.quit()
            except Exception:
                pass
