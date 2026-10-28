import { applyOverrides, type Draft, type DraftMove } from "./applyOverrides";
import { averagePoints } from "./averagePoints";
import { centroidOf, detectStops, spreadOf } from "./detectStops";
import { type KeptPoint, keptPoints } from "./keptPoint";
import { LocalProjection } from "./localProjection";
import type { MapData, WayClass } from "./mapData";
import { type MapPiece, type PlannedMove, planPieces, type Stretch } from "./mapPieces";
import { matchToWays } from "./matchToWays";
import {
  emptyWaySamples,
  type MoveMap,
  type MoveSeries,
  moveSeries,
  sampleWays,
  type WaySamples,
} from "./moveSeries";
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
import { combinePois, PoiIndex } from "./poiIndex";
import type { ProcessingConfig } from "./processingConfig";
import { scorePart, splitMove } from "./splitMoves";
import { isAirborne, moveTiles, type TileKey } from "./tileCover";
import { WayGraph } from "./wayGraph";
import { WayIndex } from "./wayIndex";

/** The first half of a window's processing: what can be done before the map data is there. */
export interface WindowPlan {
  raw: readonly RawPoint[];
  averaged: AveragedPoint[];
  kept: KeptPoint[];
  spans: Span[];
  /** The moves among `spans`, in order. */
  moves: PlannedMove[];
  /** How the moves' map data is loaded, a piece at a time. */
  pieces: MapPiece[];
  /** Every tile the moves need. */
  tiles: Set<TileKey>;
}

/** What finishing a window needs besides the plan and its mapped stretches. */
export interface InferInputs {
  trips: readonly ManualTrip[];
  overrides: readonly OverrideSpan[];
  /** Whether there is map data at all; without, nothing is mapped. */
  mapping: boolean;
  /** Tiles whose data is cached. A move is mapped only when all its tiles are. */
  available: ReadonlySet<TileKey>;
}

/** What finishing a window needs in one go, its map data included (tests, the benchmark). */
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

/** What a piece's map data gave one stretch: its points' places and way samples (`first..last`). */
export interface StretchMapping {
  stretch: Stretch;
  mapped: MappedPoint[];
  ways: WaySamples;
  pois: PoiIndex;
}

/** Averaged level, stops and moves, and the tiles the moves need, piece by piece. */
export function planWindow(
  points: readonly RawPoint[],
  visits: readonly VisitSpan[],
  config: ProcessingConfig,
): WindowPlan {
  const raw = [...points].sort((a, b) => a.t - b.t);
  const averaged = averagePoints(raw, config.averaging);
  const kept = keptPoints(raw, averaged);
  const spans = detectStops(kept, visits, config.stops);
  const moves: PlannedMove[] = [];
  const tiles = new Set<TileKey>();
  for (const span of spans) {
    if (span.kind !== "move") continue;
    const points = kept.slice(span.first, span.last + 1);
    const airborne = isAirborne(points, config);
    const needed = airborne ? new Set<TileKey>() : moveTiles(points, config);
    moves.push({ first: span.first, last: span.last, airborne, tiles: needed });
    for (const tile of needed) tiles.add(tile);
  }
  return { raw, averaged, kept, spans, moves, pieces: planPieces(kept, moves, config), tiles };
}

const covered = (move: PlannedMove, available: ReadonlySet<TileKey>): boolean =>
  !move.airborne && [...move.tiles].every((tile) => available.has(tile));

/**
 * The pieces worth loading: the stretches of moves whose tiles are all cached
 * (the others are stored unmapped and wait for theirs).
 */
export function piecesToMap(plan: WindowPlan, available: ReadonlySet<TileKey>): MapPiece[] {
  const ready = plan.moves.map((move) => covered(move, available));
  return plan.pieces.flatMap((piece) => {
    const stretches = piece.stretches.filter((stretch) => ready[stretch.move] === true);
    if (stretches.length === piece.stretches.length) return [piece];
    if (stretches.length === 0) return [];
    const tiles = new Set<TileKey>();
    for (const stretch of stretches) for (const tile of stretch.tiles) tiles.add(tile);
    return [{ stretches, tiles }];
  });
}

const wayClasses: readonly WayClass[] = ["rail", "tram", "street", "ferry"];

/** A move's mapped points stored earlier, when every point has one. */
function storedMoveMapping(
  points: readonly KeptPoint[],
  storedMapping: readonly (MappedPoint | null)[] | undefined,
): MappedPoint[] | null {
  if (storedMapping === undefined) return null;
  const stored = points.map((point) => storedMapping[point.index] ?? null);
  return stored.every((entry) => entry !== null && entry.lat !== null)
    ? (stored as MappedPoint[])
    : null;
}

/**
 * Map matching of one piece's stretches against its map data (docs/architecture.md
 * §17.3, mapped), and the way samples along them. The way index and the
 * routing graphs live only as long as this call.
 */
export function mapPiece(
  plan: WindowPlan,
  piece: MapPiece,
  map: MapData,
  storedMapping: readonly (MappedPoint | null)[] | undefined,
  config: ProcessingConfig,
): StretchMapping[] {
  const movePoints = (stretch: Stretch): KeptPoint[] => {
    const move = plan.moves[stretch.move];
    if (move === undefined) throw new Error(`No move ${stretch.move} in this window`);
    return plan.kept.slice(move.first, move.last + 1);
  };
  const projection = LocalProjection.around(
    piece.stretches.flatMap((stretch) => movePoints(stretch).slice(stretch.from, stretch.to + 1)),
  );
  const index = new WayIndex(map, projection);
  const graphs = Object.fromEntries(
    wayClasses.map((wayClass) => [wayClass, new WayGraph(index, wayClass)]),
  ) as Record<WayClass, WayGraph>;
  const pois = new PoiIndex(map.pois);
  return piece.stretches.map((stretch) => {
    const points = movePoints(stretch);
    const stored = storedMoveMapping(points, storedMapping);
    const mapped =
      stored?.slice(stretch.first, stretch.last + 1) ??
      matchToWays(
        points.slice(stretch.from, stretch.to + 1),
        { index, graphs },
        config.mapping,
      ).slice(stretch.first - stretch.from, stretch.last - stretch.from + 1);
    return { stretch, mapped, ways: sampleWays(points, stretch, index, config.features), pois };
  });
}

/** A move's mapped points and map evidence, put together from its stretches. */
function assemble(
  count: number,
  parts: readonly StretchMapping[],
  move: number,
): { mapped: MappedPoint[]; map: MoveMap } {
  const sorted = [...parts].sort((a, b) => a.stretch.first - b.stretch.first);
  const [only] = sorted;
  if (only !== undefined && sorted.length === 1 && only.mapped.length === count) {
    return { mapped: only.mapped, map: { ways: only.ways, pois: only.pois } };
  }
  const mapped: MappedPoint[] = [];
  const ways = emptyWaySamples(count);
  for (const part of sorted) {
    if (part.stretch.first !== mapped.length) {
      throw new Error(`Move ${move} has no mapping at position ${mapped.length}`);
    }
    for (const point of part.mapped) mapped.push(point);
    const at = part.stretch.first;
    ways.nearTram.set(part.ways.nearTram, at);
    ways.nearCycleway.set(part.ways.nearCycleway, at);
    ways.nearFoot.set(part.ways.nearFoot, at);
    ways.corridorSamples.set(part.ways.corridorSamples, at);
    ways.corridorRail.set(part.ways.corridorRail, at);
    ways.corridorMotorway.set(part.ways.corridorMotorway, at);
  }
  if (mapped.length !== count)
    throw new Error(`Move ${move} has no mapping at position ${mapped.length}`);
  return {
    mapped,
    map: { ways, pois: combinePois([...new Set(sorted.map((part) => part.pois))]) },
  };
}

/** A point of a flight: off the network, where averaging put it. */
const offNetwork = (point: KeptPoint): MappedPoint => ({
  lat: point.lat,
  lon: point.lon,
  wayId: null,
  wayKind: "other",
  snapM: 0,
  path: null,
});

/**
 * Features, modes, splitting and overrides over the mapped stretches: the
 * mapped and inferred levels. Every stretch of a move that is mapped must be
 * among `mappings` (`piecesToMap` gives them).
 */
export function inferWindow(
  plan: WindowPlan,
  mappings: readonly StretchMapping[],
  inputs: InferInputs,
  config: ProcessingConfig,
): WindowResult {
  const { kept, spans } = plan;
  const byMove = new Map<number, StretchMapping[]>();
  for (const mapping of mappings) {
    const list = byMove.get(mapping.stretch.move);
    if (list === undefined) byMove.set(mapping.stretch.move, [mapping]);
    else list.push(mapping);
  }

  const mapped: (MappedPoint | null)[] = plan.raw.map(() => null);
  if (inputs.mapping) {
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
        ownLast: span.ownLast ?? span.last,
        startT: span.startT,
        endT: span.endT,
      });
      continue;
    }
    const move = plan.moves[moveNumber];
    if (move === undefined) throw new Error(`No move ${moveNumber} in this window`);
    const points = kept.slice(span.first, span.last + 1);
    let moveMapped: MappedPoint[] | null = null;
    let moveMap: MoveMap | null = null;
    if (inputs.mapping && move.airborne) {
      moveMapped = points.map(offNetwork);
    } else if (inputs.mapping && covered(move, inputs.available)) {
      ({ mapped: moveMapped, map: moveMap } = assemble(
        points.length,
        byMove.get(moveNumber) ?? [],
        moveNumber,
      ));
    } else if (inputs.mapping) {
      for (const tile of move.tiles) if (!inputs.available.has(tile)) missing.add(tile);
    }
    if (moveMapped !== null) {
      for (const [position, point] of points.entries()) {
        mapped[point.index] = moveMapped[position] ?? null;
      }
    } else if (inputs.mapping) {
      // Not mapped yet: the stop points at its ends keep the stops' values.
      for (const point of points.slice(1, -1)) mapped[point.index] = null;
    }
    const moveSeriesOfSpan = moveSeries(points, moveMapped, moveMap, config.features);
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

/** Map matching, features, modes, splitting and overrides with all the map data at hand. */
export function finishWindow(
  plan: WindowPlan,
  inputs: WindowInputs,
  config: ProcessingConfig,
): WindowResult {
  const { map } = inputs;
  const mappings =
    map === null
      ? []
      : piecesToMap(plan, inputs.available).flatMap((piece) =>
          mapPiece(plan, piece, map, inputs.storedMapping, config),
        );
  return inferWindow(
    plan,
    mappings,
    {
      trips: inputs.trips,
      overrides: inputs.overrides,
      mapping: map !== null,
      available: inputs.available,
    },
    config,
  );
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
      features: {
        // How far apart its points lie, the walk within a station (the segment dialog says so) …
        spreadM: Math.round(spreadOf(kept, draft.first, draft.ownLast)),
        // … and when the last of its own was recorded: it lasts until the phone left.
        lastPointT: kept[draft.ownLast]?.t ?? draft.endT,
      },
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
