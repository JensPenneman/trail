import type { InsightsWays } from "@trail/contracts/insights";
import type { TransportMode, WayKind } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { hasPendingWork } from "../processing/processingQueue";
import { groupWays, type NamedWay } from "./groupWays";
import { hourParts } from "./hourParts";
import { roundMetres } from "./insightsRounding";
import type { InsightsScope } from "./insightsScope";
import type { MoveWays } from "./loadMoveWays";
import { modesIn } from "./modesIn";

/** The roads listed, longest first. */
const maxWayRows = 25;
/** At most this many ways are looked up for their names (the longest ones). */
const maxNamedWays = 20_000;

/**
 * The metres on each way over the period's hours, for the moves of `mode` (every mode when null): a
 * move counts in proportion to its time inside the period. `mappedM` is the distance of moves with
 * map data, `lacking` whether a move still waits for the feature backfill.
 */
export function periodWayTotals(
  moves: readonly MoveWays[],
  hours: InsightsScope["hours"],
  mode: TransportMode | null,
): { mappedM: number; lacking: boolean; ways: Map<number, { metres: number; moves: number[] }> } {
  const ways = new Map<number, { metres: number; moves: number[] }>();
  let mappedM = 0;
  let lacking = false;
  for (const [index, move] of moves.entries()) {
    if (mode !== null && move.mode !== mode) continue;
    let inside = 0;
    let touches = false;
    for (const part of hourParts(move, hours)) {
      inside += part.distanceM;
      touches = true;
    }
    if (touches && move.lacking) lacking = true;
    if (move.wayTotals === null) continue;
    mappedM += inside;
    if (move.distanceM <= 0) continue;
    const factor = inside / move.distanceM;
    for (const [id, metres] of move.wayTotals) {
      const way = ways.get(id) ?? { metres: 0, moves: [] };
      way.metres += metres * factor;
      way.moves.push(index);
      ways.set(id, way);
    }
  }
  return { mappedM, lacking, ways };
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
 * `GET /api/v1/insights/ways`: the roads travelled, by name (docs/architecture.md §8.7), from every
 * mode's moves (for `modes`) of which `mode`'s are counted. Names and distances only: the position
 * of a way serves the grouping and is not answered.
 */
export async function loadWays(
  db: Executor,
  scope: InsightsScope,
  mode: TransportMode | null,
  moves: readonly MoveWays[],
): Promise<InsightsWays> {
  const { mappedM, lacking, ways } = periodWayTotals(moves, scope.hours, mode);
  const ranked = [...ways]
    .sort((a, b) => b[1].metres - a[1].metres || a[0] - b[0])
    .slice(0, maxNamedWays);
  const names = await namedWays(
    db,
    ranked.map(([id]) => id),
  );
  const named: NamedWay[] = [];
  for (const [id, way] of ranked) {
    const found = names.get(id);
    if (found !== undefined) {
      named.push({
        name: found.name,
        kind: found.kind,
        metres: way.metres,
        lat: found.lat,
        lon: found.lon,
        moves: way.moves,
      });
    }
  }
  const groups = groupWays(named);
  const namedM = groups.reduce((sum, group) => sum + group.metres, 0);
  return {
    timezone: scope.timezone,
    period: scope.period,
    mode,
    modes: modesIn(moves, scope.hours),
    mappedM: roundMetres(mappedM),
    namedM: roundMetres(namedM),
    ways: groups.slice(0, maxWayRows).map((group) => ({
      name: group.name,
      kind: group.kind,
      distanceM: roundMetres(group.metres),
      moves: group.moves,
    })),
    pending: lacking || (await hasPendingWork(db, scope.deviceIds, scope.start, scope.end)),
  };
}
