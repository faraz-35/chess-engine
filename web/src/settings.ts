export interface AppSettings {
  volume: number;           // 0–1 master volume; 0 mutes all sounds
  liveGrades: boolean;      // grade badges while playing
  coach: boolean;           // Gemini one-liners while playing
  coachReview: boolean;     // coach sentences while browsing a reviewed game
  openingHints: boolean;    // opening name + usual-continuation arrows
  lineArrows: boolean;      // engine expected-line arrows after each move
  evalBar: boolean;         // win-probability bar next to the board, while playing
  evalBarReview: boolean;   // eval bar while walking through a reviewed game
  evalGraph: boolean;       // eval plotline, while playing
  evalGraphReview: boolean; // eval plotline in review
  movesList: boolean;       // move list, while playing
  movesListReview: boolean; // move list in review
  autoReview: boolean;      // run the deep review automatically when a game ends
}

const KEY = "chessSettings";

export const DEFAULT_SETTINGS: AppSettings = {
  volume: 1,
  liveGrades: true,
  coach: true,
  coachReview: true,
  openingHints: true,
  lineArrows: true,
  evalBar: true,
  evalBarReview: true,
  evalGraph: true,
  evalGraphReview: true,
  movesList: true,
  movesListReview: true,
  autoReview: false, // review is opt-in: click Review when you want Stockfish
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
