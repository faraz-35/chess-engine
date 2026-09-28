from __future__ import annotations

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_env() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


_load_env()

STOCKFISH_PATH = os.environ.get("STOCKFISH_PATH", "") or shutil.which("stockfish") \
    or "/opt/homebrew/bin/stockfish"
MAIA3_UCI = os.environ.get("MAIA3_UCI", str(ROOT / ".venv" / "bin" / "maia3-uci"))
MAIA3_MODEL = os.environ.get("MAIA3_MODEL", "maia3-79m")
GAMES_DIR = ROOT / "games"
LOG_DIR = ROOT / "logs"
WEB_DIST = ROOT / "web" / "dist"
OPENINGS_DIR = ROOT / "data" / "openings"
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
