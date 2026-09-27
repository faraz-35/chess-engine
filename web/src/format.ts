import { MATE } from "./types";

export function fmtEval(cp: number | null, color: "white" | "black"): string {
  if (cp == null) return "—";
  const v = color === "black" ? -cp : cp;
  if (v >= MATE - 20_000) return `#${Math.ceil((MATE - v) / 100)}`;
  if (v <= -(MATE - 20_000)) return `#-${Math.ceil((MATE + v) / 100)}`;
  return (v / 100).toFixed(1);
}

export function moveLabel(rec: { ply: number; san: string; byEngine: boolean }): string {
  const num = Math.floor(rec.ply / 2) + 1;
  return rec.ply % 2 === 0 ? `${num}. ${rec.san}` : `${num}… ${rec.san}`;
}

export function winPct(cp: number): number {
  const v = Math.max(-MATE, Math.min(MATE, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * v)) - 1);
}
