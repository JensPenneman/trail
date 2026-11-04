import type { InsightsWays } from "@trail/contracts/insights";
import type { WayKind } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { hasPendingWork } from "../processing/processingQueue";
import { groupWays, type NamedWay } from "./groupWays";
import { hourParts } from "./hourParts";
import { roundMetres, shareOf } from "./insightsRounding";
import type { InsightsScope } from "./insightsScope";
import type { MoveWays } from "./loadMoveWays";
import { modesIn } from "./modesIn";

/** The roads listed, longest first. */
export const maxWayRows = 50;
/** At most this many ways are looked up for their names (the longest ones). */
export const maxNamedWays = 20_000;

/** The metres on each way over the period's hours: a move counts in proportion to its time inside. */
export function periodWayTotals(
  moves: readonly MoveWays[],
  hours: InsightsScope["hours"],
  mode: string | null,
): { distanceM: number; ways: Map<number, number> } {
  const ways = new Map<number, number>();
  let distanceM = 0;
  for (const move of moves) {
    if (mode !== null && move.mode !== mode) continue;
    let inside = 0;
    for (const part of hourParts(move, hours)) inside += part.distanceM;
    distanceM += inside;
    if (move.distanceM <= 0) continue;
    const factor = inside / move.distanceM;
    for (const [id, metres] of move.wayTotals) ways.set(id, (ways.get(id) ?? 0) + metres * factor);
  }
  return { distanceM, ways };
}

interface WayRow extends Record<string, unknown> {
  id: number;
  name: string;
  kind: WayKind;
  lat: number;
  lon: number;
}

/** The named ways among `ids` (the newest row of each), with the centre of their bounding box. */
async function namedWays(db: Executor, ids: readonly number[]): Promise<Map<number, WayRow>> {
  if (ids.length === 0) return new Map();
  const result = await db.execute<WayRow>(sql`
    SELECT DISTINCT ON (id) id, tags->>'name' AS name, kind,
      (min_lat + max_lat) / 2 AS lat, (min_lon + max_lon) / 2 AS lon
    FROM osm_ways
    WHERE id = ANY(${sql.param(ids)}::bigint[]) AND tags ? 'name'
    ORDER BY id, fetched_at DESC
  `);
  return new Map(result.rows.map((row) => [Number(row.id), row]));
}

/**
 * What the names of the ways depend on, beside the moves (`insightsValidator`): the map data in
 * the database — the ready builds of the regions and the fetched tiles.
 */
export async function mapStamp(db: Executor): Promise<unknown> {
  const result = await db.execute<{ builds: string | null; tiles: number; fetched: string | null }>(
    sql`
      SELECT (SELECT string_agg(digest, ',' ORDER BY digest) FROM osm_regions WHERE status = 'ready') AS builds,
        (SELECT count(*)::int FROM osm_tiles WHERE status = 'ok') AS tiles,
        (SELECT max(fetched_at)::text FROM osm_tiles WHERE status = 'ok') AS fetched
    `,
  );
  return result.rows[0] ?? null;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** `GET /api/v1/insights/ways`: the roads travelled, by name (docs/architecture.md §8.7). */
export async function loadWays(
  db: Executor,
  scope: InsightsScope,
  mode: InsightsWays["mode"],
  moves: readonly MoveWays[],
): Promise<InsightsWays> {
  const { distanceM, ways } = periodWayTotals(moves, scope.hours, mode);
  const ranked = [...ways].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, maxNamedWays);
  const names = await namedWays(
    db,
    ranked.map(([id]) => id),
  );
  const named: NamedWay[] = [];
  for (const [id, metres] of ranked) {
    const way = names.get(id);
    if (way !== undefined)
      named.push({ name: way.name, kind: way.kind, metres, lat: way.lat, lon: way.lon });
  }
  const groups = groupWays(named);
  const namedM = groups.reduce((sum, group) => sum + group.metres, 0);
  return {
    timezone: scope.timezone,
    period: scope.period,
    mode,
    modes: modesIn(moves, scope.hours),
    distanceM: roundMetres(distanceM),
    namedM: roundMetres(namedM),
    ways: groups.slice(0, maxWayRows).map((group) => ({
      name: group.name,
      kind: group.kind,
      distanceM: roundMetres(group.metres),
      share: shareOf(group.metres, namedM),
      ways: group.ways,
      lat: round3(group.lat),
      lon: round3(group.lon),
    })),
    pending: await hasPendingWork(db, scope.deviceIds, scope.start, scope.end),
  };
}
