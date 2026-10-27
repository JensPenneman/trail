import type { HeatmapResponse } from "@trail/contracts/heatmap";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { chooseCellZoom } from "./chooseCellZoom";
import { heatCellWindow } from "./heatCellWindow";
import { tileCentre } from "./tileMath";

const maxCells = 20_000;

interface CellRow extends Record<string, unknown> {
  cell_x: number;
  cell_y: number;
  total: string | number;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * All-time density in the viewport from the pre-aggregated cells
 * (docs/architecture.md §8.2), summed over the devices the principal reaches —
 * for the dashboard's `/api/heatmap` and v1's `/api/v1/heatmap`. A level that
 * is not stored is summed on read from the next finer stored one, whose cell
 * (x, y) lies in the cell (x >> s, y >> s) of the level s coarser.
 */
export async function findHeatCells(
  db: Executor,
  access: DeviceAccess,
  query: {
    bbox: readonly [number, number, number, number];
    zoom: number;
    deviceIds?: readonly string[] | undefined;
  },
): Promise<HeatmapResponse> {
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
    LIMIT ${maxCells + 1}
  `);
  return {
    cellZoom: z,
    cells: result.rows.slice(0, maxCells).map((row) => {
      const [lon, lat] = tileCentre(row.cell_x, row.cell_y, z);
      return [round6(lon), round6(lat), Number(row.total)];
    }),
    truncated: result.rows.length > maxCells,
  };
}
