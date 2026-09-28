"""Cross-game history: parse saved PGNs into progress stats and practice material.

The PGN comments written by the app are the data source: "[Blunder] best e4 The
knight ... is attacked". Positions are reconstructed by replaying the moves.
"""
from __future__ import annotations

import json
import logging
import re

import chess
import chess.pgn

from . import quality
from .config import GAMES_DIR
from .openings import Openings

log = logging.getLogger("chess.history")

PLAYER = "Faraz"
BADGE_BY_LABEL = {info["label"].lower(): key for key, info in quality.BADGES.items()}
_BRACKET = re.compile(r"\[([A-Za-z]+)\]")
_BEST = re.compile(r"\bbest\s+(\S+)")


def _reason_key(text: str) -> str | None:
    if "allows a forced mate" in text:
        return "allowed_mate"
    if "forced mate" in text:
        return "missed_mate"
    if "could win the" in text:
        return "missed_material"
    if "is attacked" in text or "can be taken" in text:
        return "hung_piece"
    return None


def _parse_comment(comment: str) -> tuple[str | None, str | None, str | None, str | None]:
    """badge key, best SAN, reason text, reason key — from a PGN move comment."""
    m = _BRACKET.search(comment)
    if not m:
        return None, None, None, None
    badge = BADGE_BY_LABEL.get(m.group(1).lower())
    rest = comment[m.end():].strip()
    best_san = None
    mb = _BEST.search(rest)
    if mb:
        best_san = mb.group(1)
        rest = (rest[:mb.start()] + rest[mb.end():]).strip()
    reason = rest or None
    return badge, best_san, reason, (_reason_key(reason) if reason else None)


def _date_of(path) -> str:
    stem = path.stem  # YYYYMMDD-HHMMSS-sf6
    raw = stem[:8]
    return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"


def _outcome(result: str, color: chess.Color) -> str:
    if result == "1/2-1/2":
        return "draw"
    won = (result == "1-0") == (color == chess.WHITE)
    return "win" if won else "loss"


def _sidecar(path):
    side = path.with_suffix(".json")
    if side.exists():
        try:
            return json.loads(side.read_text())
        except json.JSONDecodeError:
            return None
    return None


def parse_game(path, book: Openings) -> dict | None:
    try:
        with path.open() as handle:
            game = chess.pgn.read_game(handle)
    except Exception:
        log.warning("unreadable pgn %s", path.name)
        return None
    if game is None or not game.next():
        return None
    headers = game.headers
    player_color = chess.WHITE if headers.get("White", PLAYER) == PLAYER else chess.BLACK
    opponent = headers.get("Black") if player_color == chess.WHITE else headers.get("White")
    result = headers.get("Result", "*")

    board = game.board()
    seq: list[str] = []
    counts: dict[str, int] = {}
    reasons: dict[str, set[str]] = {}
    practice: list[dict] = []
    opening = headers.get("Opening") or None
    for node in game.mainline():
        mover = board.turn
        is_player = mover == player_color
        fen_before = board.fen()
        best_san = None
        badge = None
        reason = None
        rkey = None
        if is_player and node.comment:
            badge, best_san, reason, rkey = _parse_comment(node.comment)
        seq.append(node.move.uci())
        board.push(node.move)
        if not is_player or badge is None:
            continue
        counts[badge] = counts.get(badge, 0) + 1
        if rkey:
            reasons.setdefault(rkey, set()).add(path.stem)
            practice.append({
                "fen": fen_before,
                "badge": badge,
                "bestSan": best_san,
                "reason": reason,
                "reasonKey": rkey,
                "gameFile": path.stem,
                "date": _date_of(path),
                "ply": len(seq) - 1,
            })
    if opening is None and book is not None:
        hit = book.lookup(seq)
        if hit:
            opening = f"{hit.eco} {hit.name}"
    return {
        "file": path.stem,
        "date": _date_of(path),
        "opponent": opponent or "?",
        "opponentKind": "maia" if (opponent or "").startswith("Maia") else "stockfish",
        "color": "white" if player_color else "black",
        "result": result,
        "outcome": _outcome(result, player_color) if result not in ("*", "") else None,
        "accuracy": (_sidecar(path) or {}).get("summary", {}).get("accuracy"),
        "counts": counts,
        "opening": opening,
        "plies": len(seq),
        "_practice": practice,
        "_reasonGames": reasons,
    }


def stats(book: Openings) -> dict:
    games: list[dict] = []
    all_practice: dict[str, dict] = {}
    totals_counts: dict[str, int] = {}
    pattern_counts: dict[str, dict] = {}
    openings: dict[str, dict] = {}
    outcome_tally = {"win": 0, "loss": 0, "draw": 0}
    accuracies: list[float] = []

    for path in sorted(GAMES_DIR.glob("*.pgn"), reverse=True):
        parsed = parse_game(path, book)
        if parsed is None:
            continue
        parsed.pop("_reasonGames", None)
        practice = parsed.pop("_practice", [])
        games.append(parsed)
        if parsed["outcome"]:
            outcome_tally[parsed["outcome"]] += 1
        if parsed["accuracy"] is not None:
            accuracies.append(parsed["accuracy"])
        for badge, n in parsed["counts"].items():
            totals_counts[badge] = totals_counts.get(badge, 0) + n
        if parsed["opening"]:
            entry = openings.setdefault(parsed["opening"], {
                "name": parsed["opening"], "games": 0, "wins": 0, "losses": 0, "draws": 0})
            entry["games"] += 1
            if parsed["outcome"]:
                key = {"win": "wins", "loss": "losses", "draw": "draws"}[parsed["outcome"]]
                entry[key] += 1
        for item in practice:
            item["opening"] = parsed["opening"]
            key = item["fen"]
            slot = all_practice.setdefault(key, {**item, "seen": 0})
            slot["seen"] += 1
            pattern = pattern_counts.setdefault(item["reasonKey"], {
                "key": item["reasonKey"], "count": 0, "games": set()})
            pattern["count"] += 1
            pattern["games"].add(item["gameFile"])

    return {
        "games": games,
        "totals": {
            "games": len(games),
            "wins": outcome_tally["win"],
            "losses": outcome_tally["loss"],
            "draws": outcome_tally["draw"],
            "accuracyAvg": round(sum(accuracies) / len(accuracies), 1) if accuracies else None,
            "reviewed": len(accuracies),
            "counts": totals_counts,
        },
        "openings": sorted(openings.values(), key=lambda o: -o["games"])[:8],
        "patterns": sorted(
            ({"key": p["key"], "count": p["count"], "games": len(p["games"])}
             for p in pattern_counts.values()),
            key=lambda p: -p["count"]),
    }


def practice_items(book: Openings) -> dict:
    """Deduplicated blunder/mistake positions from all games, worst first."""
    per_fen: dict[str, dict] = {}
    for path in sorted(GAMES_DIR.glob("*.pgn"), reverse=True):
        parsed = parse_game(path, book)
        if parsed is None:
            continue
        for item in parsed["_practice"]:
            item["opening"] = parsed["opening"]
            slot = per_fen.setdefault(item["fen"], {**item})
            slot["seen"] = slot.get("seen", 0) + 1
    items = sorted(per_fen.values(),
                   key=lambda it: ({"blunder": 0, "mistake": 1}.get(it["badge"], 2), -it["seen"]))
    return {"items": items[:80]}
