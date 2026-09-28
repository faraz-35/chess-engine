import { BADGE, REASON_LABEL, type Badge, type GameState } from "./types";

interface Props {
  session: GameState;
  onDismiss: () => void;
  onNewGame: () => void;
  onPractice: () => void;
}

export default function GameEnd({ session, onDismiss, onNewGame, onPractice }: Props) {
  const s = session.summary;
  const mistakes = session.moves.filter(
    (m) => !m.byEngine && (m.badge === "mistake" || m.badge === "blunder"),
  ).length;
  const won = session.result
    ? session.result === "1/2-1/2" ? "draw" : ((session.result === "1-0") === (session.playerColor === "white")) ? "win" : "loss"
    : session.resigned ? "loss" : "draw";
  const title = won === "win" ? "You won" : won === "loss" ? (session.resigned ? "You resigned" : "You lost") : "Draw";

  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <span className={`modal-verdict ${won}`}>{title}</span>
        {session.opening && <p className="modal-open">{session.opening.eco} {session.opening.name}</p>}
        {s && (
          <div className="modal-stats">
            <div className="modal-stat">
              <b>{s.accuracy != null ? s.accuracy : "—"}</b>
              <span>accuracy</span>
            </div>
            <div className="modal-stat">
              <b>{mistakes}</b>
              <span>mistakes to fix</span>
            </div>
            <div className="modal-stat">
              <b>{s.patterns.length > 0 ? REASON_LABEL[s.patterns[0].key] ?? s.patterns[0].key : "—"}</b>
              <span>top mistake</span>
            </div>
          </div>
        )}
        {s && (s.counts.blunder ?? 0) + (s.counts.mistake ?? 0) > 0 && (
          <div className="modal-counts">
            {(["blunder", "mistake", "inaccuracy"] as Badge[]).map((b) =>
              s.counts[b] ? (
                <span key={b} style={{ color: BADGE[b].color }}>
                  {BADGE[b].glyph} {s.counts[b]} {BADGE[b].label.toLowerCase()}{s.counts[b] > 1 ? "s" : ""}
                </span>
              ) : null,
            )}
          </div>
        )}
        <div className="modal-actions">
          {mistakes > 0 && (
            <button className="primary" onClick={onPractice}>
              Practice your {mistakes} mistake{mistakes > 1 ? "s" : ""}
            </button>
          )}
          <button onClick={onDismiss}>Walk through the review</button>
          <button onClick={onNewGame}>New game</button>
        </div>
      </div>
    </div>
  );
}
