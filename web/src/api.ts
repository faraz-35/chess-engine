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

export const api = {
  newGame: (skill: number, color: string) => post<GameState>("/api/new", { skill, color }),

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
