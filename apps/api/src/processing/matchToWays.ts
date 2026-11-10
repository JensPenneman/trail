import type { KeptPoint } from "./keptPoint";
import type { WayClass } from "./mapData";
import { legOf, placeOnLeg, verticesBetween } from "./matchLegs";
import type { MappedPoint } from "./pipelineTypes";
import type { ProcessingConfig } from "./processingConfig";
import type { RoutePath, WayGraph } from "./wayGraph";
import type { WayCandidate, WayIndex } from "./wayIndex";

type MappingConfig = ProcessingConfig["mapping"];

/** The networks of a window: its way index and one routing graph per class. */
export interface MatchContext {
  index: WayIndex;
  graphs: Readonly<Record<WayClass, WayGraph>>;
}

interface State {
  /** Null: off the network. */
  candidate: WayCandidate | null;
  emission: number;
}

interface Step {
  /** Position of the point in the move. */
  position: number;
  x: number;
  y: number;
  states: State[];
}

/**
 * Map matching of one move (docs/architecture.md §17.3, mapped): a hidden
 * Markov model over the ways near each point, solved with Viterbi.
 *
 * - Points enter the model `matchSpacingM` apart (dense data adds nothing but
 *   work); the ones between are placed on the matched line afterwards.
 * - Candidates: the nearest point of each way within clamp(1.5 × accuracy, 25 m,
 *   120 m), at most `maxCandidates`, plus "off the network". Emission cost:
 *   ½(d/σ)², σ = max(accuracy, 10 m).
 * - Transitions route along the network of the candidate's class (a train stays
 *   on rails) within min(25 km, 2 × chord + 300 m) and 40 way changes; the
 *   cost grows with |route − chord| / max(25 m, 0.15 × chord), plus a little
 *   for changing ways. Without a route (another class, out of reach) the jump
 *   costs `jumpCost`.
 *
 * The result gives each point its place on the line, its way, and the shape of
 * the line since the previous point — the rails between two train points
 * minutes apart instead of a straight cut across fields. Deterministic: ties
 * go to the nearer candidate, then the lower way index.
 */
export function matchToWays(
  points: readonly KeptPoint[],
  context: MatchContext,
  config: MappingConfig,
): MappedPoint[] {
  const { index, graphs } = context;
  const projection = index.projection;
  const xs = points.map((point) => projection.x(point.lon));
  const ys = points.map((point) => projection.y(point.lat));

  // The points that enter the model: the first, every one `matchSpacingM` on, and the last.
  const chosen: number[] = [];
  for (let position = 0; position < points.length; position += 1) {
    const previous = chosen.at(-1);
    if (
      previous === undefined ||
      position === points.length - 1 ||
      Math.hypot(
        (xs[position] ?? 0) - (xs[previous] ?? 0),
        (ys[position] ?? 0) - (ys[previous] ?? 0),
      ) >= config.matchSpacingM
    ) {
      chosen.push(position);
    }
  }

  const steps: Step[] = chosen.map((position) => {
    const point = points[position];
    const accuracy = point?.accuracy ?? 30;
    const radius = Math.min(
      config.maxRadiusM,
      Math.max(config.minRadiusM, config.radiusFactor * accuracy),
    );
    const sigma = Math.max(accuracy, config.minSigmaM);
    const x = xs[position] ?? 0;
    const y = ys[position] ?? 0;
    const states: State[] = index
      .candidates(x, y, radius, config.maxCandidates)
      .map((candidate) => ({ candidate, emission: 0.5 * (candidate.distance / sigma) ** 2 }));
    states.push({ candidate: null, emission: config.offRoadCost });
    return { position, x, y, states };
  });

  // Viterbi, forward.
  const cost: Float64Array[] = steps.map((step) => new Float64Array(step.states.length));
  const back: Int32Array[] = steps.map((step) => new Int32Array(step.states.length).fill(-1));
  const first = steps[0];
  const firstCost = cost[0];
  if (first !== undefined && firstCost !== undefined) {
    for (const [stateIndex, state] of first.states.entries())
      firstCost[stateIndex] = state.emission;
  }
  for (let stepIndex = 1; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    const previous = steps[stepIndex - 1];
    const here = cost[stepIndex];
    const before = cost[stepIndex - 1];
    const pointers = back[stepIndex];
    if (
      step === undefined ||
      previous === undefined ||
      here === undefined ||
      before === undefined ||
      pointers === undefined
    )
      continue;
    here.fill(Number.POSITIVE_INFINITY);
    const chord = Math.hypot(step.x - previous.x, step.y - previous.y);
    const beta = Math.max(config.betaMinM, config.betaChordFactor * chord);
    const bound = Math.min(config.maxRouteM, chord * config.routeFactor + config.routeSlackM);
    for (const [fromIndex, from] of previous.states.entries()) {
      const base = before[fromIndex] ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(base)) continue;
      const source = from.candidate;
      let graph: WayGraph | null = null;
      if (source !== null) {
        const sourceWay = index.ways[source.way];
        graph = sourceWay === undefined ? null : graphs[sourceWay.wayClass];
        const targets = step.states
          .map((state) => state.candidate)
          .filter((candidate): candidate is WayCandidate => {
            if (candidate === null) return false;
            return index.ways[candidate.way]?.wayClass === sourceWay?.wayClass;
          });
        graph?.search(source, targets, bound, config.maxHops);
      }
      for (const [toIndex, to] of step.states.entries()) {
        let transition: number;
        const target = to.candidate;
        if (source === null && target === null) transition = 0;
        else if (source === null || target === null) transition = config.offRoadTransitionCost;
        else {
          const sameClass = index.ways[source.way]?.wayClass === index.ways[target.way]?.wayClass;
          const route =
            sameClass && graph !== null ? graph.distanceTo(target) : Number.POSITIVE_INFINITY;
          transition = Number.isFinite(route)
            ? Math.abs(route - chord) / beta +
              (source.way === target.way ? 0 : config.wayChangeCost)
            : config.jumpCost;
        }
        const total = base + transition + to.emission;
        if (total < (here[toIndex] ?? Number.POSITIVE_INFINITY)) {
          here[toIndex] = total;
          pointers[toIndex] = fromIndex;
        }
      }
    }
  }

  // Backtrack.
  const path = new Int32Array(steps.length);
  const lastCost = cost.at(-1);
  if (lastCost !== undefined) {
    let best = 0;
    for (let stateIndex = 1; stateIndex < lastCost.length; stateIndex += 1) {
      if ((lastCost[stateIndex] ?? 0) < (lastCost[best] ?? 0)) best = stateIndex;
    }
    path[steps.length - 1] = best;
    for (let stepIndex = steps.length - 1; stepIndex > 0; stepIndex -= 1) {
      path[stepIndex - 1] = back[stepIndex]?.[path[stepIndex] ?? 0] ?? 0;
    }
  }

  const result: MappedPoint[] = points.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    wayId: null,
    wayKind: "other",
    snapM: 0,
    path: null,
  }));
  const place = (position: number, x: number, y: number, way: number) => {
    const entry = result[position];
    if (entry === undefined) return;
    const indexed = way >= 0 ? index.ways[way] : undefined;
    entry.lat = projection.lat(y);
    entry.lon = projection.lon(x);
    entry.wayId = indexed?.id ?? null;
    entry.wayKind = indexed?.kind ?? "other";
    entry.snapM = Math.hypot(x - (xs[position] ?? 0), y - (ys[position] ?? 0));
  };
  const toLonLat = (vertices: [number, number][]): [number, number][] =>
    vertices.map(([x, y]) => [projection.lon(x), projection.lat(y)]);

  for (const [stepIndex, step] of steps.entries()) {
    const state = step.states[path[stepIndex] ?? 0];
    const candidate = state?.candidate ?? null;
    if (candidate === null) place(step.position, step.x, step.y, -1);
    else place(step.position, candidate.x, candidate.y, candidate.way);
    if (stepIndex === 0) continue;
    const previousStep = steps[stepIndex - 1];
    if (previousStep === undefined) continue;
    const previousCandidate = previousStep.states[path[stepIndex - 1] ?? 0]?.candidate ?? null;
    const from = previousCandidate ?? { x: previousStep.x, y: previousStep.y };
    const to = candidate ?? { x: step.x, y: step.y };
    let route: RoutePath | null = null;
    if (previousCandidate !== null && candidate !== null) {
      const fromWay = index.ways[previousCandidate.way];
      const toWay = index.ways[candidate.way];
      if (fromWay !== undefined && toWay !== undefined && fromWay.wayClass === toWay.wayClass) {
        const graph = graphs[fromWay.wayClass];
        const chord = Math.hypot(step.x - previousStep.x, step.y - previousStep.y);
        graph.search(
          previousCandidate,
          [candidate],
          Math.min(config.maxRouteM, chord * config.routeFactor + config.routeSlackM),
          config.maxHops,
        );
        route = graph.pathTo(candidate);
      }
    }
    // A jump or a stretch off the network is drawn as a straight line between the points.
    const leg = legOf(route, from, to);
    const legEnd = leg.along.at(-1) ?? 0;
    let along = 0;
    for (let position = previousStep.position + 1; position <= step.position; position += 1) {
      const isEnd = position === step.position;
      const spot = isEnd
        ? { x: to.x, y: to.y, along: legEnd, way: candidate === null ? -1 : candidate.way }
        : placeOnLeg(leg, xs[position] ?? 0, ys[position] ?? 0, along);
      if (!isEnd) {
        if (route === null) place(position, xs[position] ?? 0, ys[position] ?? 0, -1);
        else place(position, spot.x, spot.y, spot.way);
      }
      const between = route === null ? [] : verticesBetween(leg, along, spot.along);
      const entry = result[position];
      if (entry !== undefined) entry.path = between.length === 0 ? null : toLonLat(between);
      along = spot.along;
    }
  }
  return result;
}
