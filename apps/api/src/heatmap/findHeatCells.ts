import type { HeatmapResponse } from "@trail/contracts/heatmap";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { chooseCellZoom } from "./chooseCellZoom";
import { latToTileY, lonToTileX, tileCentre } from "./tileMath";

const maxCells = 20_000;

interface CellRow extends Record<string, unknown> {
  x: number;
  y: number;
  count: string | number;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * All-time density in the viewport from the pre-aggregated cells
 * (docs/architecture.md §8.2), summed over the devices the principal reaches —
 * for the dashboard's `/api/heatmap` and v1's `/api/v1/heatmap`.
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

  const [west, south, east, north] = query.bbox;
  const yMin = latToTileY(Math.max(north, south), z);
  const yMax = latToTileY(Math.min(north, south), z);
  const xWest = lonToTileX(west, z);
  const xEast = lonToTileX(east, z);
  // A viewport across the antimeridian has west > east: two column ranges.
  const columns =
    west <= east ? sql`x BETWEEN ${xWest} AND ${xEast}` : sql`(x >= ${xWest} OR x <= ${xEast})`;
  const ids = owned.map((device) => device.id);

  const result = await db.execute<CellRow>(sql`
    SELECT x, y, sum(count) AS count
    FROM heat_cells
    WHERE device_id = ANY(${sql.param(ids)}::uuid[]) AND z = ${z}
      AND y BETWEEN ${yMin} AND ${yMax} AND ${columns}
    GROUP BY x, y
    ORDER BY count DESC, x, y
    LIMIT ${maxCells + 1}
  `);
  return {
    cellZoom: z,
    cells: result.rows.slice(0, maxCells).map((row) => {
      const [lon, lat] = tileCentre(row.x, row.y, z);
      return [round6(lon), round6(lat), Number(row.count)];
    }),
    truncated: result.rows.length > maxCells,
  };
}
