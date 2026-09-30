import type { Track, TrackPoint } from "@trail/contracts/track";
import { trackSegments } from "@trail/contracts/trackSegments";
import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import { DistanceAccumulator } from "./distanceAccumulator";
import { simplifyTrack } from "./simplifyTrack";
import { TrackThinner } from "./trackThinner";

interface TrackRow extends Record<string, unknown> {
  recorded_at: string;
  epoch: number;
  lat: number;
  lon: number;
  speed: number | null;
  horizontal_accuracy: number | null;
  altitude: number | null;
}

/** Rows per round trip; the loop pages with a keyset on recorded_at. */
const pageSize = 20_000;
/** Points held in memory per track before thinning kicks in. */
const holdLimit = 200_000;

/**
 * One device's track in `[from, to)` (docs/architecture.md §8.1): points with
 * accuracy ≤ maxAccuracy (or unknown), distance over all of them, then
 * segments + one-tolerance RDP down to `maxPoints`.
 */
export async function buildTrack(
  db: Executor,
  deviceId: string,
  query: { from: Date; to: Date; maxAccuracy: number; maxPoints: number },
): Promise<Track> {
  const distance = new DistanceAccumulator();
  const thinner = new TrackThinner(holdLimit);
  let total = 0;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let cursor: string | null = null;

  for (;;) {
    const after: SQL =
      cursor === null
        ? sql`recorded_at >= ${query.from.toISOString()}::timestamptz`
        : sql`recorded_at > ${cursor}::timestamptz`;
    const page: { rows: TrackRow[] } = await db.execute<TrackRow>(sql`
      SELECT recorded_at, extract(epoch FROM recorded_at)::float8 AS epoch, lat, lon, speed,
        horizontal_accuracy, altitude
      FROM locations
      WHERE device_id = ${deviceId} AND ${after}
        AND recorded_at < ${query.to.toISOString()}::timestamptz
        AND (horizontal_accuracy IS NULL OR horizontal_accuracy <= ${query.maxAccuracy})
      ORDER BY recorded_at
      LIMIT ${pageSize}
    `);
    for (const row of page.rows) {
      const time = Math.floor(row.epoch);
      const point: TrackPoint = [
        row.lon,
        row.lat,
        time,
        row.speed,
        row.horizontal_accuracy,
        row.altitude,
      ];
      total += 1;
      distance.add({ lat: row.lat, lon: row.lon, t: row.epoch, accuracy: row.horizontal_accuracy });
      thinner.add(point);
    }
    const first = page.rows[0];
    const last: TrackRow | undefined = page.rows.at(-1);
    if (first !== undefined && firstAt === null) firstAt = toIso(first.recorded_at);
    if (last !== undefined) {
      lastAt = toIso(last.recorded_at);
      cursor = last.recorded_at;
    }
    if (page.rows.length < pageSize) break;
  }

  const points = simplifyTrack(trackSegments(thinner.finish()), query.maxPoints);
  return {
    deviceId,
    total,
    returned: points.length,
    simplified: points.length < total,
    distanceM: Math.round(distance.totalM * 10) / 10,
    firstAt,
    lastAt,
    points,
  };
}
