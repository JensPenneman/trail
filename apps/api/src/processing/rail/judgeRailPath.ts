import type { ChosenMode } from "@trail/contracts/transport";
import { haversineM } from "../../tracks/haversine";
import type { KeptPoint } from "../keptPoint";
import { wayClassOf } from "../mapData";
import type { MappedPoint, RailPathVerdict, RailPoint } from "../pipelineTypes";
import type { RailJudgeConfig } from "../processingConfig";
import { weightedQuantile } from "../weightedQuantile";

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
/** NaN (nothing to measure) reads as 0 in the verdict; the decision treats it as failing before it gets here. */
const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/**
 * Whether the rail line of a part of a move may be drawn
 * (docs/architecture.md §17.3, "Along the rails"). `points` and `rail` are the
 * part's kept points and their rail places, first to last. The first check
 * that fails names the reason, in this order:
 *
 * - short: under `minLengthM` (chords of the averaged points) or `minSteps`;
 * - no_rail / coverage: the share of the length inside rail runs is under
 *   `noRailShare` (there is no railway there) or `minCoveredShare`;
 * - routes: too little of the aligned length followed the network, a leg
 *   drawn straight is longer than `maxBridgedM` or implies more than
 *   `maxBridgedSpeedMs` (the connector between two runs of the part counts as
 *   such a leg);
 * - offsets: the points that are no outliers lie too far from the line (median
 *   and p90 of z = offset over sigma, median offset in metres), time-weighted;
 * - road: where a mapped match exists, most of the part's duration is placed
 *   on street ways and those places are nearer than the rail places by more
 *   than the fixes' accuracy (a car on a road beside the railway); never for a
 *   part a person set to train;
 * - outliers: too much of the part's duration was spent as outliers.
 *
 * A car on a motorway 300 m beside the rails has no rail in reach (no run),
 * or tracks at a distance that fails `offsets`: never `aligned`. The numbers
 * are kept in the verdict, rounded, without coordinates, for tuning.
 */
export function judgeRailPath(
  points: readonly KeptPoint[],
  rail: readonly RailPoint[],
  config: RailJudgeConfig,
  source: "cache" | "region" | null,
  /** The part's mapped points, where the mapped level matched it (the cache's data); null: none to compare with. */
  mapped: readonly (MappedPoint | null)[] | null = null,
  /** The part's mode after the corrections: a person's train is never refused for a road. */
  modeUser: ChosenMode | null = null,
): RailPathVerdict {
  let lengthM = 0;
  let coveredM = 0;
  let alignedM = 0;
  let routedM = 0;
  let longestBridgedM = 0;
  let bridgedMaxSpeedMs = 0;
  let matched = 0;
  let roadS = 0;
  const roadRail: number[] = [];
  const roadSnap: number[] = [];
  const roadSigma: number[] = [];
  const roadWeights: number[] = [];
  // The last point placed in a run, for the straight leg to the next run's first place.
  let lastPlaced: { point: KeptPoint; run: number } | null = null;
  const standing = new Set<number>();
  let steps = 0;
  let totalS = 0;
  let outlierS = 0;
  let leadingBefore = false;
  const zs: number[] = [];
  const offsets: number[] = [];
  const weights: number[] = [];
  for (const [position, point] of points.entries()) {
    const place = rail[position];
    if (place === undefined) continue;
    if (place.step) steps += 1;
    const before = points[position - 1];
    const placeBefore = rail[position - 1];
    // A point weighs the time since the one before; the part's first point starts it and weighs nothing.
    let seconds = before === undefined ? 0 : Math.max(0, point.t - before.t);
    if (place.run >= 0 && !standing.has(place.run)) {
      if (place.outlier) {
        // An outlier before the first point the path stands on has no line to be since: the time up to
        // the point after it is what the part spent before the line begins.
        const next = points[position + 1];
        seconds = next === undefined ? 0 : Math.max(0, next.t - point.t);
        leadingBefore = true;
      } else {
        standing.add(place.run);
        // The interval from the leading outlier to this point is already the outlier's.
        if (leadingBefore) seconds = 0;
        leadingBefore = false;
      }
    } else {
      leadingBefore = false;
    }
    if (before !== undefined && placeBefore !== undefined) {
      const chord = haversineM(before, point);
      lengthM += chord;
      if (place.run >= 0 && place.run === placeBefore.run) coveredM += chord;
      alignedM += place.legM;
      if (place.routed) routedM += place.legM;
    }
    // The leg into the part's first point belongs to the segment before it: it is no leg of this part.
    if (before !== undefined) {
      longestBridgedM = Math.max(longestBridgedM, place.bridgedLegM);
      bridgedMaxSpeedMs = Math.max(bridgedMaxSpeedMs, place.bridgedSpeedMs);
    }
    // Two runs of the part are joined by a straight line: a leg of its own, judged as the others.
    if (place.run >= 0) {
      if (lastPlaced !== null && lastPlaced.run !== place.run) {
        const connectorM = haversineM(lastPlaced.point, point);
        longestBridgedM = Math.max(longestBridgedM, connectorM);
        bridgedMaxSpeedMs = Math.max(
          bridgedMaxSpeedMs,
          connectorM / Math.max(1, point.t - lastPlaced.point.t),
        );
      }
      lastPlaced = { point, run: place.run };
    }
    totalS += seconds;
    const match = mapped?.[position];
    if (match !== undefined && match !== null && match.wayKind !== null && place.offsetM !== null) {
      matched += 1;
      if (
        before !== undefined &&
        place.run >= 0 &&
        !place.outlier &&
        wayClassOf(match.wayKind) === "street" &&
        match.snapM !== null
      ) {
        roadS += seconds;
        roadRail.push(place.offsetM);
        roadSnap.push(match.snapM);
        roadSigma.push(Math.max(point.accuracy, config.roadMinSigmaM));
        roadWeights.push(seconds);
      }
    }
    if (place.run >= 0 && place.outlier) outlierS += seconds;
    if (place.run >= 0 && !place.outlier && place.z !== null && place.offsetM !== null) {
      zs.push(place.z);
      offsets.push(place.offsetM);
      weights.push(seconds);
    }
  }
  // A part whose points share one timestamp has no duration to weigh by.
  const weighted = weights.some((weight) => weight > 0) ? weights : weights.map(() => 1);
  const coveredShare = lengthM > 0 ? coveredM / lengthM : 0;
  const routedShare = alignedM > 0 ? routedM / alignedM : 0;
  const medianZ = finite(weightedQuantile(zs, weighted, 0.5));
  const p90Z = finite(weightedQuantile(zs, weighted, 0.9));
  const medianOffsetM = finite(weightedQuantile(offsets, weighted, 0.5));
  const outlierShare = totalS > 0 ? outlierS / totalS : 0;
  const roadShare = totalS > 0 ? roadS / totalS : 0;
  // Time-weighted medians of the points compared; all-zero weights (one timestamp) fall back to counts.
  const roadW = roadWeights.some((weight) => weight > 0) ? roadWeights : roadWeights.map(() => 1);
  const roadRailM = finite(weightedQuantile(roadRail, roadW, 0.5));
  const roadSnapM = finite(weightedQuantile(roadSnap, roadW, 0.5));
  const roadMarginM = Math.max(
    config.roadMinMarginM,
    config.roadMarginSigmas * finite(weightedQuantile(roadSigma, roadW, 0.5)),
  );

  let status: RailPathVerdict["status"] = "aligned";
  let reason: RailPathVerdict["reason"] = "ok";
  if (lengthM < config.minLengthM || steps < config.minSteps) {
    status = "poor";
    reason = "short";
  } else if (coveredShare < config.noRailShare) {
    status = "no_rail";
    reason = "no_rail";
  } else if (coveredShare < config.minCoveredShare) {
    status = "poor";
    reason = "coverage";
  } else if (
    routedShare < config.minRoutedShare ||
    longestBridgedM > config.maxBridgedM ||
    bridgedMaxSpeedMs > config.maxBridgedSpeedMs
  ) {
    status = "poor";
    reason = "routes";
  } else if (
    medianZ > config.maxMedianZ ||
    p90Z > config.maxP90Z ||
    medianOffsetM > config.maxMedianOffsetM
  ) {
    status = "poor";
    reason = "offsets";
  } else if (
    modeUser !== "train" &&
    roadShare > config.maxRoadShare &&
    roadRailM - roadSnapM > roadMarginM
  ) {
    status = "poor";
    reason = "road";
  } else if (outlierShare > config.maxOutlierShare) {
    status = "poor";
    reason = "outliers";
  }
  return {
    status,
    reason,
    source,
    coveredShare: round(coveredShare, 3),
    routedShare: round(routedShare, 3),
    medianZ: round(medianZ, 2),
    p90Z: round(p90Z, 2),
    medianOffsetM: round(medianOffsetM, 1),
    outlierShare: round(outlierShare, 3),
    roadShare: round(roadShare, 3),
    roadRailM: round(roadRailM, 1),
    roadSnapM: round(roadSnapM, 1),
    roadMarginM: round(roadMarginM, 1),
    mapped: matched > 0,
    bridgedMaxSpeedMs: round(bridgedMaxSpeedMs, 1),
    lengthM: Math.round(lengthM),
  };
}
