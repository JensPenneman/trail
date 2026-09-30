import { apiPaths } from "@trail/contracts/apiPaths";
import { type HeatmapResponse, heatmapQuerySchema } from "@trail/contracts/heatmap";
import { sql } from "drizzle-orm";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { parseQuery } from "../http/parseInput";
import { chooseCellZoom } from "./chooseCellZoom";
import { latToTileY, lonToTileX, tileCentre } from "./tileMath";

const maxCells = 20_000;

interface CellRow extends Record<string, unknown> {
  x: number;
  y: number;
  count: string | number;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** `GET /api/heatmap` — all-time density in the viewport from the pre-aggregated cells. */
export function heatmapRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.heatmap, async (req, res) => {
    const { user } = requireAuth(req);
    const query = parseQuery(heatmapQuerySchema, req);
    const owned = await resolveDeviceIds(ctx.db, user.id, query.deviceIds);
    const z = chooseCellZoom(query.zoom);
    const [west, south, east, north] = query.bbox;
    if (owned.length === 0) {
      const empty: HeatmapResponse = { cellZoom: z, cells: [], truncated: false };
      res.json(empty);
      return;
    }

    const yMin = latToTileY(Math.max(north, south), z);
    const yMax = latToTileY(Math.min(north, south), z);
    const xWest = lonToTileX(west, z);
    const xEast = lonToTileX(east, z);
    // A viewport across the antimeridian has west > east: two column ranges.
    const columns =
      west <= east ? sql`x BETWEEN ${xWest} AND ${xEast}` : sql`(x >= ${xWest} OR x <= ${xEast})`;
    const ids = owned.map((device) => device.id);

    const result = await ctx.db.execute<CellRow>(sql`
      SELECT x, y, sum(count) AS count
      FROM heat_cells
      WHERE device_id = ANY(${sql.param(ids)}::uuid[]) AND z = ${z}
        AND y BETWEEN ${yMin} AND ${yMax} AND ${columns}
      GROUP BY x, y
      ORDER BY count DESC, x, y
      LIMIT ${maxCells + 1}
    `);
    const truncated = result.rows.length > maxCells;
    const body: HeatmapResponse = {
      cellZoom: z,
      cells: result.rows.slice(0, maxCells).map((row) => {
        const [lon, lat] = tileCentre(row.x, row.y, z);
        return [round6(lon), round6(lat), Number(row.count)];
      }),
      truncated,
    };
    res.json(body);
  });

  return router;
}
