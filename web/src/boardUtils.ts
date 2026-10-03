import { Chess } from "chess.js";
import type { Arrow } from "./Board";

export function arrow(uci: string, brush: string): Arrow {
  return { orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush };
}

export function destsFromFen(fen: string): Record<string, string[]> {
  const dests: Record<string, string[]> = {};
  try {
    for (const mv of new Chess(fen).moves({ verbose: true })) {
      (dests[mv.from] ??= []).push(mv.to);
    }
  } catch {
    /* unparsable position: nothing movable */
  }
  return dests;
}

export function playUci(fen: string, uci: string): string | null {
  const game = new Chess(fen);
  try {
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move.san;
  } catch {
    return null;
  }
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

export interface CapturedState {
  white: string[]; // piece types white has captured, most valuable first
  black: string[]; // piece types black has captured
  diff: number;    // material balance, white POV
}

/** What each side has captured, read straight off the position. */
export function capturedFromFen(fen: string): CapturedState {
  const counts: Record<"w" | "b", Record<string, number>> = { w: {}, b: {} };
  for (const row of fen.split(" ")[0].split("/")) {
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") continue;
      const side = ch === ch.toUpperCase() ? "w" : "b";
      const type = ch.toLowerCase();
      counts[side][type] = (counts[side][type] ?? 0) + 1;
    }
  }
  const lost = (side: "w" | "b"): { pieces: string[]; value: number } => {
    const have = counts[side];
    // Pieces beyond the starting set came from promotion — those pawns left
    // the board on their own, so they don't count as captures.
    const promoted = (["q", "r", "b", "n"] as const).reduce(
      (sum, t) => sum + Math.max(0, (have[t] ?? 0) - START_COUNT[t]),
      0,
    );
    const pieces: string[] = [];
    let value = 0;
    for (const t of ["q", "r", "b", "n", "p"]) {
      const gone = Math.max(0, START_COUNT[t] - (have[t] ?? 0) - (t === "p" ? promoted : 0));
      for (let i = 0; i < gone; i++) pieces.push(t);
      value += gone * PIECE_VALUE[t];
    }
    return { pieces, value };
  };
  const white = lost("b");
  const black = lost("w");
  return { white: white.pieces, black: black.pieces, diff: white.value - black.value };
}
