interface Props {
  evals: (number | null)[];   // white-advantage-up values, one per ply
  index: number | null;
  markers: number[];          // plies with mistakes/blunders
  onJump: (ply: number) => void;
}

export default function EvalGraph({ evals, index, markers, onJump }: Props) {
  const W = 100;
  const H = 40;
  const mid = H / 2;

  const toY = (cp: number | null) => {
    const v = Math.max(-600, Math.min(600, cp ?? 0)) / 600;
    return mid - v * (mid - 3);
  };

  const toX = (i: number) => (evals.length > 1 ? (i / (evals.length - 1)) * W : 0);
  const points = evals.map((cp, i) => `${toX(i).toFixed(1)},${toY(cp).toFixed(1)}`).join(" ");

  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const frac = (e.clientX - box.left) / box.width;
        onJump(Math.round(frac * (evals.length - 1)));
      }}
    >
      <line x1="0" x2={W} y1={mid} y2={mid} className="eval-mid" />
      {points && <polyline className="eval-line" points={points} />}
      {markers.map((ply) =>
        evals[ply] != null && evals.length > 1 ? (
          <circle key={ply} className="eval-marker" cx={toX(ply)} cy={toY(evals[ply])} r="1.6" />
        ) : null,
      )}
      {index != null && evals[index] != null && evals.length > 1 && (
        <circle className="eval-dot" cx={toX(index)} cy={toY(evals[index])} r="2.2" />
      )}
    </svg>
  );
}
