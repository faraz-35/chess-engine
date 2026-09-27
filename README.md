# chess-engine

Play Stockfish on your Mac and learn from every game.

- Board at localhost:8790. Pick a level (1-20) and a color, then play.
- Every move YOU play gets graded (Best / Good / Inaccuracy / Mistake / Blunder) from the eval drop. The opening name and the usual continuation show as you play.
- Eval bar beside the board, eval graph with your mistakes marked.
- When the game ends, a review runs automatically: accuracy score, your worst move, recurring patterns ("hung a piece x3"), best-move arrows, and a "See the better move" view plus a line stepper.
- "Try it yourself" resets a mistake and you have to find the better move.
- Optional Coach (Gemini): one plain sentence per move. It only repeats engine facts — it never judges chess itself.
- Keyboard: ← → step through moves, Shift+← → jump between your mistakes, Esc backs out.

## Run

    brew install stockfish
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    cd web && npm install && cd ..
    ./run.sh          # builds the UI once, then serves http://127.0.0.1:8790

Games save as PGN in `games/` (your moves annotated). Server log: `logs/server.log`.

The Gemini key lives in `.env` (GOOGLE_API_KEY). Without it everything else still works.

## How it works

Two Stockfish processes: one plays at the chosen skill level, one analyses at full strength. Only your moves are analysed; the engine's evals are carried over between positions instead of recomputed. Grades come from eval deltas. The "why" text is computed from the board: hanging pieces, missed forced mates, pieces that can be captured. No language model is involved in judging chess.
