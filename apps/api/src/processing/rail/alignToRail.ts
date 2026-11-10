import type { KeptPoint } from "../keptPoint";
import { legOf, placeOnLeg, pointAtAlong, verticesBetween } from "../matchLegs";
import type { RailPoint } from "../pipelineTypes";
import type { RailConfig } from "../processingConfig";
import type { WayCandidate } from "../wayIndex";
import type { RailContext } from "./railNetwork";

/** What the alignment did, for the performance bounds and the logs. */
export interface RailStats {
  /** Points that entered the model. */
  steps: number;
  /** Runs kept (long enough). */
  runs: number;
  /** Route searches (Dijkstra runs). */
  searches: number;
  /** Of those, the ones from a step before the one just before (steps skipped as outliers). */
  skipSearches: number;
  /** Nodes those searches settled. */
  settledNodes: number;
  /** The largest distance bound a search was given, metres (never past `maxRouteM`). */
  maxSearchBoundM: number;
  /** The way changes a search was allowed (`maxHops`, the limit, not what a search used; 0 when none ran). */
  maxSearchHops: number;
}

export interface RailAlignment {
  /** One per input point. */
  points: RailPoint[];
  stats: RailStats;
}

interface State {
  candidate: WayCandidate;
  emission: number;
}

interface Step {
  /** Position of the point in the stretch. */
  position: number;
  t: number;
  x: number;
  y: number;
  sigma: number;
  states: State[];
}

const unplaced = (): RailPoint => ({
  lat: null,
  lon: null,
  wayId: null,
  run: -1,
  step: false,
  outlier: false,
  offsetM: null,
  z: null,
  routed: false,
  legM: 0,
  bridgedLegM: 0,
  bridgedSpeedMs: 0,
  path: null,
});

/**
 * Lays the points of a stretch on the railway (docs/architecture.md §17.3,
 * "Along the rails"): a second map-matching model that sees tracks only, so no
 * road, platform or footway competes, and a point with no track in reach is an
 * outlier that the line passes along the rails instead of a cheap step off the
 * network. Pure: kept points and a rail network in, a place per point out.
 *
 * 1. Steps: the first point, every one `stepM` on, the last; σ = max(accuracy,
 *    minSigmaM). Candidates: the nearest point of each track within
 *    clamp(radiusSigmas × σ, min, max), at most `maxCandidates`; emission
 *    ½(d/σ)², plus `servicePenalty` on a yard, siding or spur.
 * 2. Runs: consecutive steps with candidates. A run carries on across steps
 *    without one while that stretch lasts at most `maxOutlierS` and
 *    `maxOutlierM`; a run shorter than `minRunM` is dropped. A walk far from
 *    any track has no run and costs a grid lookup per step.
 * 3. Viterbi per run. Every step may also be an outlier (a fix that jumped
 *    onto another track or line and back): up to `maxOutlierSteps` in a row
 *    are skipped for `outlierCost` each, and their points lie along the leg
 *    between the steps on either side, as the points of a gap do. A
 *    transition is a route on the rail graph within
 *    min(maxRouteM, routeFactor × chord + slack, maxSpeedMs × seconds + slack)
 *    and `maxHops` way changes; its cost grows with |route − chord| and a
 *    little with a change of way. Without a route the leg costs `breakCost`
 *    and is drawn straight ("bridged"). Ties: lower cost, nearer candidate,
 *    lower way index, so the order of the map data never matters.
 * 4. Placement: the points between two steps are projected onto the leg and
 *    never lie behind the point before; outliers lie along the leg by their
 *    share of the time between the steps that bracket them.
 */
export function alignToRail(
  points: readonly KeptPoint[],
  context: RailContext,
  config: RailConfig,
  /** `prune: false` runs every search: a test's proof that the prune never changes a placed point. */
  options: { prune?: boolean } = {},
): RailAlignment {
  const prune = options.prune ?? true;
  const { index, network } = context;
  const projection = index.projection;
  const result: RailPoint[] = points.map(unplaced);
  const stats: RailStats = {
    steps: 0,
    runs: 0,
    searches: 0,
    skipSearches: 0,
    settledNodes: 0,
    maxSearchBoundM: 0,
    maxSearchHops: 0,
  };
  if (points.length < 2) return { points: result, stats };
  const xs = points.map((point) => projection.x(point.lon));
  const ys = points.map((point) => projection.y(point.lat));
  const sigmaOf = (position: number): number =>
    Math.max(points[position]?.accuracy ?? config.minSigmaM, config.minSigmaM);

  // Steps.
  const chosen: number[] = [];
  for (let position = 0; position < points.length; position += 1) {
    const previous = chosen.at(-1);
    if (
      previous === undefined ||
      position === points.length - 1 ||
      Math.hypot(
        (xs[position] ?? 0) - (xs[previous] ?? 0),
        (ys[position] ?? 0) - (ys[previous] ?? 0),
      ) >= config.stepM
    ) {
      chosen.push(position);
    }
  }
  stats.steps = chosen.length;
  const isStep = new Set(chosen);
  // Whether a point entered the model does not depend on a run: a part without one is short of steps no more than of rail.
  for (const position of chosen) {
    const entry = result[position];
    if (entry !== undefined) entry.step = true;
  }
  const sideServices = new Set(network.sideServices);
  const steps: Step[] = chosen.map((position) => {
    const sigma = sigmaOf(position);
    const radius = Math.min(
      config.maxRadiusM,
      Math.max(config.minRadiusM, config.radiusSigmas * sigma),
    );
    const x = xs[position] ?? 0;
    const y = ys[position] ?? 0;
    const states = index
      .candidates(x, y, radius, config.maxCandidates, context.kindMask)
      .map((candidate) => {
        const service = index.ways[candidate.way]?.service ?? null;
        const side = service !== null && sideServices.has(service);
        return {
          candidate,
          emission: 0.5 * (candidate.distance / sigma) ** 2 + (side ? config.servicePenalty : 0),
        };
      });
    return { position, t: points[position]?.t ?? 0, x, y, sigma, states };
  });

  // Runs: steps with candidates, joined across a bounded stretch without.
  const chord = (a: Step, b: Step): number => Math.hypot(b.x - a.x, b.y - a.y);
  const found: number[][] = [];
  let current: number[] = [];
  for (const [stepIndex, step] of steps.entries()) {
    if (step.states.length === 0) continue;
    const last = current.at(-1);
    const before = last === undefined ? undefined : steps[last];
    if (before !== undefined && last !== undefined && stepIndex - last > 1) {
      if (step.t - before.t > config.maxOutlierS || chord(before, step) > config.maxOutlierM) {
        found.push(current);
        current = [];
      }
    }
    current.push(stepIndex);
  }
  if (current.length > 0) found.push(current);
  const runLength = (stepIndexes: readonly number[]): number => {
    let length = 0;
    for (let k = 1; k < stepIndexes.length; k += 1) {
      const a = steps[stepIndexes[k - 1] ?? 0];
      const b = steps[stepIndexes[k] ?? 0];
      if (a !== undefined && b !== undefined) length += chord(a, b);
    }
    return length;
  };
  const runs = found.filter((run) => runLength(run) >= config.minRunM);
  stats.runs = runs.length;
  if (runs.length === 0) return { points: result, stats };

  const graph = context.graph();
  const settledBefore = graph.settledCount;
  const bound = (from: Step, to: Step): number =>
    Math.min(
      config.maxRouteM,
      config.routeFactor * chord(from, to) + config.routeSlackM,
      config.maxSpeedMs * Math.max(1, to.t - from.t) + config.routeSlackM,
    );

  const search = (
    source: WayCandidate,
    targets: WayCandidate[],
    from: Step,
    to: Step,
    skipping = false,
  ) => {
    const limit = bound(from, to);
    graph.search(source, targets, limit, config.maxHops);
    stats.searches += 1;
    if (skipping) stats.skipSearches += 1;
    stats.maxSearchBoundM = Math.max(stats.maxSearchBoundM, limit);
    stats.maxSearchHops = config.maxHops;
  };

  // A run an impossible leg cuts in two goes on as a run of its own, numbered next.
  const work = [...runs];
  for (let runNumber = 0; runNumber < work.length; runNumber += 1) {
    const run = work[runNumber];
    if (run === undefined) continue;
    // The steps the run keeps: all of them, until a step no leg can reach.
    let usable = run.length;
    // Viterbi, forward, over the run's steps.
    const cost: Float64Array[] = run.map(
      (stepIndex) => new Float64Array(steps[stepIndex]?.states.length ?? 0),
    );
    const back: Int32Array[] = run.map((stepIndex) =>
      new Int32Array(steps[stepIndex]?.states.length ?? 0).fill(-1),
    );
    const firstStep = steps[run[0] ?? 0];
    const firstCost = cost[0];
    if (firstStep !== undefined && firstCost !== undefined) {
      for (const [stateIndex, state] of firstStep.states.entries())
        firstCost[stateIndex] = state.emission;
    }
    // How many steps back the best way into a state came from: 1, or more when steps were skipped as outliers.
    const jump: Int8Array[] = run.map((stepIndex) =>
      new Int8Array(steps[stepIndex]?.states.length ?? 0).fill(1),
    );
    for (let k = 1; k < run.length; k += 1) {
      const to = steps[run[k] ?? 0];
      const here = cost[k];
      const pointers = back[k];
      const jumps = jump[k];
      if (to === undefined || here === undefined || pointers === undefined || jumps === undefined)
        continue;
      here.fill(Number.POSITIVE_INFINITY);
      pointers.fill(-1);
      const targets = to.states.map((state) => state.candidate);
      // The run may also begin here: the steps before it were outliers.
      if (k <= config.maxOutlierSteps) {
        for (const [toIndex, target] of to.states.entries()) {
          const total = k * config.outlierCost + target.emission;
          if (total < (here[toIndex] ?? Number.POSITIVE_INFINITY)) {
            here[toIndex] = total;
            pointers[toIndex] = -1;
          }
        }
      }
      for (let skipped = 0; skipped <= config.maxOutlierSteps && skipped < k; skipped += 1) {
        const before = cost[k - 1 - skipped];
        const from = steps[run[k - 1 - skipped] ?? 0];
        if (before === undefined || from === undefined) continue;
        const extra = skipped * config.outlierCost;
        // What a source must stay under to improve any target: a transition and an emission are never
        // negative, so one whose cost plus the outliers reaches the most a target could still be
        // improved by (what is known there less its emission) can improve none.
        let ceiling = Number.NEGATIVE_INFINITY;
        for (const [toIndex, target] of to.states.entries()) {
          ceiling = Math.max(
            ceiling,
            (here[toIndex] ?? Number.POSITIVE_INFINITY) - target.emission,
          );
        }
        const distance = chord(from, to);
        const beta = Math.max(config.betaMinM, config.betaChordFactor * distance);
        const speed = distance / Math.max(1, to.t - from.t);
        for (const [fromIndex, source] of from.states.entries()) {
          const base = before[fromIndex] ?? Number.POSITIVE_INFINITY;
          if (!Number.isFinite(base) || (prune && base + extra >= ceiling)) continue;
          search(source.candidate, targets, from, to, skipped > 0);
          for (const [toIndex, target] of to.states.entries()) {
            if (
              prune &&
              base + extra + target.emission >= (here[toIndex] ?? Number.POSITIVE_INFINITY)
            ) {
              continue;
            }
            const route = graph.distanceTo(target.candidate);
            // A straight leg faster than any train goes is a jump of the fix, not a ride: no leg at all.
            const transition = Number.isFinite(route)
              ? Math.abs(route - distance) / beta +
                (source.candidate.way === target.candidate.way ? 0 : config.wayChangeCost)
              : speed > config.maxSpeedMs
                ? Number.POSITIVE_INFINITY
                : config.breakCost;
            const total = base + extra + transition + target.emission;
            if (total < (here[toIndex] ?? Number.POSITIVE_INFINITY)) {
              here[toIndex] = total;
              pointers[toIndex] = fromIndex;
              jumps[toIndex] = skipped + 1;
            }
          }
        }
      }
      // No leg reaches this step (every way in is a straight leg no train could ride): the run ends before it.
      if (!here.some((value) => Number.isFinite(value))) {
        const rest = run.slice(k);
        if (runLength(rest) >= config.minRunM) work.splice(runNumber + 1, 0, rest);
        usable = k;
        break;
      }
    }

    // Backtrack: the steps the best path stands on, the ones it skipped left out. The path may
    // end on any of the last steps, each one left out costing an outlier.
    let best = { k: usable - 1, state: 0, total: Number.POSITIVE_INFINITY };
    for (let k = usable - 1; k >= Math.max(0, usable - 1 - config.maxOutlierSteps); k -= 1) {
      for (const [stateIndex, value] of (cost[k] ?? []).entries()) {
        const total = value + (usable - 1 - k) * config.outlierCost;
        if (total < best.total) best = { k, state: stateIndex, total };
      }
    }
    if (!Number.isFinite(best.total)) continue;
    const path: { k: number; state: number }[] = [{ k: best.k, state: best.state }];
    for (;;) {
      const here = path[path.length - 1];
      const pointer = here === undefined ? -1 : (back[here.k]?.[here.state] ?? -1);
      if (here === undefined || pointer < 0) break;
      path.push({ k: here.k - (jump[here.k]?.[here.state] ?? 1), state: pointer });
    }
    path.reverse();

    // Placement.
    const place = (
      position: number,
      spot: { x: number; y: number; way: number },
      extra: Partial<RailPoint>,
    ) => {
      const entry = result[position];
      if (entry === undefined) return;
      const offset = Math.hypot(spot.x - (xs[position] ?? 0), spot.y - (ys[position] ?? 0));
      entry.lat = projection.lat(spot.y);
      entry.lon = projection.lon(spot.x);
      entry.wayId = spot.way >= 0 ? (index.ways[spot.way]?.id ?? null) : null;
      entry.run = runNumber;
      entry.step = isStep.has(position);
      entry.offsetM = offset;
      entry.z = offset / sigmaOf(position);
      Object.assign(entry, extra);
    };
    const first = steps[run[path[0]?.k ?? 0] ?? 0];
    const firstState = first?.states[path[0]?.state ?? 0]?.candidate;
    if (first === undefined || firstState === undefined) continue;
    // Steps before the path's first one were outliers: they lie at the line's start.
    const startStep = steps[run[0] ?? 0];
    for (
      let position = startStep?.position ?? first.position;
      position < first.position;
      position += 1
    ) {
      place(position, firstState, { outlier: true });
    }
    place(first.position, firstState, {});
    for (let at = 1; at < path.length; at += 1) {
      const before = path[at - 1];
      const here = path[at];
      const from = steps[run[before?.k ?? 0] ?? 0];
      const to = steps[run[here?.k ?? 0] ?? 0];
      const source = from?.states[before?.state ?? 0]?.candidate;
      const target = to?.states[here?.state ?? 0]?.candidate;
      if (from === undefined || to === undefined || source === undefined || target === undefined)
        continue;
      search(source, [target], from, to);
      const route = graph.pathTo(target);
      // A leg without a route is drawn straight between the two places.
      const leg = legOf(route, source, target);
      const legEnd = leg.along.at(-1) ?? 0;
      const routed = route !== null;
      const bridgedLegM = routed ? 0 : legEnd;
      // For tuning: how fast the straight leg would have been travelled.
      const bridgedSpeedMs = routed ? 0 : chord(from, to) / Math.max(1, to.t - from.t);
      const hasOutliers = (run[here?.k ?? 0] ?? 0) - (run[before?.k ?? 0] ?? 0) > 1;
      const seconds = to.t - from.t;
      let along = 0;
      for (let position = from.position + 1; position <= to.position; position += 1) {
        const isEnd = position === to.position;
        let spot: { x: number; y: number; along: number; way: number };
        let outlier = false;
        if (isEnd) {
          spot = { x: target.x, y: target.y, along: legEnd, way: target.way };
        } else if (hasOutliers) {
          const share = seconds > 0 ? ((points[position]?.t ?? from.t) - from.t) / seconds : 0;
          spot = pointAtAlong(leg, Math.max(along, share * legEnd));
          outlier = true;
        } else {
          spot = placeOnLeg(leg, xs[position] ?? 0, ys[position] ?? 0, along);
        }
        const between = routed ? verticesBetween(leg, along, spot.along) : [];
        place(position, spot, {
          outlier,
          routed,
          legM: spot.along - along,
          bridgedLegM,
          bridgedSpeedMs,
          path:
            between.length === 0
              ? null
              : between.map(([x, y]) => [projection.lon(x), projection.lat(y)] as [number, number]),
        });
        along = spot.along;
      }
    }
    // Steps after the path's last one were outliers: they lie at the line's end.
    const lastOfPath = path.at(-1);
    const endStep = steps[run[lastOfPath?.k ?? 0] ?? 0];
    const endSpot = endStep?.states[lastOfPath?.state ?? 0]?.candidate;
    const lastStep = steps[run[usable - 1] ?? 0];
    if (endStep !== undefined && endSpot !== undefined && lastStep !== undefined) {
      for (let position = endStep.position + 1; position <= lastStep.position; position += 1) {
        place(position, endSpot, { outlier: true });
      }
    }
  }
  stats.settledNodes = graph.settledCount - settledBefore;
  return { points: result, stats };
}
