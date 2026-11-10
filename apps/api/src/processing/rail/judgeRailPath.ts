import { haversineM } from "../../tracks/haversine";
import type { KeptPoint } from "../keptPoint";
import type { RailPathVerdict, RailPoint } from "../pipelineTypes";
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
 * - routes: too little of the aligned length followed the network, or a leg
 *   drawn straight is longer than `maxBridgedM`;
 * - offsets: the points that are no outliers lie too far from the line (median
 *   and p90 of z = offset over sigma, median offset in metres), time-weighted;
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
): RailPathVerdict {
  let lengthM = 0;
  let coveredM = 0;
  let alignedM = 0;
  let routedM = 0;
  let longestBridgedM = 0;
  let steps = 0;
  let totalS = 0;
  let outlierS = 0;
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
    const seconds = before === undefined ? 0 : Math.max(0, point.t - before.t);
    if (before !== undefined && placeBefore !== undefined) {
      const chord = haversineM(before, point);
      lengthM += chord;
      if (place.run >= 0 && place.run === placeBefore.run) coveredM += chord;
      alignedM += place.legM;
      if (place.routed) routedM += place.legM;
    }
    // The leg into the part's first point belongs to the segment before it: it is no leg of this part.
    if (before !== undefined) longestBridgedM = Math.max(longestBridgedM, place.bridgedLegM);
    totalS += seconds;
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
  } else if (routedShare < config.minRoutedShare || longestBridgedM > config.maxBridgedM) {
    status = "poor";
    reason = "routes";
  } else if (
    medianZ > config.maxMedianZ ||
    p90Z > config.maxP90Z ||
    medianOffsetM > config.maxMedianOffsetM
  ) {
    status = "poor";
    reason = "offsets";
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
    lengthM: Math.round(lengthM),
  };
}
