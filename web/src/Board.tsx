import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import "chessground/assets/chessground.base.css";
import { ARROW_COLORS } from "./types";

export interface Arrow {
  orig: string;
  dest: string;
  brush: string;
}

type CgApi = ReturnType<typeof Chessground>;
type CgSetConfig = Parameters<CgApi["set"]>[0];
type CgShape = Parameters<CgApi["setShapes"]>[0][number];
type CgKey = Parameters<CgApi["move"]>[0];

export interface StepMove {
  fen: string;   // the position AFTER the move (must equal props.fen to apply)
  preFen: string; // the position BEFORE it
  from: string;
  to: string;
}

interface Props {
  fen: string;
  dests: Record<string, string[]>;
  lastMove: [string, string] | null;
  orientation: "white" | "black";
  check: boolean;
  arrows: Arrow[];
  step?: StepMove | null;
  onMove?: (uci: string) => void;
}

function turnColor(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

export default function Board(props: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<CgApi | null>(null);
  const moveRef = useRef(props.onMove);
  moveRef.current = props.onMove;
  const appliedRef = useRef("");

  useEffect(() => {
    apiRef.current = Chessground(elRef.current!, {
      orientation: props.orientation,
      coordinates: true,
      animation: { duration: 250 },
      movable: { free: false, showDests: true },
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true },
      drawable: {
        enabled: true,
        brushes: {
          best: { key: "g", color: ARROW_COLORS.best, opacity: 0.85, lineWidth: 10 },
          threat: { key: "r", color: ARROW_COLORS.threat, opacity: 0.85, lineWidth: 10 },
          line: { key: "b", color: ARROW_COLORS.line, opacity: 0.65, lineWidth: 8 },
          book: { key: "t", color: ARROW_COLORS.book, opacity: 0.55, lineWidth: 7 },
          green: { key: "g", color: "#15781B", opacity: 1, lineWidth: 10 },
          red: { key: "r", color: "#882020", opacity: 1, lineWidth: 10 },
          blue: { key: "b", color: "#003088", opacity: 1, lineWidth: 10 },
          yellow: { key: "y", color: "#e68f00", opacity: 1, lineWidth: 10 },
        },
      },
    });
    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply position changes only — re-rendering with unchanged props must never
  // touch the board, or an in-flight drag would snap back to the old position.
  const signature = `${props.fen}|${props.lastMove?.join("") ?? "-"}|${Object.keys(props.dests).length}|${props.check ? 1 : 0}|${props.orientation}`;
  useEffect(() => {
    const api = apiRef.current;
    if (!api || signature === appliedRef.current) return;
    appliedRef.current = signature;
    const baseConfig = {
      fen: props.fen,
      turnColor: turnColor(props.fen),
      check: props.check ? true : undefined,
      lastMove: props.lastMove ?? undefined,
      orientation: props.orientation,
      movable: {
        free: false,
        color: "both",
        dests: new Map(Object.entries(props.dests)),
        showDests: true,
        events: { after: (orig: string, dest: string) => moveRef.current?.(orig + dest) },
      },
    } as unknown as CgSetConfig;
    // Stepping one move forward: show the position before it, then play the
    // move out so the piece visibly travels from its origin square.
    if (props.step && props.step.fen === props.fen) {
      api.set({ ...baseConfig, fen: props.step.preFen, check: undefined, lastMove: undefined });
      window.setTimeout(() => {
        apiRef.current?.move(props.step!.from as CgKey, props.step!.to as CgKey);
        apiRef.current?.set({
          lastMove: [props.step!.from, props.step!.to] as [string, string],
          check: props.check ? true : undefined,
        } as unknown as CgSetConfig);
      }, 30);
      return;
    }
    api.set(baseConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    apiRef.current?.setShapes(props.arrows as CgShape[]);
  }, [props.arrows]);

  return <div className="board" ref={elRef} />;
}
