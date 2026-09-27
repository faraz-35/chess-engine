"""One game: board state, per-move records, review, drill, PGN output.

Analysis focuses on the player's own moves: the engine's moves are graded
nowhere, and evals for them are carried over from the neighbouring analyses
instead of being recomputed.
"""
from __future__ import annotations

import logging
import math
import threading
from dataclasses import dataclass, field
from datetime import datetime

import chess
import chess.pgn

from . import quality
from .config import GAMES_DIR
from .openings import Openings

log = logging.getLogger("chess.session")

PLAY_DEPTH = 12
REVIEW_DEPTH = 16
PLAY_MOVETIME = 0.35
PV_KEEP = 6


@dataclass
class MoveRec:
    ply: int
    uci: str
    san: str
    by_engine: bool
    fen_before: str
    fen_after: str
    badge: str | None = None            # player moves only
    eval_cp: int | None = None          # player POV, after this move (graph + eval bar)
    pre_cp: int | None = None           # player POV, before this move (player moves only)
    best_uci: str | None = None
    best_san: str | None = None
    pv: list[str] = field(default_factory=list)          # expected line after this move
    pv_san: list[str] = field(default_factory=list)
    best_pv: list[str] = field(default_factory=list)     # line starting with the best move (review)
    best_pv_san: list[str] = field(default_factory=list)
    reason_key: str | None = None
    reason: str | None = None
    opening: str | None = None

    def payload(self) -> dict:
        return {
            "ply": self.ply, "uci": self.uci, "san": self.san, "byEngine": self.by_engine,
            "fenBefore": self.fen_before, "fenAfter": self.fen_after,
            "badge": self.badge, "evalCp": self.eval_cp, "preCp": self.pre_cp,
            "bestUci": self.best_uci, "bestSan": self.best_san,
            "pv": self.pv, "pvSan": self.pv_san,
            "bestPv": self.best_pv, "bestPvSan": self.best_pv_san,
            "reasonKey": self.reason_key, "reason": self.reason, "opening": self.opening,
        }


def parse_player_uci(board: chess.Board, uci: str) -> chess.Move:
    mv = chess.Move.from_uci(uci)
    if mv in board.legal_moves:
        return mv
    if len(uci) == 4:  # promotion omitted -> queen it
        queen = chess.Move.from_uci(uci + "q")
        if queen in board.legal_moves:
            return queen
    raise ValueError(f"illegal move: {uci}")


def legal_dests(board: chess.Board) -> dict[str, list[str]]:
    dests: dict[str, list[str]] = {}
    for mv in board.legal_moves:
        dests.setdefault(chess.square_name(mv.from_square), []).append(chess.square_name(mv.to_square))
    return dests


def _san_line(board: chess.Board, pv_uci: list[str]) -> list[str]:
    b = board.copy()
    sans: list[str] = []
    for uci in pv_uci:
        try:
            mv = chess.Move.from_uci(uci)
        except ValueError:
            break
        if mv not in b.legal_moves:
            break
        sans.append(b.san(mv))
        b.push(mv)
    return sans


class Session:
    def __init__(self, sid: str, skill: int, player_color: chess.Color, book: Openings):
        self.id = sid
        self.skill = skill
        self.player_color = player_color
        self.board = chess.Board()
        self.moves: list[MoveRec] = []
        self.opening = None
        self.reviewed = False
        self.result: str | None = None
        self.resigned = False
        self.created = datetime.now()
        self._book = book
        self._lock = threading.Lock()
        self._turn_info: list[dict] | None = None   # analysis of the current player-to-move position
        self._summary: dict | None = None
        self.coach_cache: dict[int, str] = {}

    # ---------- playing ----------

    def player_move(self, uci: str, engines) -> None:
        with self._lock:
            mv = parse_player_uci(self.board, uci)
            pre = self._turn_analysis(engines)
            self._apply_player(mv, pre, engines)
            self._engine_reply(engines)
            self._settle()

    def engine_opens(self, engines) -> None:
        with self._lock:
            engines.set_skill(self.skill)
            self._engine_reply(engines)
            self._settle()

    def resign(self) -> None:
        with self._lock:
            if self.board.outcome() is not None or self.result:
                return
            self.result = "0-1" if self.player_color == chess.WHITE else "1-0"
            self.resigned = True
            self._save_pgn()
            log.info("game %s resigned: %s", self.id, self.result)

    def _turn_analysis(self, engines) -> list[dict]:
        """Analysis of the position where it is the player's turn (cached)."""
        if self._turn_info is None:
            self._turn_info = engines.analyse(self.board, PLAY_DEPTH)
        return self._turn_info

    def _apply_player(self, mv: chess.Move, pre: list[dict], engines) -> None:
        mover = self.board.turn
        best = pre[0]["pv"][0] if pre else None
        pre_cp = quality.score_to_cp(pre[0]["score"], mover) if pre else 0
        fen_before = self.board.fen()
        best_san = self.board.san(best) if best else None
        san = self.board.san(mv)
        self.board.push(mv)
        over = self.board.is_game_over()
        post = [] if over else engines.analyse(self.board, PLAY_DEPTH)
        post_cp = (quality.terminal_cp(self.board, mover) if over
                   else quality.score_to_cp(post[0]["score"], mover))
        seq = [r.uci for r in self.moves] + [mv.uci()]
        book_hit = self._book.lookup(seq)
        badge = "book" if (book_hit and book_hit.exact) else quality.classify(pre_cp, post_cp, mv == best)
        pv = [u.uci() for u in post[0]["pv"][:PV_KEEP]] if post else []
        self.moves.append(MoveRec(
            ply=len(self.moves), uci=mv.uci(), san=san, by_engine=False,
            fen_before=fen_before, fen_after=self.board.fen(),
            badge=badge, eval_cp=post_cp, pre_cp=pre_cp,
            best_uci=best.uci() if best else None, best_san=best_san,
            pv=pv, pv_san=_san_line(self.board, pv),
        ))
        self._turn_info = None

    def _engine_reply(self, engines) -> None:
        if self.board.is_game_over() or self.result:
            return
        engines.set_skill(self.skill)
        reply = engines.play_move(self.board, PLAY_MOVETIME)
        if reply is None:
            return
        mover = self.board.turn
        san = self.board.san(reply)
        self.board.push(reply)
        over = self.board.is_game_over()
        eval_cp = (quality.to_player_pov(quality.terminal_cp(self.board, mover), mover, self.player_color)
                   if over else None)
        self.moves.append(MoveRec(
            ply=len(self.moves), uci=reply.uci(), san=san, by_engine=True,
            fen_before=self.moves[-1].fen_after if self.moves else chess.STARTING_FEN,
            fen_after=self.board.fen(), badge=None, eval_cp=eval_cp,
        ))
        if not over:
            # This analysis doubles as the eval after the engine's move and the
            # pre-move analysis for the player's next move.
            turn = engines.analyse(self.board, PLAY_DEPTH)
            self._turn_info = turn
            self.moves[-1].eval_cp = quality.score_to_cp(turn[0]["score"], self.player_color)

    def _settle(self) -> None:
        outcome = self.board.outcome()
        if outcome is not None and not self.result:
            self.result = outcome.result()
        if self.result:
            self._save_pgn()
            log.info("game %s over: %s (%d moves)", self.id, self.result, len(self.moves))
        hit = self._book.lookup(self.uci_seq())
        self.opening = hit
        if self.moves and hit:
            self.moves[-1].opening = f"{hit.eco} {hit.name}"

    def uci_seq(self) -> list[str]:
        return [r.uci for r in self.moves]

    # ---------- review (player moves only) ----------

    def review(self, engines):
        """Re-score every player move at higher depth; yields ply numbers for progress."""
        with self._lock:
            board = chess.Board()
            pending_engine: MoveRec | None = None
            for rec in self.moves:
                mv = chess.Move.from_uci(rec.uci)
                mover = board.turn
                board_before = board.copy()
                board.push(mv)
                if mover == self.player_color:
                    pre = engines.analyse(board_before, REVIEW_DEPTH, multipv=2)
                    best = pre[0]["pv"][0] if pre else None
                    pre_cp = quality.score_to_cp(pre[0]["score"], mover) if pre else 0
                    over = board.is_game_over()
                    post = [] if over else engines.analyse(board, REVIEW_DEPTH, multipv=2)
                    post_cp = (quality.terminal_cp(board, mover) if over
                               else quality.score_to_cp(post[0]["score"], mover))
                    rec.pre_cp = pre_cp
                    rec.best_uci = best.uci() if best else None
                    rec.best_san = board_before.san(best) if best else None
                    rec.eval_cp = post_cp                     # mover == player -> already player POV
                    rec.pv = [u.uci() for u in post[0]["pv"][:PV_KEEP]] if post else []
                    rec.pv_san = _san_line(board, rec.pv)
                    if pre:
                        rec.best_pv = [u.uci() for u in pre[0]["pv"][:PV_KEEP]]
                        rec.best_pv_san = _san_line(board_before, rec.best_pv)
                    book_hit = self._book.lookup(self.uci_seq()[: rec.ply + 1])
                    rec.badge = ("book" if book_hit and book_hit.exact
                                 else quality.classify(pre_cp, post_cp, mv == best))
                    if rec.badge in ("mistake", "blunder") and pre:
                        found = quality.reason_text(board_before, board.copy(), mover,
                                                    pre[0], rec.pv, post_cp)
                        if found is not None:
                            rec.reason_key, rec.reason = found
                    if pending_engine is not None:
                        pending_engine.eval_cp = pre_cp       # eval after the engine's move
                        pending_engine = None
                else:
                    if board.is_game_over():
                        rec.eval_cp = quality.to_player_pov(
                            quality.terminal_cp(board, mover), mover, self.player_color)
                    else:
                        pending_engine = rec
                yield rec.ply
            self._summary = self._compute_summary()
            self.reviewed = True
            self._save_pgn()
            log.info("review %s done (%d moves)", self.id, len(self.moves))

    def _compute_summary(self) -> dict:
        counts: dict[str, int] = {}
        patterns: dict[str, dict] = {}
        accs: list[float] = []
        worst: tuple[int, int] | None = None
        for rec in self.moves:
            if rec.by_engine:
                continue
            if rec.badge:
                counts[rec.badge] = counts.get(rec.badge, 0) + 1
            if rec.pre_cp is not None and rec.eval_cp is not None:
                loss = max(0.0, quality.win_pct(rec.pre_cp) - quality.win_pct(rec.eval_cp))
                accs.append(max(0.0, 103.1668 * math.exp(-0.04354 * loss) - 3.1669))
                drop = rec.pre_cp - rec.eval_cp
                if worst is None or drop > worst[0]:
                    worst = (drop, rec.ply)
            if rec.badge in ("mistake", "blunder") and rec.reason_key:
                pattern = patterns.setdefault(rec.reason_key,
                                              {"key": rec.reason_key, "count": 0, "firstPly": rec.ply})
                pattern["count"] += 1
        return {
            "accuracy": round(sum(accs) / len(accs), 1) if accs else None,
            "counts": counts,
            "patterns": sorted(patterns.values(), key=lambda p: -p["count"]),
            "worstPly": worst[1] if worst else None,
        }

    # ---------- drill ----------

    def drill_start(self, ply: int) -> dict:
        rec = self.moves[ply]
        board = chess.Board(rec.fen_before)
        return {"ply": ply, "fen": board.fen(), "dests": legal_dests(board)}

    def drill_try(self, ply: int, uci: str, engines) -> dict:
        with self._lock:
            rec = self.moves[ply]
            board = chess.Board(rec.fen_before)
            mv = parse_player_uci(board, uci)
            mover = board.turn
            is_best = rec.best_uci is not None and mv.uci() == rec.best_uci
            board.push(mv)
            if board.is_game_over():
                post_cp = quality.terminal_cp(board, mover)
            else:
                post = engines.analyse(board, PLAY_DEPTH)
                post_cp = quality.score_to_cp(post[0]["score"], mover) if post else 0
            badge = quality.classify(rec.pre_cp or 0, post_cp, is_best)
            return {"correct": is_best or badge in ("best", "excellent"),
                    "badge": badge, "bestUci": rec.best_uci, "bestSan": rec.best_san, "fen": board.fen()}

    # ---------- output ----------

    def payload(self) -> dict:
        outcome = self.board.outcome()
        finished = outcome is not None or self.result is not None
        player_turn = (self.board.turn == self.player_color and not finished)
        return {
            "id": self.id,
            "fen": self.board.fen(),
            "turn": "white" if self.board.turn else "black",
            "playerColor": "white" if self.player_color else "black",
            "skill": self.skill,
            "status": "finished" if finished else "playing",
            "result": self.result,
            "resigned": self.resigned,
            "check": self.board.is_check(),
            "lastMove": ([self.moves[-1].uci[:2], self.moves[-1].uci[2:4]] if self.moves else None),
            "dests": legal_dests(self.board) if player_turn else {},
            "moves": [r.payload() for r in self.moves],
            "opening": self._opening_payload(),
            "bookArrows": (self.opening.remaining_uci[:4] if self.opening else []),
            "reviewed": self.reviewed,
            "summary": self._summary,
        }

    def _opening_payload(self) -> dict | None:
        if not self.opening:
            return None
        board = self.board.copy()
        line: list[str] = []
        for uci in self.opening.remaining_uci[:6]:
            try:
                mv = chess.Move.from_uci(uci)
            except ValueError:
                break
            if mv not in board.legal_moves:
                break
            line.append(board.san(mv))
            board.push(mv)
        return {"eco": self.opening.eco, "name": self.opening.name,
                "exact": self.opening.exact, "line": line}

    def _save_pgn(self) -> None:
        game = chess.pgn.Game()
        opponent = f"Stockfish-{self.skill}"
        game.headers.update({
            "Event": f"chess-engine local, level {self.skill}",
            "Site": "localhost:8790",
            "Date": self.created.strftime("%Y.%m.%d"),
            "White": "Faraz" if self.player_color == chess.WHITE else opponent,
            "Black": opponent if self.player_color == chess.WHITE else "Faraz",
            "Result": self.result or "*",
        })
        if self.resigned:
            game.headers["Termination"] = "Resignation"
        node: chess.pgn.GameNode = game
        for rec in self.moves:
            node = node.add_variation(chess.Move.from_uci(rec.uci))
            info = quality.BADGES.get(rec.badge or "")
            if info:
                if info["nag"]:
                    node.nag = info["nag"]
                parts = [f"[{info['label']}]"]
                if rec.badge != "book" and rec.best_uci and rec.best_uci != rec.uci and rec.best_san:
                    parts.append(f"best {rec.best_san}")
                if rec.reason:
                    parts.append(rec.reason)
                node.comment = " ".join(parts)
        GAMES_DIR.mkdir(exist_ok=True)
        path = GAMES_DIR / f"{self.created:%Y%m%d-%H%M%S}-sf{self.skill}.pgn"
        path.write_text(str(game))
        log.info("pgn saved %s", path.name)
