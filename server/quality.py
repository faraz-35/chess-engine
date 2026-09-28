"""Move quality: eval deltas to badges, and reason text computed from positions only.

Nothing here consults a language model — every statement is derived from
Stockfish scores and board geometry, so the "why" can't be hallucinated.
"""
from __future__ import annotations

import logging
import math

import chess
import chess.engine

log = logging.getLogger("chess.quality")

MATE = 100_000
WIN = 90_000

BADGES: dict[str, dict] = {
    "best": {"glyph": "★", "label": "Best", "nag": None, "color": "#22c55e"},
    "excellent": {"glyph": "!", "label": "Excellent", "nag": 1, "color": "#4ade80"},
    "good": {"glyph": "✓", "label": "Good", "nag": None, "color": "#84cc16"},
    "book": {"glyph": "B", "label": "Book", "nag": None, "color": "#14b8a6"},
    "inaccuracy": {"glyph": "?!", "label": "Inaccuracy", "nag": 6, "color": "#eab308"},
    "mistake": {"glyph": "?", "label": "Mistake", "nag": 2, "color": "#f97316"},
    "blunder": {"glyph": "??", "label": "Blunder", "nag": 4, "color": "#ef4444"},
}

PIECE_VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
PIECE_NAME = {chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop",
              chess.ROOK: "rook", chess.QUEEN: "queen"}


def score_to_cp(score: chess.engine.PovScore, pov: chess.Color) -> int:
    s = score.pov(pov)
    if s.is_mate():
        m = s.mate() or 0
        return MATE - abs(m) * 100 if m > 0 else -(MATE - abs(m) * 100)
    return s.score() or 0


def terminal_cp(board: chess.Board, mover: chess.Color) -> int:
    """Score when the game just ended. The mover either delivered mate or drew."""
    return MATE if board.is_checkmate() else 0


def to_player_pov(cp: int, mover: chess.Color, player: chess.Color) -> int:
    return cp if mover == player else -cp


def classify(pre_cp: int, post_cp: int, is_best: bool) -> str:
    """Badge from the eval drop between the position before and after a move (mover POV)."""
    if is_best:
        return "best"
    if pre_cp >= WIN and post_cp >= WIN:
        return "good"  # a forced win was kept, even if slower
    if pre_cp >= WIN:
        return "blunder" if post_cp < -100 else "mistake"
    if pre_cp <= -WIN and post_cp <= -WIN:
        return "good"  # already lost, nothing changed
    drop = pre_cp - post_cp
    if drop < 40:
        return "excellent"
    if drop < 90:
        return "good"
    if drop < 200:
        return "inaccuracy"
    if drop < 400:
        return "mistake"
    return "blunder"


def format_eval(cp: int | None) -> str:
    if cp is None:
        return "?"
    if cp >= MATE - 20_000:
        return f"#{math.ceil((MATE - cp) / 100)}"
    if cp <= -(MATE - 20_000):
        return f"#-{math.ceil((MATE + cp) / 100)}"
    return f"{cp / 100:+.1f}"


def reason_text(board_before: chess.Board, board_after: chess.Board, mover: chess.Color,
                pre_info: dict | None, post_pv: list[str], post_cp: int) -> tuple[str, str] | None:
    """Why a move was bad: (key, text). Facts only; None when nothing clean can be said."""
    try:
        pre_pv = [u.uci() for u in pre_info["pv"]] if pre_info else []
        if post_cp <= -(MATE - 5_000):
            return "allowed_mate", "This allows a forced mate: " + _san_line(board_after, post_pv[:4])
        if pre_info:
            pre_score = pre_info["score"].pov(mover)
            if pre_score.is_mate() and (pre_score.mate() or 0) > 0 and post_cp < WIN:
                return "missed_mate", "You had a forced mate: " + _san_line(board_before, pre_pv[:4])
        hung = _hanging(board_after, mover)
        if hung:
            sq, piece, attacker_type, undefended = hung
            if undefended:
                return "hung_piece", (f"The {PIECE_NAME[piece.piece_type]} on {chess.square_name(sq)} "
                                      f"is attacked and undefended.")
            return "hung_piece", (f"The {PIECE_NAME[piece.piece_type]} on {chess.square_name(sq)} "
                                  f"can be taken by the {PIECE_NAME.get(attacker_type, 'enemy piece')}.")
        if pre_info:
            missed = _missed_material(board_before, mover, pre_pv)
            if missed:
                return "missed_material", missed
        return None
    except Exception:
        log.exception("reason_text failed")
        return None


def win_pct(cp: int) -> float:
    """Win probability for the side the cp is from (0-100), lichess's curve."""
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def _hanging(board: chess.Board, color: chess.Color):
    """Most valuable piece of `color` that the opponent can profitably take right now."""
    best = None
    for sq, piece in board.piece_map().items():
        if piece.color != color or piece.piece_type == chess.KING:
            continue
        attackers = board.attackers(not color, sq)
        if not attackers:
            continue
        defenders = board.attackers(color, sq)
        value = PIECE_VALUE[piece.piece_type]
        lowest = min(PIECE_VALUE.get(board.piece_type_at(a) or chess.QUEEN, 9) for a in attackers)
        if (not defenders or lowest < value) and (best is None or value > best[0]):
            attacker_sq = min(attackers, key=lambda a: PIECE_VALUE.get(board.piece_type_at(a) or chess.QUEEN, 9))
            best = (sq, piece, board.piece_type_at(attacker_sq), not defenders)
    return best


def _missed_material(board_before: chess.Board, mover: chess.Color, pre_pv: list[str]) -> str | None:
    """First capture worth 3+ pawns in the engine's best line for the mover."""
    board = board_before.copy()
    for uci in pre_pv[:8]:
        try:
            mv = chess.Move.from_uci(uci)
        except ValueError:
            return None
        if mv not in board.legal_moves:
            return None
        captured = board.piece_type_at(mv.to_square)
        if board.turn == mover and captured and PIECE_VALUE.get(captured, 0) >= 3:
            return f"You could win the {PIECE_NAME[captured]} on {chess.square_name(mv.to_square)} with {board.san(mv)}."
        board.push(mv)
    return None


def _san_line(board: chess.Board, pv_uci: list[str]) -> str:
    b = board.copy()
    parts: list[str] = []
    for uci in pv_uci:
        try:
            mv = chess.Move.from_uci(uci)
        except ValueError:
            break
        if mv not in b.legal_moves:
            break
        if b.turn == chess.WHITE:
            parts.append(f"{b.fullmove_number}.")
        parts.append(b.san(mv))
        b.push(mv)
    return " ".join(parts) if parts else "—"
