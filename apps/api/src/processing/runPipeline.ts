import { haversineM } from "../tracks/haversine";
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
  RailPassStats,
  RailPathVerdict,
  RailPlace,
  RailPoint,
  RawPoint,
  Span,
  StayBefore,
  StoredRail,
  VisitSpan,
} from "./pipelineTypes";
import { combinePois, PoiIndex } from "./poiIndex";
import type { ProcessingConfig } from "./processingConfig";
import { alignToRail, type RailStats } from "./rail/alignToRail";
import { judgeRailPath } from "./rail/judgeRailPath";
import { type RailContext, railContext, trainNetwork } from "./rail/railNetwork";
import { couldBeTrain, trainLikeM } from "./rail/trainPlausible";
import { scorePart, splitMove } from "./splitMoves";
import { continuesStop } from "./stayParts";
import type { StopShape } from "./stopShape";
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
  /** The stored stop the window begins in or right after, for the stay of its first stop. */
  stayBefore?: StayBefore | null | undefined;
  /** The rail data at hand; absent: no rail line is judged (no map data at all, or the aligner is off). */
  rail?: RailInputs | null | undefined;
}

/** What the rail alignment needs besides the stretches mapped from the cache (docs/architecture.md §17.3). */
export interface RailInputs {
  /** Tiles whose rail ways are at hand: the cache's, and those a ready region covers. */
  available: ReadonlySet<TileKey>;
  /** The tiles a ready region covers (a move with every tile among them counts as read from the region). */
  covered?: ReadonlySet<TileKey>;
  /** The rail places of moves whose tiles only a region covers, read rail-only (`railPiece`). */
  stretches: readonly RailStretch[];
  /** The moves (numbers in the plan) whose rail-only read the per-pass cap put off (`planRailReads`). */
  deferred?: ReadonlySet<number>;
  /** What an earlier pass stored as aligned over the window; read only when a move was deferred (`storedAligned`). */
  stored?: StoredRail;
  /** Whether Overpass may still bring the tiles a move lacks (`no_map/waiting`); else nothing will (`outside_regions`). */
  waiting: boolean;
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
  /** The stored stop the window begins in or right after, for the stay of its first stop. */
  stayBefore?: StayBefore | null | undefined;
}

export interface WindowResult {
  averaged: AveragedPoint[];
  /** Per raw point; null where nothing was mapped (no map data, dropped points). */
  mapped: (MappedPoint | null)[];
  segments: InferredSegment[];
  /**
   * Per raw point: where it lies on the railway, for the points of a part of a
   * move whose rail line the judge accepted; null elsewhere. Derived data of
   * its own (`processed_points.lat_rail` …): nothing of it feeds the inference.
   */
  rail: (RailPlace | null)[];
  /** Tiles some move needed but did not have, sorted. */
  missingTiles: TileKey[];
}

/** What a piece's map data gave one stretch: its points' places and way samples (`first..last`). */
export interface StretchMapping {
  stretch: Stretch;
  mapped: MappedPoint[];
  ways: WaySamples;
  pois: PoiIndex;
  /** The stretch's points on the railway (`first..last`); null with the aligner off or for a move that cannot be a train. */
  rail: RailPoint[] | null;
  /** What aligning it cost; null when it did not run. */
  railCost: RailCost | null;
}

/** The work of one alignment: the core's statistics and the milliseconds it took. */
export interface RailCost {
  stats: RailStats;
  ms: number;
}

/** The rail places of one stretch, read from a rail-only piece. */
export interface RailStretch {
  stretch: Stretch;
  rail: RailPoint[] | null;
  railCost: RailCost | null;
}

/** Adds the cost of one alignment to a pass's statistics. */
export function addRailCost(total: RailPassStats, cost: RailCost | null): void {
  if (cost === null) return;
  total.alignedStretches += 1;
  total.alignMs += cost.ms;
  total.steps += cost.stats.steps;
  total.runs += cost.stats.runs;
  total.searches += cost.stats.searches;
  total.skipSearches += cost.stats.skipSearches;
  total.settledNodes += cost.stats.settledNodes;
  total.maxSearchBoundM = Math.max(total.maxSearchBoundM, cost.stats.maxSearchBoundM);
  total.maxSearchHops = Math.max(total.maxSearchHops, cost.stats.maxSearchHops);
}

/** Averaged level, stops and moves, and the tiles the moves need, piece by piece. */
export function planWindow(
  points: readonly RawPoint[],
  visits: readonly VisitSpan[],
  config: ProcessingConfig,
  overrides: readonly OverrideSpan[] = [],
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
    moves.push({
      first: span.first,
      last: span.last,
      airborne,
      userTrain: setToTrain(overrides, span.startT, span.endT),
      tiles: needed,
    });
    for (const tile of needed) tiles.add(tile);
  }
  return { raw, averaged, kept, spans, moves, pieces: planPieces(kept, moves, config), tiles };
}

/**
 * Whether a person's correction to train reaches a move: a segment's or toggle's
 * span overlaps it. Generous by design (an open toggle counts to its end): a
 * move judged for nothing costs a little, one never judged stays as recorded.
 */
function setToTrain(overrides: readonly OverrideSpan[], startT: number, endT: number): boolean {
  return overrides.some(
    (override) =>
      override.mode === "train" &&
      override.from <= endT &&
      (override.to ?? override.endsBy ?? Number.POSITIVE_INFINITY) >= startT,
  );
}

const covered = (move: PlannedMove, available: ReadonlySet<TileKey>): boolean =>
  !move.airborne && [...move.tiles].every((tile) => available.has(tile));

/**
 * The pieces worth loading: the stretches of moves whose tiles are all cached
 * (the others are stored unmapped and wait for theirs).
 */
export function piecesToMap(plan: WindowPlan, available: ReadonlySet<TileKey>): MapPiece[] {
  return piecesOfMoves(
    plan,
    plan.moves.map((move) => covered(move, available)),
  );
}

/**
 * The pieces of the moves only a region (or the cache, with Overpass off)
 * covers: not all their tiles cached for the mapped level, all of them
 * rail-available, and the move could be a train at all. Their rail ways are
 * read rail-only and aligned (`railPiece`); their mapped level stays as it is.
 */
export function piecesToAlign(
  plan: WindowPlan,
  available: ReadonlySet<TileKey>,
  railAvailable: ReadonlySet<TileKey>,
  config: ProcessingConfig,
): MapPiece[] {
  return piecesOfMoves(
    plan,
    plan.moves.map(
      (move, number) =>
        !covered(move, available) &&
        railCovered(move, railAvailable) &&
        plausibleMove(plan, number, config),
    ),
  );
}

/** Whether a move of the plan could be a train (`couldBeTrain`); false for a move the plan does not have. */
export function plausibleMove(plan: WindowPlan, move: number, config: ProcessingConfig): boolean {
  const planned = plan.moves[move];
  return (
    planned !== undefined &&
    couldBeTrain(plan.kept.slice(planned.first, planned.last + 1), config.rail, planned.userTrain)
  );
}

/**
 * How train-like a move of the plan is, for ranking the rail-only reads: the
 * distance it covered at or above the minimum train speed, and infinitely so
 * where a person set it to train.
 */
export function trainScore(plan: WindowPlan, move: number, config: ProcessingConfig): number {
  const planned = plan.moves[move];
  if (planned === undefined) return 0;
  return planned.userTrain
    ? Number.POSITIVE_INFINITY
    : trainLikeM(plan.kept.slice(planned.first, planned.last + 1), config.rail);
}

/**
 * The rail-only reads of a pass within `maxTiles` tiles in all. The pieces are
 * ranked by how train-like their moves are (`score` of a move, a piece takes
 * the largest of its moves; ties keep plan order, so the result is
 * deterministic) and taken in that order, so that cars, which pass the
 * pre-filter, never use up the cap before the trains. A piece that would go
 * beyond it is not read and its moves are deferred (`no_map/deferred`); a move
 * with one piece put off is read whole or not at all (its other pieces are
 * dropped, or skipped, and the move deferred). Deferral never queues anything
 * and never replaces a stored aligned line (`inferWindow`); with Overpass off
 * nothing works a deferred move again but the operator's `trail reprocess`
 * (docs/architecture.md §17.3).
 */
export function planRailReads(
  pieces: readonly MapPiece[],
  maxTiles: number,
  score: (move: number) => number = () => 0,
): { reads: MapPiece[]; deferred: Set<number> } {
  const pieceScore = (piece: MapPiece): number =>
    Math.max(Number.NEGATIVE_INFINITY, ...piece.stretches.map((stretch) => score(stretch.move)));
  const ranked = pieces
    .map((piece, order) => ({ piece, order, rank: pieceScore(piece) }))
    .sort((a, b) => (a.rank === b.rank ? a.order - b.order : b.rank > a.rank ? 1 : -1));
  const taken = new Set<MapPiece>();
  const deferred = new Set<number>();
  let tiles = 0;
  for (const { piece } of ranked) {
    const putOff = piece.stretches.some((stretch) => deferred.has(stretch.move));
    if (!putOff && tiles + piece.tiles.size <= maxTiles) {
      taken.add(piece);
      tiles += piece.tiles.size;
    } else {
      for (const stretch of piece.stretches) deferred.add(stretch.move);
    }
  }
  // A move put off by one of its pieces is read by none: what an earlier piece of it took is given back.
  const reads = pieces.filter(
    (piece) => taken.has(piece) && piece.stretches.some((stretch) => !deferred.has(stretch.move)),
  );
  return { reads, deferred };
}

const railCovered = (move: PlannedMove, railAvailable: ReadonlySet<TileKey>): boolean =>
  !move.airborne && [...move.tiles].every((tile) => railAvailable.has(tile));

/** The plan's pieces cut down to the stretches of the moves marked `ready`. */
function piecesOfMoves(plan: WindowPlan, ready: readonly boolean[]): MapPiece[] {
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
  const movePoints = (stretch: Stretch) => stretchMovePoints(plan, stretch);
  const index = new WayIndex(map, pieceProjection(plan, piece));
  const graphs = Object.fromEntries(
    wayClasses.map((wayClass) => [wayClass, new WayGraph(index, wayClass)]),
  ) as Record<WayClass, WayGraph>;
  const pois = new PoiIndex(map.pois);
  // The rail graph is built when a stretch has a run, so a piece without one never pays for it.
  const rail = config.rail.enabled ? railContext(index, trainNetwork) : null;
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
    // A move that cannot be a train (a walk in town) is not aligned: it costs the aligner nothing.
    const aligned =
      rail === null || !couldBeTrain(points, config.rail, plan.moves[stretch.move]?.userTrain)
        ? null
        : alignStretch(points, stretch, rail, config);
    return {
      stretch,
      mapped,
      ways: sampleWays(points, stretch, index, config.features),
      pois,
      rail: aligned?.points ?? null,
      railCost: aligned?.cost ?? null,
    };
  });
}

function stretchMovePoints(plan: WindowPlan, stretch: Stretch): KeptPoint[] {
  const move = plan.moves[stretch.move];
  if (move === undefined) throw new Error(`No move ${stretch.move} in this window`);
  return plan.kept.slice(move.first, move.last + 1);
}

const pieceProjection = (plan: WindowPlan, piece: MapPiece): LocalProjection =>
  LocalProjection.around(
    piece.stretches.flatMap((stretch) =>
      stretchMovePoints(plan, stretch).slice(stretch.from, stretch.to + 1),
    ),
  );

/** A stretch's points on the railway, matched over `from..to` like the mapped level and cut to `first..last`. */
function alignStretch(
  points: readonly KeptPoint[],
  stretch: Stretch,
  rail: RailContext,
  config: ProcessingConfig,
): { points: RailPoint[]; cost: RailCost } {
  const started = performance.now();
  const aligned = alignToRail(points.slice(stretch.from, stretch.to + 1), rail, config.rail);
  return {
    points: aligned.points.slice(stretch.first - stretch.from, stretch.last - stretch.from + 1),
    cost: { stats: aligned.stats, ms: performance.now() - started },
  };
}

/**
 * The rail places of a piece of moves only a region covers, over their rail
 * ways alone (`loadRailMapData`): the same alignment as in `mapPiece`, without
 * the mapped level, the evidence or the stops.
 */
export function railPiece(
  plan: WindowPlan,
  piece: MapPiece,
  map: MapData,
  config: ProcessingConfig,
): RailStretch[] {
  const rail = railContext(new WayIndex(map, pieceProjection(plan, piece)), trainNetwork);
  return piece.stretches.map((stretch) => {
    const aligned = alignStretch(stretchMovePoints(plan, stretch), stretch, rail, config);
    return { stretch, rail: aligned.points, railCost: aligned.cost };
  });
}

/**
 * A move's rail places put together from its stretches; null when a stretch is
 * missing. Each stretch numbers its runs from 0: a stretch's are shifted by
 * the highest number before it, so that the run a seam cuts through keeps one
 * number across it and runs further on never clash (the judge compares them).
 */
export function assembleRail(
  count: number,
  parts: readonly { stretch: Stretch; rail: RailPoint[] | null }[],
): RailPoint[] | null {
  const places: RailPoint[] = [];
  let highest = 0;
  for (const part of [...parts].sort((a, b) => a.stretch.first - b.stretch.first)) {
    if (part.rail === null || part.stretch.first !== places.length) return null;
    const shift = highest;
    for (const place of part.rail) {
      if (place.run < 0) {
        places.push(place);
        continue;
      }
      highest = Math.max(highest, place.run + shift);
      places.push(shift === 0 ? place : { ...place, run: place.run + shift });
    }
  }
  return places.length === count ? places : null;
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
  // The rail line is derived data of its own: nothing below reads it before the segments are built.
  const rail = config.rail.enabled ? (inputs.rail ?? null) : null;
  const railByMove = new Map<number, RailStretch[]>();
  for (const stretch of rail?.stretches ?? []) {
    const list = railByMove.get(stretch.stretch.move);
    if (list === undefined) railByMove.set(stretch.stretch.move, [stretch]);
    else list.push(stretch);
  }
  const railMoves = new Map<number, RailMove>();
  // Moves the pre-filter left alone: a segment of one that ends up a train says so (`skipped/not_train`).
  const notTrain = new Set<number>();

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
  // The stop before, for the stay each stop is part of: one that continues it counts from its start.
  let stay: { shape: StopShape; startT: number } | null =
    inputs.stayBefore === null || inputs.stayBefore === undefined
      ? null
      : {
          shape: inputs.stayBefore,
          startT: inputs.stayBefore.stayStartT ?? Number.NEGATIVE_INFINITY,
        };
  for (const span of spans) {
    if (span.kind === "stop") {
      const ownLast = span.ownLast ?? span.last;
      const shape = stopShape(kept, span, ownLast);
      const stayStartT =
        stay !== null && continuesStop(stay.shape, shape) ? stay.startT : span.startT;
      stay = { shape, startT: stayStartT };
      drafts.push({
        kind: "stop",
        first: span.first,
        last: span.last,
        ownLast,
        startT: span.startT,
        endT: span.endT,
        stayStartT,
      });
      continue;
    }
    stay = null;
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
    // A move that cannot be a train is not aligned and has no verdict, whatever its tiles.
    if (rail !== null && !move.airborne && !couldBeTrain(points, config.rail, move.userTrain)) {
      notTrain.add(moveNumber);
    } else if (rail !== null && !move.airborne) {
      const found = railOfMove(
        move,
        moveNumber,
        points.length,
        inputs.mapping && covered(move, inputs.available)
          ? { from: "cache", parts: byMove.get(moveNumber) ?? [] }
          : { from: "region", parts: railByMove.get(moveNumber) ?? [] },
        rail,
      );
      if (found !== null) railMoves.set(moveNumber, found);
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

  // The judge, per part, over the rail places of its move; the aligned parts' places are kept.
  const railPlaces: (RailPlace | null)[] = plan.raw.map(() => null);
  const segments = finished.map((draft) => {
    const railMove = draft.kind === "move" ? railMoves.get(draft.move) : undefined;
    if (draft.kind === "move" && railMove === undefined && notTrain.has(draft.move)) {
      // Left alone, and a train all the same (the inference, or a person): not silence, a reason.
      const mode = draft.modeUser ?? draft.part.verdict.mode;
      const verdict =
        mode === "train"
          ? unjudged(kept.slice(draft.first, draft.last + 1), "skipped", "not_train")
          : undefined;
      return toSegment(draft, kept, config, verdict);
    }
    if (draft.kind !== "move" || railMove === undefined) return toSegment(draft, kept, config);
    if (railMove.places === null && railMove.reason === "deferred" && rail?.stored !== undefined) {
      const stored = storedAligned(draft, kept, rail.stored);
      if (stored !== null) {
        for (const [index, place] of stored.places) railPlaces[index] ??= place;
        return toSegment(draft, kept, config, stored.verdict);
      }
    }
    const verdict = judgePart(
      draft,
      railMove,
      offsets[draft.move] ?? 0,
      kept,
      mapped,
      railPlaces,
      config,
    );
    return toSegment(draft, kept, config, verdict);
  });

  return {
    averaged: plan.averaged,
    mapped,
    segments,
    rail: railPlaces,
    missingTiles: [...missing].sort(),
  };
}

/** What a move's rail line rests on: places read from the cache's or a region's rail ways, or no data. */
type RailMove =
  | { places: RailPoint[]; source: "cache" | "region" }
  | { places: null; reason: "waiting" | "outside_regions" | "deferred" };

function railOfMove(
  move: PlannedMove,
  moveNumber: number,
  count: number,
  read: {
    from: "cache" | "region";
    parts: readonly { stretch: Stretch; rail: RailPoint[] | null }[];
  },
  rail: RailInputs,
): RailMove | null {
  if (read.from === "region" && rail.deferred?.has(moveNumber) === true) {
    return { places: null, reason: "deferred" };
  }
  if (read.from === "cache" || railCovered(move, rail.available)) {
    const places = assembleRail(count, read.parts);
    if (places === null) return null;
    // Read from a region wherever it covers every tile; a tile only the cache holds makes it the cache's.
    const source =
      read.from === "region" && rail.covered !== undefined && !railCovered(move, rail.covered)
        ? "cache"
        : read.from;
    return { places, source };
  }
  return { places: null, reason: rail.waiting ? "waiting" : "outside_regions" };
}

/** A verdict with no measurement: the part was not judged, for the reason given. */
function unjudged(
  points: readonly KeptPoint[],
  status: "no_map" | "skipped",
  reason: RailPathVerdict["reason"],
): RailPathVerdict {
  let lengthM = 0;
  for (const [position, point] of points.entries()) {
    const before = points[position - 1];
    if (before !== undefined) lengthM += haversineM(before, point);
  }
  return {
    status,
    reason,
    source: null,
    coveredShare: 0,
    routedShare: 0,
    medianZ: 0,
    p90Z: 0,
    medianOffsetM: 0,
    outlierShare: 0,
    roadShare: 0,
    mapped: false,
    bridgedMaxSpeedMs: 0,
    lengthM: Math.round(lengthM),
  };
}

/**
 * What an earlier pass stored for a part that a deferral would otherwise
 * blank: an aligned stored segment with exactly the part's bounds and point
 * count keeps its verdict and the rail places of its points (a deferred part
 * never replaces an aligned line); null for any other part.
 */
function storedAligned(
  draft: DraftMove,
  kept: readonly KeptPoint[],
  stored: StoredRail,
): { verdict: RailPathVerdict; places: Map<number, RailPlace> } | null {
  const pointCount = draft.last - draft.first + 1;
  const match = stored.segments.find(
    (segment) =>
      segment.startT === draft.startT &&
      segment.endT === draft.endT &&
      segment.pointCount === pointCount,
  );
  if (match === undefined) return null;
  const places = new Map<number, RailPlace>();
  for (let at = draft.first; at <= draft.last; at += 1) {
    const point = kept[at];
    const place = point === undefined ? undefined : stored.places.get(point.t);
    if (point !== undefined && place !== undefined) places.set(point.index, place);
  }
  return { verdict: match.verdict, places };
}

/**
 * The verdict of one part of a move, and its aligned places taken into
 * `railPlaces`: a part's first point carries no rail path (the leg into it
 * belongs to the segment before), and a point two parts share keeps the place
 * the first of them gave it.
 */
function judgePart(
  draft: DraftMove,
  railMove: RailMove,
  moveStart: number,
  kept: readonly KeptPoint[],
  mapped: readonly (MappedPoint | null)[],
  railPlaces: (RailPlace | null)[],
  config: ProcessingConfig,
): RailPathVerdict {
  const points = kept.slice(draft.first, draft.last + 1);
  if (railMove.places === null) return unjudged(points, "no_map", railMove.reason);
  const places = railMove.places.slice(draft.first - moveStart, draft.last - moveStart + 1);
  const verdict = judgeRailPath(
    points,
    places,
    config.rail.judge,
    railMove.source,
    points.map((point) => mapped[point.index] ?? null),
  );
  if (verdict.status !== "aligned") return verdict;
  for (const [position, point] of points.entries()) {
    const place = places[position];
    if (place === undefined || place.run < 0 || place.lat === null || place.lon === null) continue;
    railPlaces[point.index] ??= {
      lat: place.lat,
      lon: place.lon,
      path: position === 0 ? null : place.path,
    };
  }
  return verdict;
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
      stayBefore: inputs.stayBefore,
      // Only the cache's data here: a move it does not hold waits for it (the server's pass also reads regions).
      rail: map === null ? null : { available: inputs.available, stretches: [], waiting: true },
    },
    config,
  );
}

function position(point: KeptPoint | undefined): { lat: number; lon: number } {
  return { lat: point?.lat ?? 0, lon: point?.lon ?? 0 };
}

/** A stop of the window as the continuation of a stay reads it: as it will be stored (`toSegment`). */
function stopShape(kept: readonly KeptPoint[], span: Span, ownLast: number): StopShape {
  return {
    startT: span.startT,
    endT: span.endT,
    start: position(kept[span.first]),
    end: position(kept[span.last]),
    centroid: centroidOf(kept, span.first, span.last),
    spreadM: Math.round(spreadOf(kept, span.first, ownLast)),
  };
}

function toSegment(
  draft: Draft,
  kept: readonly KeptPoint[],
  config: ProcessingConfig,
  railPath?: RailPathVerdict,
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
  return moveSegment(draft, kept, pointCount, config, railPath);
}

function moveSegment(
  draft: DraftMove,
  kept: readonly KeptPoint[],
  pointCount: number,
  config: ProcessingConfig,
  railPath: RailPathVerdict | undefined,
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
      // Absent with the aligner off, for a flight and with no map data at all.
      ...(railPath === undefined ? {} : { railPath }),
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
  return finishWindow(planWindow(points, visits, config, inputs.overrides), inputs, config);
}
