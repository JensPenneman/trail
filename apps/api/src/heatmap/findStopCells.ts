import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { servedSegments } from "../transport/servedSegments";
import type { HeatCells } from "./findHeatCells";
import { viewCells } from "./heatCellCap";
import { tileXSql, tileYSql } from "./tileSql";

interface StopCellRow extends Record<string, unknown> {
  x: number;
  y: number;
  time_s: string | number;
  visits: number;
}

/**
 * Time spent and visits per cell (docs/architecture.md §8.2): the stays of `deviceIds` clipped to
 * `[start, end)`, each in the cell of level `cellZoom` its centre lies in, and the stays of one
 * cell merged where they overlap or touch — two phones at the same place count once — so a cell's
 * time is the time somebody was there and its visits the merged stays that overlap the period.
 * Whole cells, busiest first (by time for `time`, by visits for `visits`), `limit` of them.
 */
export async function findStopCells(
  db: Executor,
  input: {
    deviceIds: readonly string[];
    heat: "time" | "visits";
    bbox: readonly [number, number, number, number];
    cellZoom: number;
    start: Date;
    end: Date;
    limit: number;
  },
): Promise<HeatCells> {
  const { deviceIds, heat, cellZoom, limit } = input;
  if (deviceIds.length === 0) return { cellZoom, cells: [], truncated: false };
  const area = viewCells(input.bbox, cellZoom);
  const [yMin, yMax] = area.rows;
  const [xFrom, xTo] = area.columns;
  const start = input.start.toISOString();
  const end = input.end.toISOString();
  const z = sql`${cellZoom}::int`;
  const columns = area.wraps
    ? sql`(x >= ${xFrom} OR x <= ${xTo})`
    : sql`x BETWEEN ${xFrom} AND ${xTo}`;
  const seconds = sql`round(sum(extract(epoch FROM b - a)))`;
  const result = await db.execute<StopCellRow>(sql`
    WITH stays AS (
      SELECT greatest(s.started_at, ${start}::timestamptz) AS a, least(s.ended_at, ${end}::timestamptz) AS b,
        ${tileXSql(sql`s.centroid_lon`, z)} AS x, ${tileYSql(sql`s.centroid_lat`, z)} AS y
      FROM ${servedSegments(deviceIds, { from: input.start, to: input.end })}
      WHERE s.kind = 'stop' AND s.started_at < ${end}::timestamptz AND s.ended_at > ${start}::timestamptz
        AND s.centroid_lat IS NOT NULL AND s.centroid_lon IS NOT NULL
    ), inview AS (
      SELECT * FROM stays WHERE y BETWEEN ${yMin} AND ${yMax} AND ${columns}
    ), reach AS (
      SELECT *, max(b) OVER (PARTITION BY x, y ORDER BY a, b
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS before_end
      FROM inview
    ), islands AS (
      SELECT *, count(*) FILTER (WHERE before_end IS NULL OR a > before_end)
        OVER (PARTITION BY x, y ORDER BY a, b) AS island
      FROM reach
    ), merged AS (
      SELECT x, y, min(a) AS a, max(b) AS b FROM islands GROUP BY x, y, island
    )
    SELECT x, y, ${seconds}::bigint AS time_s, count(*)::int AS visits
    FROM merged
    GROUP BY x, y
    ${heat === "time" ? sql`HAVING ${seconds} > 0` : sql``}
    ORDER BY ${heat === "time" ? sql`${seconds} DESC, visits DESC` : sql`visits DESC, ${seconds} DESC`}, x, y
    LIMIT ${limit + 1}
  `);
  return {
    cellZoom,
    cells: result.rows
      .slice(0, limit)
      .map(
        (row) =>
          [row.x, row.y, heat === "time" ? Number(row.time_s) : row.visits] as [
            number,
            number,
            number,
          ],
      ),
    truncated: result.rows.length > limit,
  };
}
