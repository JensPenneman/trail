import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { addDays } from "../lib/calendarDate";
import { startOfLocalDay } from "../lib/startOfLocalDay";
import { heatDayMaxIntervalS, heatDayZooms } from "./heatDayLevels";
import { tileXSql, tileYSql } from "./tileSql";

const earthRadiusM = 6_371_008.8;

/**
 * Writes `heat_days` for the local `days` of a device (or all of them) from its kept processed
 * points and its segments (docs/architecture.md §5, §17.4): the rows of those days are deleted and
 * one statement makes them again. The interval from a kept point to the next belongs to the
 * first one's cell, day and mode; the mode is that of the segment the point lies in (a move's,
 * `stationary` in a stop, `unknown` outside any), found by the latest segment started by then, so
 * one pass of the points does it. Positions are the mapped ones, else the averaged. The caller's
 * transaction holds the device's lock. Returns the rows written.
 */
export async function rebuildHeatDays(
  tx: Executor,
  deviceId: string,
  timezone: string,
  days: readonly string[] | "all",
): Promise<number> {
  if (days !== "all" && days.length === 0) return 0;
  const list = days === "all" ? null : [...new Set(days)].sort();
  const first = list?.[0];
  const last = list?.at(-1);
  await tx.execute(
    list === null
      ? sql`DELETE FROM heat_days WHERE device_id = ${deviceId}::uuid`
      : sql`DELETE FROM heat_days WHERE device_id = ${deviceId}::uuid AND day = ANY(${sql.param(list)}::date[])`,
  );
  // The points of the days and, for the last edge, the 600 s after them.
  const range: SQL =
    first === undefined || last === undefined
      ? sql`TRUE`
      : sql`p.recorded_at >= ${new Date(startOfLocalDay(first, timezone)).toISOString()}::timestamptz
        AND p.recorded_at < ${new Date(startOfLocalDay(addDays(last, 1), timezone) + heatDayMaxIntervalS * 1000).toISOString()}::timestamptz`;
  const inDays: SQL = list === null ? sql`TRUE` : sql`t.day = ANY(${sql.param(list)}::date[])`;
  const zooms = sql.raw(heatDayZooms.map((z) => `(${z})`).join(", "));
  const r = sql.raw(String(earthRadiusM));
  const result = await tx.execute(sql`
    WITH pts AS (
      SELECT p.recorded_at, coalesce(p.lat_map, p.lat_avg) AS lat,
        coalesce(p.lon_map, p.lon_avg) AS lon, p.speed_avg,
        lead(p.recorded_at) OVER w AS next_at,
        lead(coalesce(p.lat_map, p.lat_avg)) OVER w AS next_lat,
        lead(coalesce(p.lon_map, p.lon_avg)) OVER w AS next_lon
      FROM processed_points p
      WHERE p.device_id = ${deviceId}::uuid AND p.kept AND ${range}
      WINDOW w AS (ORDER BY p.recorded_at)
    ), tagged AS (
      SELECT o.lat, o.lon, o.speed_avg, (o.recorded_at AT TIME ZONE ${timezone})::date AS day,
        CASE WHEN s.ended_at >= o.recorded_at
          THEN (CASE s.kind WHEN 'move' THEN s.mode ELSE 'stationary' END)
          ELSE 'unknown' END AS mode,
        s.ended_at >= o.recorded_at AND s.kind = 'move' AND o.next_at IS NOT NULL
          AND extract(epoch FROM o.next_at - o.recorded_at) <= ${heatDayMaxIntervalS} AS moving,
        extract(epoch FROM o.next_at - o.recorded_at) AS dt,
        2 * ${r} * asin(sqrt(least(1, power(sin(radians(o.next_lat - o.lat) / 2), 2)
          + cos(radians(o.lat)) * cos(radians(o.next_lat))
            * power(sin(radians(o.next_lon - o.lon) / 2), 2)))) AS metres
      FROM pts o
      LEFT JOIN LATERAL (
        SELECT kind, mode, ended_at FROM segments
        WHERE device_id = ${deviceId}::uuid AND started_at <= o.recorded_at
        ORDER BY started_at DESC LIMIT 1
      ) s ON TRUE
    ), cells AS (
      SELECT z.z, ${tileXSql(sql`t.lon`, sql`z.z`)} AS x, ${tileYSql(sql`t.lat`, sql`z.z`)} AS y,
        t.day, t.mode, t.moving, t.dt, t.metres,
        coalesce(t.speed_avg, t.metres / nullif(t.dt, 0)) AS speed
      FROM tagged t
      CROSS JOIN (VALUES ${zooms}) AS z(z)
      WHERE ${inDays}
    )
    INSERT INTO heat_days (device_id, z, x, y, day, mode, points, move_s, distance_m, speed_s,
      max_speed, computed_at)
    SELECT ${deviceId}::uuid, c.z, c.x, c.y, c.day, c.mode, count(*)::int,
      coalesce(round(sum(c.dt) FILTER (WHERE c.moving))::int, 0),
      coalesce(sum(c.metres) FILTER (WHERE c.moving), 0)::real,
      coalesce(sum(c.dt * c.speed) FILTER (WHERE c.moving), 0)::real,
      max(c.speed) FILTER (WHERE c.moving)::real, now()
    FROM cells c
    GROUP BY c.z, c.x, c.y, c.day, c.mode
  `);
  return result.rowCount ?? 0;
}
