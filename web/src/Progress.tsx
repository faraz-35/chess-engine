import { useEffect, useState } from "react";
import { api, type Stats } from "./api";
import { BADGE, REASON_LABEL, type Badge } from "./types";

function Trend({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <p className="hint">Finish more games to see a trend.</p>;
  }
  const W = 100;
  const H = 40;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - 3 - (v / 100) * (H - 6);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline className="trend-line" points={points} />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="1.6" className="trend-dot" />
      ))}
    </svg>
  );
}

export default function Progress({ onPractice }: { onPractice: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null));
  }, []);

  if (!stats) {
    return <div className="page"><p className="hint">Loading your progress…</p></div>;
  }

  const t = stats.totals;
  const decided = t.wins + t.losses + t.draws;
  const winRate = decided ? Math.round((t.wins / decided) * 100) : null;
  const reviewedAccuracies = stats.games
    .filter((g) => g.accuracy != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((g) => g.accuracy as number);

  return (
    <div className="page progress">
      <div className="page-head">
        <div>
          <h1>Progress</h1>
          <p className="hint">
            Everything below comes from the games you played here. Reviews fill in the
            accuracy numbers automatically.
          </p>
        </div>
      </div>

      <div className="tiles">
        <div className="tile"><b>{t.games}</b><span>games</span></div>
        <div className="tile">
          <b>{winRate != null ? `${winRate}%` : "—"}</b>
          <span>win rate ({t.wins}W {t.losses}L {t.draws}D)</span>
        </div>
        <div className="tile">
          <b>{t.accuracyAvg != null ? t.accuracyAvg : "—"}</b>
          <span>avg accuracy ({t.reviewed} reviewed)</span>
        </div>
        <div className="tile">
          <b>{(t.counts.blunder ?? 0) + (t.counts.mistake ?? 0)}</b>
          <span>blunders + mistakes</span>
        </div>
      </div>

      {reviewedAccuracies.length > 0 && (
        <section className="card">
          <h1>Accuracy over time</h1>
          <Trend values={reviewedAccuracies} />
        </section>
      )}

      <div className="progress-cols">
        <section className="card">
          <h1>What you keep getting wrong</h1>
          {stats.patterns.length === 0 && (
            <p className="hint">No recurring mistakes found yet. Reviews tag them automatically.</p>
          )}
          {stats.patterns.map((p) => (
            <div className="pattern-row" key={p.key}>
              <b>{REASON_LABEL[p.key] ?? p.key}</b>
              <span>{p.count}× across {p.games} game{p.games > 1 ? "s" : ""}</span>
              <button onClick={onPractice}>Practice</button>
            </div>
          ))}
        </section>

        <section className="card">
          <h1>Openings you play</h1>
          {stats.openings.length === 0 && <p className="hint">No openings recorded yet.</p>}
          <table className="table">
            <thead>
              <tr><th>Opening</th><th>Gms</th><th>W-L-D</th></tr>
            </thead>
            <tbody>
              {stats.openings.map((o) => (
                <tr key={o.name}>
                  <td>{o.name}</td>
                  <td>{o.games}</td>
                  <td>{o.wins}-{o.losses}-{o.draws}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <h1>Recent games</h1>
        <div className="games-list">
          {stats.games.map((g) => (
            <div className="game-row" key={g.file}>
              <span className={`outcome ${g.outcome ?? "na"}`}>
                {g.outcome == null ? "·" : g.outcome === "win" ? "W" : g.outcome === "loss" ? "L" : "D"}
              </span>
              <span className="game-what">
                vs {g.opponent} <em>as {g.color}</em>
                {g.opening && <em> · {g.opening}</em>}
              </span>
              <span className="game-badges">
                {(["blunder", "mistake", "inaccuracy"] as Badge[]).map((b) =>
                  g.counts[b] ? (
                    <span key={b} style={{ color: BADGE[b].color }}>
                      {BADGE[b].glyph} {g.counts[b]}
                    </span>
                  ) : null,
                )}
              </span>
              <span className="game-acc">{g.accuracy != null ? `${g.accuracy}` : ""}</span>
              <span className="game-date">{g.date}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
