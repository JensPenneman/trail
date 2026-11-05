import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { chooseCellZoom } from "./chooseCellZoom";
import { heatCellWindow } from "./heatCellWindow";

interface CellRow extends Record<string, unknown> {
  cell_x: number;
  cell_y: number;
  total: string | number;
}

/** The cells of one level, busiest first: `[x, y, value]` tiles of `cellZoom`. */
export interface HeatCells {
  cellZoom: number;
  cells: [number, number, number][];
  /** More cells than `limit` were in the viewport. */
  truncated: boolean;
}

/**
 * All-time density in the viewport from the pre-aggregated cells
 * (docs/architecture.md §8.2), summed over the devices the principal reaches —
 * for the dashboard's `/api/heatmap` and v1's `/api/v1/heatmap`, which differ
 * in `limit` and in what they make of the tiles. A level that is not stored is
 * summed on read from the next finer stored one, whose cell (x, y) lies in the
 * cell (x >> s, y >> s) of the level s coarser.
 */
export async function findHeatCells(
  db: Executor,
  access: DeviceAccess,
  query: {
    bbox: readonly [number, number, number, number];
    zoom: number;
    deviceIds?: readonly string[] | undefined;
  },
  options: { limit: number },
): Promise<HeatCells> {
  const owned = await resolveDeviceIds(db, access, query.deviceIds);
  const z = chooseCellZoom(query.zoom);
  if (owned.length === 0) return { cellZoom: z, cells: [], truncated: false };

  const area = heatCellWindow(query.bbox, z);
  const [yMin, yMax] = area.rows;
  const [xFrom, xTo] = area.columns;
  const columns = area.wraps
    ? sql`(x >= ${xFrom} OR x <= ${xTo})`
    : sql`x BETWEEN ${xFrom} AND ${xTo}`;
  const ids = owned.map((device) => device.id);

  const result = await db.execute<CellRow>(sql`
    SELECT x >> ${area.shift}::int AS cell_x, y >> ${area.shift}::int AS cell_y,
      sum(count) AS total
    FROM heat_cells
    WHERE device_id = ANY(${sql.param(ids)}::uuid[]) AND z = ${area.stored}
      AND y BETWEEN ${yMin} AND ${yMax} AND ${columns}
    GROUP BY cell_x, cell_y
    ORDER BY total DESC, cell_x, cell_y
    LIMIT ${options.limit + 1}
  `);
  return {
    cellZoom: z,
    cells: result.rows
      .slice(0, options.limit)
      .map((row) => [row.cell_x, row.cell_y, Number(row.total)] as [number, number, number]),
    truncated: result.rows.length > options.limit,
  };
}
