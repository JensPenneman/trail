import { heatCellZooms } from "./heatCellLevels";

/** The finest level that every release has stored: the other levels are held against it. */
const referenceLevel = 18;

/**
 * The stored levels of one device whose cells miss points, from the device's
 * total count per level (a level without cells is 0): every level whose total
 * differs from level 18's — all of them when level 18 has none. Each point
 * adds one to every level, so the totals agree unless a level was not kept:
 * a level a release added (20) misses the points uploaded before it, and
 * after a rollback to a release without it, that release's uploads skip it
 * and its rebuilds drop it.
 */
export function levelsToRebuild(totals: ReadonlyMap<number, number>): number[] {
  if (totals.size === 0) return [];
  const reference = totals.get(referenceLevel);
  if (reference === undefined) return [...heatCellZooms];
  return heatCellZooms.filter((level) => (totals.get(level) ?? 0) !== reference);
}
