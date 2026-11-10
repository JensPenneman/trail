import { trackGapSeconds } from "@trail/contracts/trackSegments";
import {
  type LevelPoint,
  type LevelTrackSegment,
  type LevelTracksResponse,
  type LevelValue,
  type ProcessingLevel,
  processingLevels,
} from "@trail/contracts/transport";
import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { DistanceAccumulator } from "../tracks/distanceAccumulator";
import { haversineM } from "../tracks/haversine";
import { simplifyParts } from "../tracks/simplifyTrack";
import { segmentOverlaps } from "./segmentOverlaps";
import { type SegmentRow, toSegment } from "./segmentRow";
import { servedColumns, servedSegments } from "./servedSegments";

/** Rows per round trip (keyset on recorded_at). */
const pageSize = 20_000;
/** Points held per device before every k-th is kept (93 days of 1 Hz is 8 million). */
const holdLimit = 200_000;
/** Raw points worse than this are left out, as in the dashboard's tracks. */
const rawMaxAccuracyM = 200;

const rank = (level: ProcessingLevel): number => processingLevels.indexOf(level);
const lower = (a: ProcessingLevel, b: ProcessingLevel): ProcessingLevel =>
  rank(a) <= rank(b) ? a : b;

interface LocationRow extends Record<string, unknown> {
  recorded_at: string;
  t: number;
  lat: number;
  lon: number;
  horizontal_accuracy: number | null;
  altitude: number | null;
  speed: number | null;
}

interface ProcessedRow extends Record<string, unknown> {
  t: number;
  kept: boolean;
  lat_avg: number | null;
  lon_avg: number | null;
  lat_map: number | null;
  lon_map: number | null;
  path_map: [number, number][] | null;
  lat_rail: number | null;
  lon_rail: number | null;
  path_rail: [number, number][] | null;
  speed_avg: number | null;
}

/** A point's place along the railway and the rail's shape before it (§17.3, "Along the rails"). */
interface RailPlace {
  vertices: readonly LevelPoint[];
  point: LevelPoint;
}

/**
 * One served point and the level it reached; `vertices` are the way's shape
 * before it. `rail` is its place along the railway, taken only for a move
 * whose line is drawn along the rails (`alignedToOf`): the stored columns say
 * where the points lie, the segment's verdict and mode say whether to show it.
 */
interface Served {
  t: number;
  level: ProcessingLevel;
  vertices: readonly LevelPoint[];
  point: LevelPoint;
  accuracy: number | null;
  rail?: RailPlace;
}

/** The entry as drawn along the railway, where it has a place there; the mapped level counts. */
const alongRail = (entry: Served): Served =>
  entry.rail === undefined
    ? entry
    : { ...entry, level: "mapped", vertices: entry.rail.vertices, point: entry.rail.point };

/* The vertices of every point without a way's shape before it: one array for all of them, as a
 * day of 1 Hz points would otherwise allocate 86 400 empty ones. Never changed. */
const noVertices: readonly LevelPoint[] = Object.freeze([]);

/** The way's shape between two points with times interpolated along it. */
function withTimes(
  from: LevelPoint | null,
  path: readonly [number, number][],
  to: LevelPoint,
  extras: readonly (number | null)[],
): readonly LevelPoint[] {
  if (from === null || path.length === 0) return noVertices;
  const stops = [
    { lon: from[0], lat: from[1] },
    ...path.map(([lon, lat]) => ({ lon, lat })),
    { lon: to[0], lat: to[1] },
  ];
  const lengths = [0];
  for (let index = 1; index < stops.length; index += 1) {
    const a = stops[index - 1];
    const b = stops[index];
    lengths.push(
      (lengths[index - 1] ?? 0) + (a !== undefined && b !== undefined ? haversineM(a, b) : 0),
    );
  }
  const total = lengths.at(-1) ?? 0;
  return path.map(([lon, lat], index) => {
    const share = total > 0 ? (lengths[index + 1] ?? 0) / total : (index + 1) / (path.length + 1);
    return [lon, lat, Math.round(from[2] + share * (to[2] - from[2])), ...extras];
  });
}

/**
 * What processing made of a page of points, in their order: the processed
 * points between its first and its last, read as a range of their primary key
 * beside the points' own — not looked up point by point in a join, which
 * Postgres plans as one index probe a point (a day of 1 Hz points is 86 400 of
 * them). The raw level needs none.
 */
async function processedRows(
  db: Executor,
  deviceId: string,
  page: readonly LocationRow[],
  level: ProcessingLevel,
  railAlign: boolean,
): Promise<ProcessedRow[]> {
  const first = page[0];
  const last = page.at(-1);
  if (level === "raw" || first === undefined || last === undefined) return [];
  // With the kill switch off the rail places are not even read (docs/architecture.md §17.3).
  const withRail = level === "inferred" && railAlign;
  const rows = await db.execute<ProcessedRow>(sql`
    SELECT extract(epoch FROM recorded_at)::float8 AS t, kept, lat_avg, lon_avg, lat_map, lon_map,
      speed_avg, ${level === "averaged" ? sql`NULL::jsonb` : sql`path_map`} AS path_map,
      ${withRail ? sql`lat_rail` : sql`NULL::float8`} AS lat_rail,
      ${withRail ? sql`lon_rail` : sql`NULL::float8`} AS lon_rail,
      ${withRail ? sql`path_rail` : sql`NULL::jsonb`} AS path_rail
    FROM processed_points
    WHERE device_id = ${deviceId}
      AND recorded_at >= ${first.recorded_at}::timestamptz
      AND recorded_at <= ${last.recorded_at}::timestamptz
    ORDER BY recorded_at
  `);
  return rows.rows;
}

/**
 * The device's points in range at `level` (or the best below it), oldest
 * first. Too many to hold, every k-th is kept — and the points at `ends`
 * (epoch seconds: the segments' ends, so their lines still meet).
 */
async function servedPoints(
  db: Executor,
  deviceId: string,
  range: { from: Date; to: Date },
  level: ProcessingLevel,
  ends: ReadonlySet<number>,
  values: readonly LevelValue[],
  railAlign: boolean,
): Promise<Served[]> {
  const count = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM locations
    WHERE device_id = ${deviceId} AND recorded_at >= ${range.from.toISOString()}::timestamptz
      AND recorded_at < ${range.to.toISOString()}::timestamptz
  `);
  const stride = Math.max(1, Math.ceil((count.rows[0]?.count ?? 0) / holdLimit));
  const served: Served[] = [];
  let previous: LevelPoint | null = null;
  // Where the rail's shape starts from: the previous point's place along the railway, else its own.
  let previousRail: LevelPoint | null = null;
  let cursor: string | null = null;
  let seen = 0;
  for (;;) {
    const after: SQL =
      cursor === null
        ? sql`recorded_at >= ${range.from.toISOString()}::timestamptz`
        : sql`recorded_at > ${cursor}::timestamptz`;
    const page: { rows: LocationRow[] } = await db.execute<LocationRow>(sql`
      SELECT recorded_at::text, extract(epoch FROM recorded_at)::float8 AS t, lat, lon,
        horizontal_accuracy, altitude, speed
      FROM locations
      WHERE device_id = ${deviceId} AND ${after}
        AND recorded_at < ${range.to.toISOString()}::timestamptz
      ORDER BY recorded_at
      LIMIT ${pageSize}
    `);
    const processed = await processedRows(db, deviceId, page.rows, level, railAlign);
    // Both ordered by time, every processed point one of the page's: they merge in one pass.
    let next = 0;
    for (const row of page.rows) {
      seen += 1;
      while ((processed[next]?.t ?? Number.POSITIVE_INFINITY) < row.t) next += 1;
      const done = processed[next]?.t === row.t ? processed[next] : undefined;
      const t = Math.round(row.t);
      // The values asked for after `t`: the fix's own altitude and accuracy, the speed of the level.
      const valuesOf = (speed: number | null, own = true): (number | null)[] =>
        values.map((value) =>
          value === "speed"
            ? speed
            : !own
              ? null
              : value === "altitude"
                ? row.altitude
                : row.horizontal_accuracy,
        );
      let entry: Served | null = null;
      if (done === undefined || level === "raw") {
        if (row.horizontal_accuracy === null || row.horizontal_accuracy <= rawMaxAccuracyM) {
          entry = {
            t,
            level: "raw",
            vertices: noVertices,
            point: [
              row.lon,
              row.lat,
              t,
              ...valuesOf(row.speed !== null && row.speed >= 0 ? row.speed : null),
            ],
            accuracy: row.horizontal_accuracy,
          };
        }
      } else if (done.kept && done.lat_avg !== null && done.lon_avg !== null) {
        if (level !== "averaged" && done.lat_map !== null && done.lon_map !== null) {
          const here: LevelPoint = [done.lon_map, done.lat_map, t, ...valuesOf(done.speed_avg)];
          entry = {
            t,
            level: "mapped",
            // The way's shape takes the speed of the point it leads to, and no altitude or accuracy.
            vertices: withTimes(
              previous,
              done.path_map ?? [],
              here,
              valuesOf(done.speed_avg, false),
            ),
            point: here,
            accuracy: null,
          };
        } else {
          entry = {
            t,
            level: "averaged",
            vertices: noVertices,
            point: [done.lon_avg, done.lat_avg, t, ...valuesOf(done.speed_avg)],
            accuracy: null,
          };
        }
        if (level === "inferred" && done.lat_rail !== null && done.lon_rail !== null) {
          const there: LevelPoint = [done.lon_rail, done.lat_rail, t, ...valuesOf(done.speed_avg)];
          entry.rail = {
            vertices: withTimes(
              previousRail,
              done.path_rail ?? [],
              there,
              valuesOf(done.speed_avg, false),
            ),
            point: there,
          };
        }
      }
      if (entry === null) continue;
      previous = entry.point;
      previousRail = entry.rail?.point ?? entry.point;
      // Every k-th point when there are too many to hold; the way's shape and the ends always stay.
      const shaped = entry.vertices.length > 0 || (entry.rail?.vertices.length ?? 0) > 0;
      if (stride > 1 && seen % stride !== 0 && !shaped && !ends.has(t)) {
        continue;
      }
      served.push(entry);
    }
    const last = page.rows.at(-1);
    if (last === undefined || page.rows.length < pageSize) break;
    cursor = toIso(last.recorded_at);
  }
  return served;
}

interface Piece {
  segment: Omit<LevelTrackSegment, "points" | "level" | "distanceM"> & { distanceM: number | null };
  served: Served[];
}

const trackPiece = (deviceId: string, served: Served[]): Piece => ({
  segment: {
    id: null,
    deviceId,
    kind: "track",
    mode: null,
    modeInferred: null,
    modeUser: null,
    confidence: null,
    needsReview: false,
    startedAt: new Date((served[0]?.t ?? 0) * 1000).toISOString(),
    endedAt: new Date((served.at(-1)?.t ?? 0) * 1000).toISOString(),
    distanceM: null,
    centroid: null,
    spreadM: null,
    alignedTo: null,
  },
  served,
});

/** Continuous pieces of track, split where recording paused for more than ten minutes. */
function splitAtGaps(deviceId: string, served: Served[]): Piece[] {
  const pieces: Piece[] = [];
  let current: Served[] = [];
  for (const entry of served) {
    const before = current.at(-1);
    if (before !== undefined && entry.t - before.t > trackGapSeconds) {
      pieces.push(trackPiece(deviceId, current));
      current = [];
    }
    current.push(entry);
  }
  if (current.length > 0) pieces.push(trackPiece(deviceId, current));
  return pieces;
}

/** A segment's own points end here (epoch seconds): a stop's can end before the stop does. */
const ownEndOf = (row: SegmentRow): number => {
  const end = Date.parse(toIso(row.ended_at)) / 1000;
  return row.kind === "stop" && row.last_point_t !== null ? Math.min(end, row.last_point_t) : end;
};

/**
 * Stops and moves with their points — a stop's too, so the map can draw where
 * the device went within it — and points outside every segment as pieces of
 * track. Consecutive segments share their boundary point, unless a stop
 * lasted beyond its last point (until the phone left): its points are its
 * own, and the point the phone resumed at is the next move's.
 */
function piecesOfSegments(
  deviceId: string,
  served: Served[],
  rows: readonly SegmentRow[],
  railAlign: boolean,
): Piece[] {
  const pieces: Piece[] = [];
  let loose: Served[] = [];
  // The point at a boundary belongs to both segments (no gap in the line), but never to loose
  // track, and neither does any other point in a segment's time.
  let lastIncluded = Number.NEGATIVE_INFINITY;
  const takeLoose = (entry: Served) => {
    if (entry.t > lastIncluded) loose.push(entry);
  };
  const flushLoose = () => {
    if (loose.length > 0) pieces.push(...splitAtGaps(deviceId, loose));
    loose = [];
  };
  let index = 0;
  const alignedRows = rows.map((row) => toSegment(row, railAlign).alignedTo === "rail");
  for (const [rowIndex, row] of rows.entries()) {
    const segment = toSegment(row, railAlign);
    const start = Date.parse(segment.startedAt) / 1000;
    const end = Date.parse(segment.endedAt) / 1000;
    // The point shared with a neighbour drawn along the rails is drawn at its rail place on both
    // sides, so the line does not break at the boundary.
    const before = rows[rowIndex - 1];
    const after = rows[rowIndex + 1];
    const sharesRailStart =
      alignedRows[rowIndex - 1] === true &&
      before !== undefined &&
      Date.parse(toIso(before.ended_at)) / 1000 === start;
    const sharesRailEnd =
      alignedRows[rowIndex + 1] === true &&
      after !== undefined &&
      Date.parse(toIso(after.started_at)) / 1000 === end;
    while (index < served.length && (served[index]?.t ?? 0) < start) {
      const entry = served[index];
      if (entry !== undefined) takeLoose(entry);
      index += 1;
    }
    flushLoose();
    const own = ownEndOf(row);
    const inside: Served[] = [];
    const rail = segment.alignedTo === "rail";
    let cursor = index;
    while (cursor < served.length && (served[cursor]?.t ?? 0) <= end) {
      const entry = served[cursor];
      // A segment's line starts at its first point: the way's shape before it is the one before's.
      if (entry !== undefined && entry.t <= own) {
        const atRailBoundary =
          entry.rail !== undefined &&
          ((sharesRailStart && entry.t === start) || (sharesRailEnd && entry.t === end));
        const drawn = rail
          ? alongRail(entry)
          : atRailBoundary && entry.rail !== undefined
            ? { ...entry, point: entry.rail.point }
            : entry;
        inside.push(inside.length === 0 ? { ...drawn, vertices: noVertices } : drawn);
      }
      cursor += 1;
    }
    lastIncluded = Math.max(lastIncluded, end);
    // The point at the end starts the next segment too.
    index = cursor > index && served[cursor - 1]?.t === end ? cursor - 1 : cursor;
    pieces.push({
      segment: {
        id: segment.id,
        deviceId,
        kind: segment.kind,
        mode: segment.mode,
        modeInferred: segment.modeInferred,
        modeUser: segment.modeUser,
        confidence: segment.confidence,
        needsReview: segment.needsReview,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        distanceM: segment.distanceM,
        centroid: segment.kind === "stop" ? segment.centroid : null,
        spreadM: segment.spreadM,
        alignedTo: segment.alignedTo,
      },
      served: inside,
    });
  }
  for (; index < served.length; index += 1) {
    const entry = served[index];
    if (entry !== undefined) takeLoose(entry);
  }
  flushLoose();
  return pieces;
}

/** Distance of a piece of track: jitter-suppressed for raw points, along the line otherwise. */
function pieceDistance(piece: Piece): number {
  if (piece.served.every((entry) => entry.level === "raw")) {
    const distance = new DistanceAccumulator();
    for (const entry of piece.served) {
      distance.add({
        lat: entry.point[1],
        lon: entry.point[0],
        t: entry.t,
        accuracy: entry.accuracy,
      });
    }
    return distance.totalM;
  }
  let total = 0;
  let previous: LevelPoint | null = null;
  const step = (point: LevelPoint) => {
    if (previous !== null) {
      total += haversineM({ lat: previous[1], lon: previous[0] }, { lat: point[1], lon: point[0] });
    }
    previous = point;
  };
  for (const entry of piece.served) {
    for (const vertex of entry.vertices) step(vertex);
    step(entry.point);
  }
  return total;
}

/** A piece's line: every point after the way's shape that leads to it. */
function lineOf(piece: Piece): LevelPoint[] {
  const line: LevelPoint[] = [];
  for (const entry of piece.served) {
    for (const vertex of entry.vertices) line.push(vertex);
    line.push(entry.point);
  }
  return line;
}

/**
 * Tracks at a level of calculation (docs/architecture.md §17.6). Every point
 * is served at the requested level or the best one below it that exists yet:
 * points not processed yet stay raw, points without map data averaged. On the
 * inferred level the points are grouped into the timeline's stops and moves.
 * `availableLevel` is the level every point reached. Per device, at most
 * `maxPoints` (one RDP tolerance for all its pieces, their ends always kept).
 */
export async function loadLevelTracks(
  db: Executor,
  access: DeviceAccess,
  query: {
    devices?: readonly string[] | undefined;
    from: Date;
    to: Date;
    level: ProcessingLevel;
    maxPoints: number;
    values?: readonly LevelValue[];
    /** `PROCESSING_RAIL_ALIGN`: off, no line is drawn along the rails, whatever is stored. */
    railAlign: boolean;
  },
): Promise<LevelTracksResponse> {
  const values = query.values ?? [];
  const owned = await resolveDeviceIds(db, access, query.devices);
  const segments: LevelTrackSegment[] = [];
  let available: ProcessingLevel = query.level;
  let simplified = false;
  for (const device of owned) {
    let pieces: Piece[];
    if (query.level === "inferred") {
      // The timeline's stops and moves, a stay one stop: the map and the timeline name the same.
      const rows = await db.execute<SegmentRow>(sql`
        SELECT ${servedColumns} FROM ${servedSegments([device.id], query)}
        WHERE ${segmentOverlaps(
          "s",
          sql`${query.from.toISOString()}::timestamptz`,
          sql`${query.to.toISOString()}::timestamptz`,
        )}
        ORDER BY s.started_at
      `);
      const ends = new Set<number>();
      for (const row of rows.rows) {
        ends.add(Math.round(Date.parse(toIso(row.started_at)) / 1000));
        ends.add(Math.round(Date.parse(toIso(row.ended_at)) / 1000));
        ends.add(Math.round(ownEndOf(row)));
      }
      const served = await servedPoints(
        db,
        device.id,
        query,
        query.level,
        ends,
        values,
        query.railAlign,
      );
      pieces = piecesOfSegments(device.id, served, rows.rows, query.railAlign);
    } else {
      pieces = splitAtGaps(
        device.id,
        await servedPoints(db, device.id, query, query.level, new Set(), values, query.railAlign),
      );
    }
    const lines = pieces.map(lineOf);
    const total = lines.reduce((sum, line) => sum + line.length, 0);
    const kept = simplifyParts(lines, query.maxPoints);
    if (kept.reduce((sum, line) => sum + line.length, 0) < total) simplified = true;
    for (const [index, piece] of pieces.entries()) {
      let level: ProcessingLevel = "mapped";
      for (const entry of piece.served) level = lower(level, entry.level);
      if (piece.served.length === 0) level = query.level === "inferred" ? "averaged" : query.level;
      // Stops and moves are the inferred level when their points reached the mapped one.
      if (piece.segment.kind !== "track" && level === "mapped") level = "inferred";
      level = lower(level, query.level);
      available = lower(available, level);
      segments.push({
        ...piece.segment,
        level,
        distanceM: Math.round((piece.segment.distanceM ?? pieceDistance(piece)) * 10) / 10,
        points: kept[index] ?? [],
      });
    }
  }
  return {
    level: query.level,
    ...(values.length === 0 ? {} : { values: [...values] }),
    availableLevel: available,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    simplified,
    segments,
  };
}
