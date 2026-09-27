export type Badge = "best" | "excellent" | "good" | "book" | "inaccuracy" | "mistake" | "blunder";

export interface MoveRec {
  ply: number;
  uci: string;
  san: string;
  byEngine: boolean;
  fenBefore: string;
  fenAfter: string;
  badge: Badge | null;
  evalCp: number | null;
  preCp: number | null;
  bestUci: string | null;
  bestSan: string | null;
  pv: string[];
  pvSan: string[];
  bestPv: string[];
  bestPvSan: string[];
  reasonKey: string | null;
  reason: string | null;
  opening: string | null;
}

export interface OpeningInfo {
  eco: string;
  name: string;
  exact: boolean;
  line: string[];
}

export interface Summary {
  accuracy: number | null;
  counts: Record<string, number>;
  patterns: { key: string; count: number; firstPly: number }[];
  worstPly: number | null;
}

export interface GameState {
  id: string;
  fen: string;
  turn: "white" | "black";
  playerColor: "white" | "black";
  skill: number;
  status: "playing" | "finished";
  result: string | null;
  resigned: boolean;
  check: boolean;
  lastMove: [string, string] | null;
  dests: Record<string, string[]>;
  moves: MoveRec[];
  opening: OpeningInfo | null;
  bookArrows: string[];
  reviewed: boolean;
  summary: Summary | null;
}

export const BADGE: Record<Badge, { glyph: string; label: string; color: string }> = {
  best: { glyph: "★", label: "Best", color: "#22c55e" },
  excellent: { glyph: "!", label: "Excellent", color: "#4ade80" },
  good: { glyph: "✓", label: "Good", color: "#84cc16" },
  book: { glyph: "B", label: "Book", color: "#14b8a6" },
  inaccuracy: { glyph: "?!", label: "Inaccuracy", color: "#eab308" },
  mistake: { glyph: "?", label: "Mistake", color: "#f97316" },
  blunder: { glyph: "??", label: "Blunder", color: "#ef4444" },
};

export const REASON_LABEL: Record<string, string> = {
  hung_piece: "Hung a piece",
  missed_mate: "Missed a mate",
  allowed_mate: "Allowed a mate",
  missed_material: "Missed free material",
};

export const MATE = 100_000;

/** Arrow scheme: one meaning per color, shown in the legend under the graph. */
export const ARROW_COLORS: Record<"best" | "threat" | "line" | "book", string> = {
  best: "#22c55e",   // the move you should have played
  threat: "#ef4444", // the opponent's best reply when it takes your piece or checks
  line: "#5b8cff",   // the engine's expected continuation
  book: "#14b8a6",   // the usual opening continuation
};
