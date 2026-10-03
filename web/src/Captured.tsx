import { capturedFromFen } from "./boardUtils";

// One side's haul: the enemy pieces gone from the board, plus the material
// lead when this side is ahead.
export default function Captured({ fen, side }: { fen: string; side: "white" | "black" }) {
  const { white, black, diff } = capturedFromFen(fen);
  const taken = side === "white" ? white : black;
  const lead = side === "white" ? diff : -diff;
  return (
    <div className="captured">
      {taken.map((t, i) => (
        <img
          key={i}
          className={side === "white" ? "dark" : ""}
          src={`/pieces/cburnett/${side === "white" ? "b" : "w"}${t.toUpperCase()}.svg`}
          alt=""
        />
      ))}
      {lead > 0 && <span>+{lead}</span>}
    </div>
  );
}
