import type { GameState } from "./types";

async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error((detail as { detail?: string }).detail ?? response.statusText);
  }
  return response.json();
}

export interface ExploreResult {
  evalCp: number | null;
  bestUci: string | null;
  bestSan: string | null;
  bestPv: string[];
  bestPvSan: string[];
}

export interface PracticeItem {
  fen: string;
  badge: string;
  bestSan: string | null;
  reason: string | null;
  reasonKey: string | null;
  gameFile: string;
  date: string;
  ply: number;
  seen: number;
  opening: string | null;
}

export interface PracticeCheck {
  correct: boolean;
  badge: string | null;
  bestUci: string | null;
  bestSan: string | null;
  evalCp: number | null;
}

export interface StatsGame {
  file: string;
  date: string;
  opponent: string;
  opponentKind: string;
  color: string;
  result: string;
  outcome: "win" | "loss" | "draw" | null;
  accuracy: number | null;
  counts: Record<string, number>;
  opening: string | null;
  plies: number;
}

export interface Stats {
  games: StatsGame[];
  totals: {
    games: number;
    wins: number;
    losses: number;
    draws: number;
    accuracyAvg: number | null;
    reviewed: number;
    counts: Record<string, number>;
  };
  openings: { name: string; games: number; wins: number; losses: number; draws: number }[];
  patterns: { key: string; count: number; games: number }[];
}

export const api = {
  newGame: (skill: number, color: string, opponent: string, elo: number) =>
    post<GameState>("/api/new", { skill, color, opponent, elo }),

  explore: (fen: string) => post<ExploreResult>("/api/explore", { fen }),

  stats: async (): Promise<Stats> => (await fetch("/api/stats")).json(),

  practice: async (): Promise<PracticeItem[]> => (await fetch("/api/practice")).json().then((r) => r.items),

  practiceCheck: (fen: string, uci: string) => post<PracticeCheck>("/api/practice/check", { fen, uci }),

  move: (sid: string, uci: string) => post<GameState>("/api/move", { sid, uci }),

  resign: (sid: string) => post<GameState>(`/api/resign/${sid}`),

  drill: (sid: string, ply: number) =>
    post<{ ply: number; fen: string; dests: Record<string, string[]> }>("/api/drill", { sid, ply }),

  drillTry: (sid: string, ply: number, uci: string) =>
    post<{ correct: boolean; badge: string; bestUci: string | null; bestSan: string | null; fen: string }>(
      "/api/drill/try", { sid, ply, uci }),

  coach: async (sid: string, ply: number): Promise<string> => {
    const response = await fetch(`/api/coach/${sid}/${ply}`, { method: "POST" });
    if (!response.ok) return "";
    return (await response.json()).text;
  },

  review: (sid: string, onProgress: (done: number, total: number) => void): Promise<GameState> =>
    new Promise((resolve, reject) => {
      const stream = new EventSource(`/api/review/${sid}`);
      stream.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.error) {
          stream.close();
          reject(new Error(msg.error));
        } else if (msg.done) {
          stream.close();
          resolve(msg.state);
        } else if (msg.ply !== undefined) {
          onProgress(msg.ply + 1, msg.total);
        }
      };
      stream.onerror = () => {
        stream.close();
        reject(new Error("review stream ended"));
      };
    }),
};
