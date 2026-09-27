import { winPct } from "./format";

interface Props {
  cp: number | null;          // white POV
  orientation: "white" | "black";
}

export default function EvalBar({ cp, orientation }: Props) {
  const share = winPct(cp ?? 0);                    // white's win probability, 0-100
  const whiteAtBottom = orientation === "white";
  return (
    <div className="evalbar" title={`eval ${(share - 50).toFixed(0)}%`}>
      <div
        className={"evalbar-fill" + (whiteAtBottom ? "" : " top")}
        style={{ height: `${share}%` }}
      />
      <div className="evalbar-mid" />
    </div>
  );
}
