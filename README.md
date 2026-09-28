# chess-engine

Play chess on your Mac against Stockfish or Maia, and learn from every game.

- Board at localhost:8790. Pick an opponent, a strength, and a color.
- **Stockfish** (levels 1-20) plays sharp engine moves; weak levels slip at random.
- **Maia-3** (600-2600 Elo) is trained to move like real humans at that rating — its mistakes look like yours, which makes it the better sparring partner.
- Every move YOU play gets graded (Best / Good / Inaccuracy / Mistake / Blunder) from the eval drop. The opening name and the usual continuation show as you play.
- Eval bar beside the board, eval graph with your mistakes marked.
- When the game ends, a review runs automatically: accuracy score, your worst move, recurring patterns ("hung a piece x3"), best-move arrows, and a "See the better move" view plus a line stepper.
- "Try it yourself" resets a mistake and you have to find the better move.
- Optional Coach (Gemini): one plain sentence per move. It only repeats engine facts — it never judges chess itself.
- Keyboard: ← → step through moves, Shift+← → jump between your mistakes, Esc backs out.

## Run

macOS (Homebrew):

    brew install stockfish
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    git clone https://github.com/CSSLab/maia3.git vendor/maia3   # optional, for the Maia opponent
    .venv/bin/pip install ./vendor/maia3                         # pulls torch
    cd web && npm install && cd ..
    ./run.sh          # builds the UI once, then serves http://127.0.0.1:8790

Linux (Arch/Omarchy — `sudo pacman -S stockfish python nodejs`; Debian/Ubuntu: `apt install stockfish python3 python3-venv nodejs npm`):

    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    git clone https://github.com/CSSLab/maia3.git vendor/maia3   # optional, for the Maia opponent
    .venv/bin/pip install ./vendor/maia3                         # pulls torch
    cd web && npm install && cd ..
    ./run.sh

The server finds `stockfish` on your PATH; set `STOCKFISH_PATH` if it lives elsewhere.

The Maia weights (~300MB) download from Hugging Face on first use and cache in
`~/.cache/huggingface/`. Without the maia3 package the Stockfish opponent still works.

Games save as PGN in `games/` (your moves annotated). Server log: `logs/server.log`.

## Hardware

Runs fine on any laptop with 8GB RAM. All-in, the app uses about 1.5GB: the server
(~80MB), the playing engine (~200MB), the analysis engine (~550MB during review),
and Maia (~450MB) if installed. The UI is served by the server itself — only one
process tree, no database. Everything runs locally; nothing leaves the machine
except the optional Coach sentences (Gemini API) and the one-time Maia download.

The Gemini key lives in `.env` (GOOGLE_API_KEY). Without it everything else still works.

## How it works

Two Stockfish processes: one plays at the chosen skill level, one analyses at full strength. Maia-3 runs as a third process (a UCI wrapper around the 79M-parameter transformer) and only replaces the playing side — its outputs are human-move predictions, not evaluations, so all analysis stays on Stockfish. Only your moves are analysed; the engine's evals are carried over between positions instead of recomputed. Grades come from eval deltas. The "why" text is computed from the board: hanging pieces, missed forced mates, pieces that can be captured. No language model is involved in judging chess.
