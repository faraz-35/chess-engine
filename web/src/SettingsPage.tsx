import type { AppSettings } from "./settings";

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

const ROWS: { section: string; items: { key: keyof AppSettings; label: string; hint: string }[] }[] = [
  {
    section: "While playing",
    items: [
      { key: "liveGrades", label: "Move grades", hint: "Best / mistake / blunder badge on your moves as you play." },
      { key: "lineArrows", label: "Engine arrows", hint: "After each move, arrows show the expected reply — red when it threatens something." },
      { key: "openingHints", label: "Opening hints", hint: "Opening name and the usual continuation drawn on the board." },
      { key: "evalBar", label: "Evaluation bar", hint: "Who is winning, next to the board." },
      { key: "coach", label: "Coach", hint: "One plain sentence about your move (Gemini, uses engine facts only)." },
      { key: "soundOn", label: "Sounds", hint: "Move, capture and check sounds." },
    ],
  },
  {
    section: "After the game",
    items: [
      { key: "autoReview", label: "Automatic review", hint: "Run the full Stockfish review by itself when a game ends. Off by default — review when you want it." },
      { key: "coachReview", label: "Coach in review", hint: "Coach sentences while walking through a reviewed game." },
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
                <em>{item.hint}</em>
              </span>
              <input
                type="checkbox"
                checked={settings[item.key]}
                onChange={(e) => onChange({ [item.key]: e.target.checked })}
              />
            </label>
          ))}
        </section>
      ))}
    </div>
  );
}
