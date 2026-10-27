import { type TransportMode, transportModes } from "@trail/contracts/transport";

/** More series than this and the smallest fold into one: past seven, colours stop telling apart. */
const maxSeries = 7;

/**
 * The modes a chart draws on their own, in the fixed order of the modes (a
 * colour belongs to a mode, never to a rank), and the ones it folds into
 * "Other modes": up to seven drawn, else the six with the most distance.
 */
export function foldModes(modes: readonly { mode: TransportMode; distanceM: number }[]): {
  shown: TransportMode[];
  folded: TransportMode[];
} {
  const largestFirst = [...modes].sort((a, b) => b.distanceM - a.distanceM);
  const kept = modes.length <= maxSeries ? largestFirst : largestFirst.slice(0, maxSeries - 1);
  const keptModes = new Set(kept.map((entry) => entry.mode));
  return {
    shown: transportModes.filter((mode) => keptModes.has(mode)),
    folded: transportModes.filter(
      (mode) => !keptModes.has(mode) && modes.some((entry) => entry.mode === mode),
    ),
  };
}
