import { surfaceGap } from "./bands";

/** One series' part of a stacked bar, along the value axis in px: `start` on the baseline side. */
interface StackPiece {
  series: number;
  start: number;
  end: number;
}

/**
 * Stacks a row's values along the value axis in series order (bottom-up, or
 * left to right), with the 2 px surface gap between neighbours taken half
 * from each, and drops slivers too thin to draw: their values stay in the
 * tooltip and the table.
 */
export function stackPieces(
  values: readonly number[],
  scale: (value: number) => number,
): StackPiece[] {
  const raw: StackPiece[] = [];
  let total = 0;
  for (const [series, value] of values.entries()) {
    if (value <= 0) continue;
    raw.push({ series, start: scale(total), end: scale(total + value) });
    total += value;
  }
  const half = surfaceGap / 2;
  const pieces: StackPiece[] = [];
  for (const [index, piece] of raw.entries()) {
    const direction = Math.sign(piece.end - piece.start);
    const start = index === 0 ? piece.start : piece.start + direction * half;
    const end = index === raw.length - 1 ? piece.end : piece.end - direction * half;
    if ((end - start) * direction >= 0.5) pieces.push({ series: piece.series, start, end });
  }
  return pieces;
}
