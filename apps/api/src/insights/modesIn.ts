import { type TransportMode, transportModes } from "@trail/contracts/transport";
import type { InsightMove } from "./insightMoves";
import type { LocalHour } from "./localHours";

/** The modes of the moves that touch the period's hours, in the order of `transportModes`. */
export function modesIn(
  moves: readonly InsightMove[],
  hours: readonly LocalHour[],
): TransportMode[] {
  const first = hours[0]?.start ?? 0;
  const end = hours.at(-1)?.end ?? 0;
  const present = new Set<TransportMode>();
  for (const move of moves) {
    const inside =
      move.startMs < end &&
      (move.endMs > first || (move.endMs === move.startMs && move.startMs >= first));
    if (inside) present.add(move.mode);
  }
  return transportModes.filter((mode) => present.has(mode));
}
