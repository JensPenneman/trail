import type { TransportMode } from "@trail/contracts/transport";
import { extractFeatures } from "./extractFeatures";
import type { MoveSeries } from "./moveSeries";
import type { ManualTrip, ModeVerdict, MoveFeatures } from "./pipelineTypes";
import type { ProcessingConfig } from "./processingConfig";
import { scoreModes } from "./scoreModes";

/** A part of a move with one mode: positions in the move (inclusive), shared with its neighbours. */
export interface ScoredPart {
  first: number;
  last: number;
  features: MoveFeatures;
  verdict: ModeVerdict;
}

/**
 * What a window's winner says for cutting: on foot, on a bike, or in a vehicle.
 * Changing between vehicles needs a transfer — on foot or at a stop — so a
 * change of vehicle alone (a bus that looks like a car between its stops) never
 * cuts a move; the part as a whole decides which vehicle it was.
 */
type Family = "foot" | "cycle" | "vehicle";

const familyOf = (mode: TransportMode): Family | null => {
  switch (mode) {
    case "walking":
    case "running":
      return "foot";
    case "cycling":
      return "cycle";
    case "stationary":
    case "unknown":
      return null;
    default:
      return "vehicle";
  }
};

interface Run {
  label: Family;
  /** Positions in the move. */
  first: number;
  last: number;
}

/** The position of the point nearest to `t` (the earlier one on a tie). */
function positionNear(series: MoveSeries, t: number): number {
  const { points } = series;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((points[middle]?.t ?? 0) < t) low = middle + 1;
    else high = middle;
  }
  const after = points[low];
  const before = points[low - 1];
  if (before !== undefined && after !== undefined && t - before.t <= after.t - t) return low - 1;
  return low;
}

/** Scores points `first..last` of a move as one part, without cutting it. */
export function scorePart(
  series: MoveSeries,
  first: number,
  last: number,
  trips: readonly ManualTrip[],
  config: ProcessingConfig,
): ScoredPart {
  const features = extractFeatures(series, { first, last, withEnds: true }, trips, config.features);
  return { first, last, features, verdict: scoreModes(features, config) };
}

/**
 * Cuts a move where its mode changes (docs/architecture.md §17.3, inferred,
 * step 4): a 3-minute window slides along the move in 30-second steps and is
 * scored like a move; a change of the winner's family (on foot, bike,
 * vehicle) that lasts at least 2 minutes or 500 m cuts the move (walk → train
 * → walk). Pauses (and windows too unsure to have a winner) never decide a
 * change: they join the run after them, so waiting on the platform counts
 * towards the train. Shorter runs merge into their longer neighbour. Every
 * part is then scored on its own, and neighbouring parts that end up with the
 * same mode are joined again.
 */
export function splitMove(
  series: MoveSeries,
  trips: readonly ManualTrip[],
  config: ProcessingConfig,
): ScoredPart[] {
  const { points } = series;
  const settings = config.splitting;
  const lastPosition = points.length - 1;
  const start = points[0];
  const end = points[lastPosition];
  if (start === undefined || end === undefined || lastPosition < 2) {
    return [scorePart(series, 0, Math.max(0, lastPosition), trips, config)];
  }
  const duration = end.t - start.t;
  if (duration < 2 * settings.minRunS) return [scorePart(series, 0, lastPosition, trips, config)];

  // Window labels; null for pauses and windows without a winner.
  const half = settings.windowS / 2;
  const centres: number[] = [];
  const labels: (Family | null)[] = [];
  for (
    let centre = start.t + half;
    centre <= end.t - half + settings.strideS / 2;
    centre += settings.strideS
  ) {
    let first = positionNear(series, centre - half);
    let last = positionNear(series, centre + half);
    if ((points[first]?.t ?? 0) > centre - half && first > 0) first -= 1;
    if ((points[last]?.t ?? 0) < centre + half && last < lastPosition) last += 1;
    if (last <= first) last = Math.min(lastPosition, first + 1);
    const features = extractFeatures(
      series,
      { first, last, withEnds: false },
      trips,
      config.features,
    );
    const verdict = scoreModes(features, config);
    centres.push(centre);
    labels.push(features.speed.p85 < settings.pauseKmh ? null : familyOf(verdict.mode));
  }
  // A pause belongs to what comes after it; trailing pauses to what came before.
  let next: Family | null = null;
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    if (labels[index] === null) labels[index] = next;
    else next = labels[index] ?? null;
  }
  let previous: Family | null = null;
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] === null) labels[index] = previous;
    else previous = labels[index] ?? null;
  }
  if (labels.every((label) => label === null))
    return [scorePart(series, 0, lastPosition, trips, config)];

  // Runs of one label, cut halfway between the windows where the label changes.
  const runs: Run[] = [];
  for (const [index, label] of labels.entries()) {
    if (label === null) continue;
    const current = runs.at(-1);
    if (current !== undefined && current.label === label) continue;
    const centre = centres[index] ?? start.t;
    const cut = index === 0 ? 0 : positionNear(series, centre - settings.strideS / 2);
    if (current !== undefined) {
      if (cut <= current.first || cut >= lastPosition) continue;
      current.last = cut;
    }
    runs.push({ label, first: current === undefined ? 0 : cut, last: lastPosition });
  }

  const lengthOf = (run: Run) => {
    let distance = 0;
    for (let k = run.first + 1; k <= run.last; k += 1) distance += series.distance[k] ?? 0;
    return { seconds: (points[run.last]?.t ?? 0) - (points[run.first]?.t ?? 0), distance };
  };
  const isShort = (run: Run) => {
    const { seconds, distance } = lengthOf(run);
    return seconds < settings.minRunS && distance < settings.minRunM;
  };
  // Short runs merge into their longer neighbour, shortest first.
  for (;;) {
    if (runs.length < 2) break;
    let shortest = -1;
    for (const [index, run] of runs.entries()) {
      if (!isShort(run)) continue;
      if (shortest < 0 || lengthOf(run).seconds < lengthOf(runs[shortest] ?? run).seconds)
        shortest = index;
    }
    if (shortest < 0) break;
    const run = runs[shortest];
    const before = runs[shortest - 1];
    const after = runs[shortest + 1];
    if (run === undefined) break;
    const intoBefore =
      before !== undefined &&
      (after === undefined || lengthOf(before).seconds >= lengthOf(after).seconds);
    if (intoBefore && before !== undefined) before.last = run.last;
    else if (after !== undefined) after.first = run.first;
    runs.splice(shortest, 1);
  }

  // Score every part on its own; join neighbours that agree.
  const parts = runs.map((run) => scorePart(series, run.first, run.last, trips, config));
  for (let index = 1; index < parts.length; ) {
    const before = parts[index - 1];
    const part = parts[index];
    if (before !== undefined && part !== undefined && before.verdict.mode === part.verdict.mode) {
      parts.splice(index - 1, 2, scorePart(series, before.first, part.last, trips, config));
      index = Math.max(1, index - 1);
    } else {
      index += 1;
    }
  }
  return parts;
}
