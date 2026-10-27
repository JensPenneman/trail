import type { InsightsPeriod, InsightsTime } from "@trail/contracts/insights";
import type { TransportMode } from "@trail/contracts/transport";
import { hourParts } from "./hourParts";
import type { InsightMove } from "./insightMoves";
import { roundMetres, roundSeconds } from "./insightsRounding";
import type { LocalHour } from "./localHours";
import { modesIn } from "./modesIn";

/**
 * When the moves happened (docs/architecture.md §8.7): time and distance in
 * every hour of every day of the week, prorated over the local hours of the
 * period, for one mode or all of them.
 */
export function buildTimeGrid(input: {
  timezone: string;
  period: InsightsPeriod;
  mode: TransportMode | null;
  hours: readonly LocalHour[];
  moves: readonly InsightMove[];
  pending: boolean;
}): InsightsTime {
  const cells = Array.from({ length: 7 * 24 }, () => ({ distanceM: 0, seconds: 0 }));
  for (const move of input.moves) {
    if (input.mode !== null && move.mode !== input.mode) continue;
    for (const part of hourParts(move, input.hours)) {
      const cell = cells[(part.hour.weekday - 1) * 24 + part.hour.hour];
      if (cell === undefined) continue;
      cell.distanceM += part.distanceM;
      cell.seconds += part.seconds;
    }
  }
  return {
    timezone: input.timezone,
    period: input.period,
    mode: input.mode,
    modes: modesIn(input.moves, input.hours),
    cells: cells.map((cell, index) => ({
      weekday: Math.floor(index / 24) + 1,
      hour: index % 24,
      distanceM: roundMetres(cell.distanceM),
      durationS: roundSeconds(cell.seconds),
    })),
    pending: input.pending,
  };
}
