import type { InsightsPeriod, InsightsRoads } from "@trail/contracts/insights";
import type { TransportMode } from "@trail/contracts/transport";
import { hourParts } from "./hourParts";
import type { InsightMove } from "./insightMoves";
import { roundMetres } from "./insightsRounding";
import type { LocalHour } from "./localHours";
import { modesIn } from "./modesIn";
import { emptyRoadTally, familyRows, kindRows, tallyRoads } from "./roadTally";

/**
 * The ways travelled on (docs/architecture.md §8.7): distance by kind of way
 * and by family, of one mode or all, prorated over the period's hours; the
 * shares are of the distance with map data.
 */
export function buildRoads(input: {
  timezone: string;
  period: InsightsPeriod;
  mode: TransportMode | null;
  hours: readonly LocalHour[];
  moves: readonly InsightMove[];
  pending: boolean;
}): InsightsRoads {
  const tally = emptyRoadTally();
  for (const move of input.moves) {
    if (input.mode !== null && move.mode !== input.mode) continue;
    for (const part of hourParts(move, input.hours))
      tallyRoads(tally, part.distanceM, move.wayKinds);
  }
  return {
    timezone: input.timezone,
    period: input.period,
    mode: input.mode,
    modes: modesIn(input.moves, input.hours),
    distanceM: roundMetres(tally.distanceM),
    mappedM: roundMetres(tally.mappedM),
    kinds: kindRows(tally),
    families: familyRows(tally),
    pending: input.pending,
  };
}
