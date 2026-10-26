import { applyOverrides, type Draft, type DraftMove } from "./applyOverrides";
import { averagePoints } from "./averagePoints";
import { centroidOf, detectStops } from "./detectStops";
import { type KeptPoint, keptPoints } from "./keptPoint";
import { LocalProjection } from "./localProjection";
import type { MapData, WayClass } from "./mapData";
import { type MatchContext, matchToWays } from "./matchToWays";
import { type MapContext, type MoveSeries, moveSeries } from "./moveSeries";
import type {
  AveragedPoint,
  InferredSegment,
  ManualTrip,
  MappedPoint,
  OverrideSpan,
  RawPoint,
  Span,
  VisitSpan,
} from "./pipelineTypes";
import { PoiIndex } from "./poiIndex";
import type { ProcessingConfig } from "./processingConfig";
import { scorePart, splitMove } from "./splitMoves";
import { moveTiles, type TileKey } from "./tileCover";
import { WayGraph } from "./wayGraph";
import { WayIndex } from "./wayIndex";

/** The first half of a window's processing: what can be done before the map data is there. */
export interface WindowPlan {
  raw: readonly RawPoint[];
  averaged: AveragedPoint[];
  kept: KeptPoint[];
  spans: Span[];
  /** Tiles of each move among `spans`, in order. */
  moveTiles: Set<TileKey>[];
  /** Every tile the moves need. */
  tiles: Set<TileKey>;
}

/** What finishing a window needs besides the plan. */
export interface WindowInputs {
  trips: readonly ManualTrip[];
  overrides: readonly OverrideSpan[];
  /** The map data of the available tiles; null when mapping is switched off. */
  map: MapData | null;
  /** Tiles whose data is in `map`. A move is mapped only when all its tiles are. */
  available: ReadonlySet<TileKey>;
  /** Mapped points stored earlier, per raw point (`--from-level inferred` reuses them). */
  storedMapping?: readonly (MappedPoint | null)[] | undefined;
}

export interface WindowResult {
  averaged: AveragedPoint[];
  /** Per raw point; null where nothing was mapped (no map data, dropped points). */
  mapped: (MappedPoint | null)[];
  segments: InferredSegment[];
  /** Tiles some move needed but did not have, sorted. */
  missingTiles: TileKey[];
}

/** Averaged level, stops and moves, and the tiles the moves need. */
export function planWindow(
  points: readonly RawPoint[],
  visits: readonly VisitSpan[],
  config: ProcessingConfig,
): WindowPlan {
  const raw = [...points].sort((a, b) => a.t - b.t);
  const averaged = averagePoints(raw, config.averaging);
  const kept = keptPoints(raw, averaged);
  const spans = detectStops(kept, visits, config.stops);
  const perMove: Set<TileKey>[] = [];
  const tiles = new Set<TileKey>();
  for (const span of spans) {
    if (span.kind !== "move") continue;
    const needed = moveTiles(kept.slice(span.first, span.last + 1), config);
    perMove.push(needed);
    for (const tile of needed) tiles.add(tile);
  }
  return { raw, averaged, kept, spans, moveTiles: perMove, tiles };
}

const wayClasses: readonly WayClass[] = ["rail", "tram", "street", "ferry"];

/** Map matching, features, modes, splitting and overrides: the mapped and inferred levels. */
export function finishWindow(
  plan: WindowPlan,
  inputs: WindowInputs,
  config: ProcessingConfig,
): WindowResult {
  const { kept, spans } = plan;
  let match: MatchContext | null = null;
  let mapContext: MapContext | null = null;
  if (inputs.map !== null) {
    const index = new WayIndex(inputs.map, LocalProjection.around(kept));
    const graphs = Object.fromEntries(
      wayClasses.map((wayClass) => [wayClass, new WayGraph(index, wayClass)]),
    ) as Record<WayClass, WayGraph>;
    match = { index, graphs };
    mapContext = { index, pois: new PoiIndex(inputs.map.pois) };
  }

  const mapped: (MappedPoint | null)[] = plan.raw.map(() => null);
  if (inputs.map !== null) {
    // Stops are not matched: their points stay where averaging put them.
    for (const span of spans) {
      if (span.kind !== "stop") continue;
      for (let index = span.first; index <= span.last; index += 1) {
        const point = kept[index];
        if (point === undefined) continue;
        mapped[point.index] = {
          lat: point.lat,
          lon: point.lon,
          wayId: null,
          wayKind: null,
          snapM: 0,
          path: null,
        };
      }
    }
  }

  const missing = new Set<TileKey>();
  const series: MoveSeries[] = [];
  const offsets: number[] = [];
  const drafts: Draft[] = [];
  let moveNumber = 0;
  for (const span of spans) {
    if (span.kind === "stop") {
      drafts.push({
        kind: "stop",
        first: span.first,
        last: span.last,
        startT: span.startT,
        endT: span.endT,
      });
      continue;
    }
    const points = kept.slice(span.first, span.last + 1);
    const tiles = plan.moveTiles[moveNumber] ?? new Set<TileKey>();
    const covered = [...tiles].every((tile) => inputs.available.has(tile));
    let moveMapped: MappedPoint[] | null = null;
    if (match !== null && covered) {
      const stored = points.map((point) => inputs.storedMapping?.[point.index] ?? null);
      moveMapped = stored.every((entry) => entry !== null && entry.lat !== null)
        ? (stored as MappedPoint[])
        : matchToWays(points, match, config.mapping);
      for (const [position, point] of points.entries()) {
        mapped[point.index] = moveMapped[position] ?? null;
      }
    } else if (match !== null) {
      for (const tile of tiles) if (!inputs.available.has(tile)) missing.add(tile);
      // Not mapped yet: the stop points at its ends keep the stops' values.
      for (const point of points.slice(1, -1)) mapped[point.index] = null;
    }
    const moveSeriesOfSpan = moveSeries(
      points,
      moveMapped,
      moveMapped === null ? null : mapContext,
      config.features,
    );
    const moveIndex = series.length;
    series.push(moveSeriesOfSpan);
    offsets.push(span.first);
    for (const part of splitMove(moveSeriesOfSpan, inputs.trips, config)) {
      const first = span.first + part.first;
      const last = span.first + part.last;
      drafts.push({
        kind: "move",
        first,
        last,
        startT: kept[first]?.t ?? span.startT,
        endT: kept[last]?.t ?? span.endT,
        move: moveIndex,
        part,
        modeUser: null,
        override: null,
      });
    }
    moveNumber += 1;
  }

  const finished = applyOverrides(drafts, inputs.overrides, {
    timeAt: (index) => kept[index]?.t ?? 0,
    rescore: (move, first, last) => {
      const target = series[move];
      if (target === undefined) throw new Error(`No move ${move} in this window`);
      const offset = offsets[move] ?? 0;
      return scorePart(target, first - offset, last - offset, inputs.trips, config);
    },
    overrides: config.overrides,
  });

  return {
    averaged: plan.averaged,
    mapped,
    segments: finished.map((draft) => toSegment(draft, kept, config)),
    missingTiles: [...missing].sort(),
  };
}

function position(point: KeptPoint | undefined): { lat: number; lon: number } {
  return { lat: point?.lat ?? 0, lon: point?.lon ?? 0 };
}

function toSegment(
  draft: Draft,
  kept: readonly KeptPoint[],
  config: ProcessingConfig,
): InferredSegment {
  const first = kept[draft.first];
  const last = kept[draft.last];
  const pointCount = draft.last - draft.first + 1;
  if (draft.kind === "stop") {
    return {
      kind: "stop",
      startT: draft.startT,
      endT: draft.endT,
      first: draft.first,
      last: draft.last,
      distanceM: 0,
      pointCount,
      start: position(first),
      end: position(last),
      centroid: centroidOf(kept, draft.first, draft.last),
      modeInferred: null,
      modeUser: null,
      confidence: null,
      averageSpeedMs: null,
      maxSpeedMs: null,
      features: {},
    };
  }
  return moveSegment(draft, kept, pointCount, config);
}

function moveSegment(
  draft: DraftMove,
  kept: readonly KeptPoint[],
  pointCount: number,
  config: ProcessingConfig,
): InferredSegment {
  const { features, verdict } = draft.part;
  let lat = 0;
  let lon = 0;
  for (let index = draft.first; index <= draft.last; index += 1) {
    lat += kept[index]?.lat ?? 0;
    lon += kept[index]?.lon ?? 0;
  }
  const duration = draft.endT - draft.startT;
  return {
    kind: "move",
    startT: draft.startT,
    endT: draft.endT,
    first: draft.first,
    last: draft.last,
    distanceM: features.distanceM,
    pointCount,
    start: position(kept[draft.first]),
    end: position(kept[draft.last]),
    centroid: { lat: lat / pointCount, lon: lon / pointCount },
    modeInferred: verdict.mode,
    modeUser: draft.modeUser,
    confidence: verdict.confidence,
    averageSpeedMs: duration > 0 ? Math.round((features.distanceM / duration) * 100) / 100 : 0,
    maxSpeedMs: Math.round((features.speed.max / 3.6) * 100) / 100,
    features: {
      ...features,
      scores: verdict.scores,
      review: verdict.confidence < config.review.reviewBelow,
      override:
        draft.override === null
          ? null
          : { id: draft.override.id, kind: draft.override.kind, source: draft.override.source },
    },
  };
}

/** Both halves at once, for tests and the benchmark (the server fetches map data in between). */
export function runPipeline(
  points: readonly RawPoint[],
  visits: readonly VisitSpan[],
  inputs: WindowInputs,
  config: ProcessingConfig,
): WindowResult {
  return finishWindow(planWindow(points, visits, config), inputs, config);
}
