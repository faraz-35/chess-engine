"""chess-engine — local Stockfish play + review. Run: uvicorn server.main:app --port 8790"""
from __future__ import annotations

import json
import logging
import secrets
from logging.handlers import RotatingFileHandler
from pathlib import Path

import chess
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import coach, quality
from . import engine as engine_module
from .config import GAMES_DIR, LOG_DIR, STOCKFISH_PATH, WEB_DIST
from .engine import Engines
from .openings import Openings
from .session import Session

LOG_DIR.mkdir(exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[RotatingFileHandler(LOG_DIR / "server.log", maxBytes=2_000_000, backupCount=2),
              logging.StreamHandler()],
)
log = logging.getLogger("chess")

app = FastAPI(title="chess-engine", docs_url=None, redoc_url=None)

_engines: Engines | None = None
_book: Openings | None = None
_sessions: dict[str, Session] = {}


def engines() -> Engines:
    global _engines
    if _engines is None:
        if not Path(STOCKFISH_PATH).exists():
            raise RuntimeError(f"Stockfish not found at {STOCKFISH_PATH} — run: brew install stockfish")
        _engines = Engines(STOCKFISH_PATH)
    return _engines


def book() -> Openings:
    global _book
    if _book is None:
        _book = Openings.load()
    return _book


def session_or_404(sid: str) -> Session:
    session = _sessions.get(sid)
    if session is None:
        raise HTTPException(404, "no such game")
    return session


class NewIn(BaseModel):
    skill: int = 6
    color: str = "white"
    opponent: str = "stockfish"
    elo: int = 1150


class MoveIn(BaseModel):
    sid: str
    uci: str


class DrillStartIn(BaseModel):
    sid: str
    ply: int


class DrillTryIn(BaseModel):
    sid: str
    ply: int
    uci: str


@app.on_event("startup")
def _startup() -> None:
    book()  # fail fast if the opening data is missing


@app.get("/api/health")
def health():
    return {"ok": True, "stockfish": STOCKFISH_PATH,
            "openings": _book.count if _book else 0, "coach": coach.available(),
            "maia": engine_module.maia_available()}


@app.post("/api/new")
def new_game(body: NewIn):
    if body.color not in ("white", "black"):
        raise HTTPException(400, "color must be white or black")
    if body.opponent not in ("stockfish", "maia"):
        raise HTTPException(400, "opponent must be stockfish or maia")
    if not 1 <= body.skill <= 20:
        raise HTTPException(400, "skill must be 1-20")
    if not 600 <= body.elo <= 2600:
        raise HTTPException(400, "elo must be 600-2600")
    session = Session(secrets.token_hex(4), body.skill,
                      chess.WHITE if body.color == "white" else chess.BLACK, book(),
                      opponent=body.opponent, elo=body.elo)
    _sessions[session.id] = session
    if body.color == "black":
        session.engine_opens(engines())
    log.info("new game %s skill=%d color=%s opponent=%s elo=%d",
             session.id, body.skill, body.color, body.opponent, body.elo)
    return session.payload()


@app.get("/api/state/{sid}")
def state(sid: str):
    return session_or_404(sid).payload()


@app.post("/api/move")
def move(body: MoveIn):
    session = session_or_404(body.sid)
    if session.board.outcome() is not None or session.result:
        raise HTTPException(409, "game is over")
    if session.board.turn != session.player_color:
        raise HTTPException(409, "not your turn")
    try:
        session.player_move(body.uci, engines())
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return session.payload()


@app.post("/api/resign/{sid}")
def resign(sid: str):
    session = session_or_404(sid)
    session.resign()
    return session.payload()


@app.get("/api/review/{sid}")
def review(sid: str):
    session = session_or_404(sid)
    total = len(session.moves)

    def gen():
        yield f"data: {json.dumps({'total': total})}\n\n"
        try:
            for ply in session.review(engines()):
                yield f"data: {json.dumps({'ply': ply, 'total': total})}\n\n"
            yield f"data: {json.dumps({'done': True, 'state': session.payload()})}\n\n"
        except Exception as exc:
            log.exception("review failed")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})


@app.post("/api/drill")
def drill(body: DrillStartIn):
    session = session_or_404(body.sid)
    if not 0 <= body.ply < len(session.moves):
        raise HTTPException(400, "bad ply")
    return session.drill_start(body.ply)


@app.post("/api/drill/try")
def drill_try(body: DrillTryIn):
    session = session_or_404(body.sid)
    try:
        return session.drill_try(body.ply, body.uci, engines())
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/coach/{sid}/{ply}")
async def coach_move(sid: str, ply: int):
    session = session_or_404(sid)
    if not coach.available():
        raise HTTPException(400, "no GOOGLE_API_KEY in .env")
    if not 0 <= ply < len(session.moves):
        raise HTTPException(400, "bad ply")
    if ply not in session.coach_cache:
        text = await coach.explain(coach_facts(session, ply))
        session.coach_cache[ply] = text or "No explanation available."
    return {"ply": ply, "text": session.coach_cache[ply]}


def coach_facts(session: Session, ply: int) -> dict:
    rec = session.moves[ply]
    badge = quality.BADGES.get(rec.badge or "")
    facts: dict = {"move": rec.san, "by": "engine" if rec.by_engine else "you",
                   "quality": badge["label"] if badge else "unrated"}
    if rec.reason:
        facts["problem"] = rec.reason
    if rec.best_uci and rec.best_uci != rec.uci and rec.best_san:
        facts["better_move"] = rec.best_san
    if rec.eval_cp is not None:
        facts["eval_after_move"] = quality.format_eval(rec.eval_cp) + " (positive is good for you)"
    if rec.pv_san:
        facts["engine_line"] = " ".join(rec.pv_san[:4])
    if rec.opening:
        facts["opening"] = rec.opening
    return facts


if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
else:
    log.warning("web/dist missing — UI not served (dev mode: cd web && npm run dev)")
