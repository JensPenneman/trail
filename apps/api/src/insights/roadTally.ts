import {
  type InsightsWayFamily,
  type InsightsWayKind,
  wayFamilies,
} from "@trail/contracts/insights";
import { type WayKind, wayKinds } from "@trail/contracts/transport";
import { wayFamilyOf } from "../processing/wayFamily";
import type { InsightMove } from "./insightMoves";
import { roundMetres, shareOf } from "./insightsRounding";

/** Distance by kind of way, and how much of it had map data. */
export interface RoadTally {
  distanceM: number;
  /** The part on moves with way kind shares (`features.wayKinds`). */
  mappedM: number;
  kinds: Map<WayKind, number>;
}

export const emptyRoadTally = (): RoadTally => ({ distanceM: 0, mappedM: 0, kinds: new Map() });

/**
 * Counts a stretch of a move by its way kind shares (docs/architecture.md
 * §17.3): every kind gets its share of the distance. Shares are stored
 * rounded, so they are scaled to add up to the whole. A move without them —
 * no map data, or worked out before version 2 of the inference — counts
 * towards the distance only.
 */
export function tallyRoads(
  tally: RoadTally,
  distanceM: number,
  shares: InsightMove["wayKinds"],
): void {
  tally.distanceM += distanceM;
  if (shares === null || distanceM <= 0) return;
  let total = 0;
  for (const kind of wayKinds) {
    const share = shares[kind];
    if (typeof share === "number" && Number.isFinite(share) && share > 0) total += share;
  }
  if (total <= 0) return;
  tally.mappedM += distanceM;
  for (const kind of wayKinds) {
    const share = shares[kind];
    if (typeof share !== "number" || !Number.isFinite(share) || share <= 0) continue;
    tally.kinds.set(kind, (tally.kinds.get(kind) ?? 0) + (distanceM * share) / total);
  }
}

/** The kinds travelled on, in the order of `wayKinds`, each with its part of the mapped distance. */
export function kindRows(tally: RoadTally): InsightsWayKind[] {
  return wayKinds.flatMap((kind) => {
    const distance = tally.kinds.get(kind) ?? 0;
    return distance > 0
      ? [{ kind, distanceM: roundMetres(distance), share: shareOf(distance, tally.mappedM) }]
      : [];
  });
}

/** The same by family (`wayFamilyOf`), in the order of `wayFamilies`. */
export function familyRows(tally: RoadTally): InsightsWayFamily[] {
  const byFamily = new Map<string, number>();
  for (const [kind, distance] of tally.kinds) {
    const family = wayFamilyOf(kind);
    byFamily.set(family, (byFamily.get(family) ?? 0) + distance);
  }
  return wayFamilies.flatMap((family) => {
    const distance = byFamily.get(family) ?? 0;
    return distance > 0
      ? [{ family, distanceM: roundMetres(distance), share: shareOf(distance, tally.mappedM) }]
      : [];
  });
}
