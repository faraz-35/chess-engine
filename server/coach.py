"""Optional one-sentence move explanations. The model only phrases engine facts."""
from __future__ import annotations

import json
import logging

import httpx

from .config import GEMINI_MODEL, GOOGLE_API_KEY

log = logging.getLogger("chess.coach")

SYSTEM = (
    "You are a chess coach. You get facts about one chess move, computed by a chess engine. "
    "Write ONE short sentence for a 1150-rated player. Plain everyday words. "
    "Say what the move did and, if the facts name a better move, what to play instead. "
    "Use only the facts. No markdown, no greetings, under 30 words."
)


def available() -> bool:
    return bool(GOOGLE_API_KEY)


async def explain(facts: dict) -> str | None:
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": json.dumps(facts)}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 120},
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                params={"key": GOOGLE_API_KEY},
                json=body,
            )
            response.raise_for_status()
            parts = response.json()["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts).strip()
            log.info("coach ok (%d chars)", len(text))
            return text or None
    except Exception as exc:
        log.warning("coach failed: %s", exc)
        return None
