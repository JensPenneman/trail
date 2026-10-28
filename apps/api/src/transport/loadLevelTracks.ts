import { trackGapSeconds } from "@trail/contracts/trackSegments";
import {
  type LevelPoint,
  type LevelTrackSegment,
  type LevelTracksResponse,
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

interface JoinedRow extends Record<string, unknown> {
  recorded_at: string;
  t: number;
  lat: number;
  lon: number;
  horizontal_accuracy: number | null;
  kept: boolean | null;
  lat_avg: number | null;
  lon_avg: number | null;
  lat_map: number | null;
  lon_map: number | null;
  path_map: [number, number][] | null;
}

/** One served point and the level it reached; `vertices` are the way's shape before it. */
interface Served {
  t: number;
  level: ProcessingLevel;
  vertices: LevelPoint[];
  point: LevelPoint;
  accuracy: number | null;
}

/** The way's shape between two points with times interpolated along it. */
function withTimes(
  from: { lon: number; lat: number; t: number } | null,
  path: readonly [number, number][],
  to: { lon: number; lat: number; t: number },
): LevelPoint[] {
  if (from === null || path.length === 0) return [];
  const stops = [{ lon: from.lon, lat: from.lat }, ...path.map(([lon, lat]) => ({ lon, lat })), to];
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
    return [lon, lat, Math.round(from.t + share * (to.t - from.t))];
  });
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
): Promise<Served[]> {
  const count = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM locations
    WHERE device_id = ${deviceId} AND recorded_at >= ${range.from.toISOString()}::timestamptz
      AND recorded_at < ${range.to.toISOString()}::timestamptz
  `);
  const stride = Math.max(1, Math.ceil((count.rows[0]?.count ?? 0) / holdLimit));
  const served: Served[] = [];
  let previous: { lon: number; lat: number; t: number } | null = null;
  let cursor: string | null = null;
  let seen = 0;
  for (;;) {
    const after: SQL =
      cursor === null
        ? sql`l.recorded_at >= ${range.from.toISOString()}::timestamptz`
        : sql`l.recorded_at > ${cursor}::timestamptz`;
    // The raw level needs nothing of processing: no join.
    const processed: SQL =
      level === "raw"
        ? sql`NULL::boolean AS kept, NULL::float8 AS lat_avg, NULL::float8 AS lon_avg,
            NULL::float8 AS lat_map, NULL::float8 AS lon_map, NULL::jsonb AS path_map
            FROM locations l`
        : sql`p.kept, p.lat_avg, p.lon_avg, p.lat_map, p.lon_map,
            ${level === "averaged" ? sql`NULL::jsonb` : sql`p.path_map`} AS path_map
            FROM locations l
            LEFT JOIN processed_points p ON p.device_id = l.device_id AND p.recorded_at = l.recorded_at`;
    const page: { rows: JoinedRow[] } = await db.execute<JoinedRow>(sql`
      SELECT l.recorded_at::text, extract(epoch FROM l.recorded_at)::float8 AS t, l.lat, l.lon,
        l.horizontal_accuracy, ${processed}
      WHERE l.device_id = ${deviceId} AND ${after}
        AND l.recorded_at < ${range.to.toISOString()}::timestamptz
      ORDER BY l.recorded_at
      LIMIT ${pageSize}
    `);
    for (const row of page.rows) {
      seen += 1;
      const t = Math.round(row.t);
      let entry: Served | null = null;
      const unprocessed = row.kept === null || level === "raw";
      if (unprocessed) {
        if (row.horizontal_accuracy === null || row.horizontal_accuracy <= rawMaxAccuracyM) {
          entry = {
            t,
            level: "raw",
            vertices: [],
            point: [row.lon, row.lat, t],
            accuracy: row.horizontal_accuracy,
          };
        }
      } else if (row.kept === true && row.lat_avg !== null && row.lon_avg !== null) {
        if (level !== "averaged" && row.lat_map !== null && row.lon_map !== null) {
          const here = { lon: row.lon_map, lat: row.lat_map, t };
          entry = {
            t,
            level: "mapped",
            vertices: withTimes(previous, row.path_map ?? [], here),
            point: [row.lon_map, row.lat_map, t],
            accuracy: null,
          };
        } else {
          entry = {
            t,
            level: "averaged",
            vertices: [],
            point: [row.lon_avg, row.lat_avg, t],
            accuracy: null,
          };
        }
      }
      if (entry === null) continue;
      previous = { lon: entry.point[0], lat: entry.point[1], t };
      // Every k-th point when there are too many to hold; the way's shape and the ends always stay.
      if (stride > 1 && seen % stride !== 0 && entry.vertices.length === 0 && !ends.has(t)) {
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
  for (const row of rows) {
    const segment = toSegment(row);
    const start = Date.parse(segment.startedAt) / 1000;
    const end = Date.parse(segment.endedAt) / 1000;
    while (index < served.length && (served[index]?.t ?? 0) < start) {
      const entry = served[index];
      if (entry !== undefined) takeLoose(entry);
      index += 1;
    }
    flushLoose();
    const own = ownEndOf(row);
    const inside: Served[] = [];
    let cursor = index;
    while (cursor < served.length && (served[cursor]?.t ?? 0) <= end) {
      const entry = served[cursor];
      // A segment's line starts at its first point: the way's shape before it is the one before's.
      if (entry !== undefined && entry.t <= own) {
        inside.push(inside.length === 0 ? { ...entry, vertices: [] } : entry);
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
  for (const entry of piece.served) {
    for (const point of [...entry.vertices, entry.point]) {
      if (previous !== null) {
        total += haversineM(
          { lat: previous[1], lon: previous[0] },
          { lat: point[1], lon: point[0] },
        );
      }
      previous = point;
    }
  }
  return total;
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
  },
): Promise<LevelTracksResponse> {
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
        WHERE s.started_at < ${query.to.toISOString()}::timestamptz
          AND s.ended_at > ${query.from.toISOString()}::timestamptz
        ORDER BY s.started_at
      `);
      const ends = new Set<number>();
      for (const row of rows.rows) {
        ends.add(Math.round(Date.parse(toIso(row.started_at)) / 1000));
        ends.add(Math.round(Date.parse(toIso(row.ended_at)) / 1000));
        ends.add(Math.round(ownEndOf(row)));
      }
      const served = await servedPoints(db, device.id, query, query.level, ends);
      pieces = piecesOfSegments(device.id, served, rows.rows);
    } else {
      pieces = splitAtGaps(
        device.id,
        await servedPoints(db, device.id, query, query.level, new Set()),
      );
    }
    const lines = pieces.map((piece) =>
      piece.served.flatMap((entry) => [...entry.vertices, entry.point]),
    );
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
    availableLevel: available,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    simplified,
    segments,
  };
}
