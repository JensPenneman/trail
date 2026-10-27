import { heatCellZooms } from "./heatCellLevels";

/**
 * The stored levels of one device whose cells miss points, from the device's
 * total count per level (a level without cells is 0): every level below the
 * highest total. Uploads and rebuilds write every level in one statement under
 * the device's lock, so no level ever holds more points than the device has;
 * a level falls behind when it was not kept — a level a release added (20)
 * misses the points uploaded before it, after a rollback to a release without
 * it that release's uploads skip it and its rebuilds drop it, and a level that
 * lost cells some other way is short too.
 */
export function levelsToRebuild(totals: ReadonlyMap<number, number>): number[] {
  const highest = Math.max(0, ...heatCellZooms.map((level) => totals.get(level) ?? 0));
  if (highest === 0) return [];
  return heatCellZooms.filter((level) => (totals.get(level) ?? 0) < highest);
}
