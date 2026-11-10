import type { KeptPoint } from "../keptPoint";
import { legOf, placeOnLeg, pointAtAlong, verticesBetween } from "../matchLegs";
import type { RailPoint } from "../pipelineTypes";
import type { RailConfig } from "../processingConfig";
import type { WayCandidate } from "../wayIndex";
import type { RailContext } from "./railNetwork";

/** What the alignment did, for the performance bounds and the logs. */
interface RailStats {
  /** Points that entered the model. */
  steps: number;
  /** Runs kept (long enough). */
  runs: number;
  /** Route searches (Dijkstra runs). */
  searches: number;
  /** Nodes those searches settled. */
  settledNodes: number;
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
 * 3. Viterbi per run. A transition is a route on the rail graph within
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
): RailAlignment {
  const { index, network } = context;
  const projection = index.projection;
  const result: RailPoint[] = points.map(unplaced);
  const stats: RailStats = { steps: 0, runs: 0, searches: 0, settledNodes: 0 };
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
  const runs = found.filter((run) => {
    let length = 0;
    for (let k = 1; k < run.length; k += 1) {
      const a = steps[run[k - 1] ?? 0];
      const b = steps[run[k] ?? 0];
      if (a !== undefined && b !== undefined) length += chord(a, b);
    }
    return length >= config.minRunM;
  });
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

  for (const [runNumber, run] of runs.entries()) {
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
    for (let k = 1; k < run.length; k += 1) {
      const from = steps[run[k - 1] ?? 0];
      const to = steps[run[k] ?? 0];
      const here = cost[k];
      const before = cost[k - 1];
      const pointers = back[k];
      if (
        from === undefined ||
        to === undefined ||
        here === undefined ||
        before === undefined ||
        pointers === undefined
      )
        continue;
      here.fill(Number.POSITIVE_INFINITY);
      const distance = chord(from, to);
      const beta = Math.max(config.betaMinM, config.betaChordFactor * distance);
      const limit = bound(from, to);
      const targets = to.states.map((state) => state.candidate);
      for (const [fromIndex, source] of from.states.entries()) {
        const base = before[fromIndex] ?? Number.POSITIVE_INFINITY;
        if (!Number.isFinite(base)) continue;
        graph.search(source.candidate, targets, limit, config.maxHops);
        stats.searches += 1;
        for (const [toIndex, target] of to.states.entries()) {
          const route = graph.distanceTo(target.candidate);
          const transition = Number.isFinite(route)
            ? Math.abs(route - distance) / beta +
              (source.candidate.way === target.candidate.way ? 0 : config.wayChangeCost)
            : config.breakCost;
          const total = base + transition + target.emission;
          if (total < (here[toIndex] ?? Number.POSITIVE_INFINITY)) {
            here[toIndex] = total;
            pointers[toIndex] = fromIndex;
          }
        }
      }
    }

    // Backtrack.
    const chosenState = new Int32Array(run.length);
    const lastCost = cost.at(-1);
    if (lastCost === undefined) continue;
    let best = 0;
    for (let stateIndex = 1; stateIndex < lastCost.length; stateIndex += 1) {
      if ((lastCost[stateIndex] ?? 0) < (lastCost[best] ?? 0)) best = stateIndex;
    }
    chosenState[run.length - 1] = best;
    for (let k = run.length - 1; k > 0; k -= 1) {
      chosenState[k - 1] = back[k]?.[chosenState[k] ?? 0] ?? 0;
    }

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
    const first = steps[run[0] ?? 0];
    const firstState = first?.states[chosenState[0] ?? 0]?.candidate;
    if (first === undefined || firstState === undefined) continue;
    place(first.position, firstState, {});
    for (let k = 1; k < run.length; k += 1) {
      const from = steps[run[k - 1] ?? 0];
      const to = steps[run[k] ?? 0];
      const source = from?.states[chosenState[k - 1] ?? 0]?.candidate;
      const target = to?.states[chosenState[k] ?? 0]?.candidate;
      if (from === undefined || to === undefined || source === undefined || target === undefined)
        continue;
      graph.search(source, [target], bound(from, to), config.maxHops);
      stats.searches += 1;
      const route = graph.pathTo(target);
      // A leg without a route is drawn straight between the two places.
      const leg = legOf(route, source, target);
      const legEnd = leg.along.at(-1) ?? 0;
      const routed = route !== null;
      const bridgedLegM = routed ? 0 : legEnd;
      const hasOutliers = (run[k] ?? 0) - (run[k - 1] ?? 0) > 1;
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
          path:
            between.length === 0
              ? null
              : between.map(([x, y]) => [projection.lon(x), projection.lat(y)] as [number, number]),
        });
        along = spot.along;
      }
    }
  }
  stats.settledNodes = graph.settledCount - settledBefore;
  return { points: result, stats };
}
