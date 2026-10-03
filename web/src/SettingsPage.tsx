import type { AppSettings } from "./settings";
import { sfx, setVolume } from "./sound";

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

const ROWS: { section: string; volume?: boolean; items: { key: keyof AppSettings; label: string; hint?: string }[] }[] = [
  {
    section: "While playing",
    volume: true,
    items: [
      { key: "liveGrades", label: "Move grades", hint: "Best / mistake / blunder badge on your moves as you play." },
      { key: "lineArrows", label: "Engine arrows", hint: "After each move, arrows show the expected reply — red when it threatens something." },
      { key: "openingHints", label: "Opening hints", hint: "Opening name and the usual continuation drawn on the board." },
      { key: "evalBar", label: "Evaluation bar", hint: "Who is winning, next to the board." },
      { key: "evalGraph", label: "Eval graph" },
      { key: "movesList", label: "Moves" },
      { key: "coach", label: "Coach", hint: "One plain sentence about your move (Gemini, uses engine facts only)." },
    ],
  },
  {
    section: "In review",
    items: [
      { key: "autoReview", label: "Automatic review", hint: "Run the full Stockfish review by itself when a game ends. Off by default — review when you want it." },
      { key: "evalBarReview", label: "Evaluation bar" },
      { key: "evalGraphReview", label: "Eval graph" },
      { key: "movesListReview", label: "Moves" },
      { key: "coachReview", label: "Coach" },
    ],
  },
];

export default function Settings({ settings, onChange }: Props) {
  return (
    <div className="page settings">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="hint">Everything stays on this machine, saved in the browser.</p>
        </div>
      </div>
      {ROWS.map((group) => (
        <section className="card" key={group.section}>
          <h1>{group.section}</h1>
          {group.items.filter((i) => i.label).map((item) => (
            <label className="setting-row" key={item.key}>
              <span className="setting-text">
                <b>{item.label}</b>
                {item.hint && <em>{item.hint}</em>}
              </span>
              <input
                type="checkbox"
                checked={settings[item.key] as boolean}
                onChange={(e) => onChange({ [item.key]: e.target.checked })}
              />
            </label>
          ))}
          {group.volume && (
            <label className="setting-row">
              <span className="setting-text">
                <b>Sounds</b>
                <em>Move, capture and check sounds. Drag left to mute.</em>
              </span>
              <span className="setting-volume">
                <input
                  type="range" min={0} max={100} step={5}
                  value={Math.round(settings.volume * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    onChange({ volume: v });
                    setVolume(v);
                    sfx.move(); // hear the level as you drag
                  }}
                />
                <span>{Math.round(settings.volume * 100)}%</span>
              </span>
            </label>
          )}
        </section>
      ))}
    </div>
  );
}
