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
