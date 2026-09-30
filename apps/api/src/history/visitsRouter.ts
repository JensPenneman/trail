import { apiPaths } from "@trail/contracts/apiPaths";
import { eventRangeQuerySchema, type VisitsResponse } from "@trail/contracts/visit";
import { sql } from "drizzle-orm";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { toIso, toIsoOrNull } from "../db/toIso";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { parseQuery } from "../http/parseInput";

interface VisitRow extends Record<string, unknown> {
  device_id: string;
  recorded_at: string;
  arrived_at: string | null;
  departed_at: string | null;
  lat: number;
  lon: number;
  horizontal_accuracy: number | null;
}

/**
 * `GET /api/visits` — visits touching `[from, to)`. iOS reports a visit on
 * arrival and again on departure (same arrival time); the two reports are
 * merged, preferring the one that knows the departure.
 */
export function visitsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.visits, async (req, res) => {
    const { user } = requireAuth(req);
    const query = parseQuery(eventRangeQuerySchema, req);
    const ids = (await resolveDeviceIds(ctx.db, user.id, query.deviceIds)).map(
      (device) => device.id,
    );
    const from = new Date(query.from).toISOString();
    const to = new Date(query.to).toISOString();
    const result =
      ids.length === 0
        ? { rows: [] }
        : await ctx.db.execute<VisitRow>(sql`
            SELECT * FROM (
              SELECT DISTINCT ON (device_id, coalesce(arrived_at, recorded_at))
                device_id, recorded_at, arrived_at, departed_at, lat, lon, horizontal_accuracy
              FROM visits
              WHERE device_id = ANY(${sql.param(ids)}::uuid[])
                AND (
                  (recorded_at >= ${from}::timestamptz AND recorded_at < ${to}::timestamptz)
                  OR (arrived_at >= ${from}::timestamptz AND arrived_at < ${to}::timestamptz)
                  OR (departed_at >= ${from}::timestamptz AND departed_at < ${to}::timestamptz)
                  OR (arrived_at < ${from}::timestamptz AND departed_at >= ${to}::timestamptz)
                )
              ORDER BY device_id, coalesce(arrived_at, recorded_at), departed_at DESC NULLS LAST,
                recorded_at DESC
            ) merged
            ORDER BY coalesce(arrived_at, recorded_at), device_id
          `);
    const body: VisitsResponse = {
      visits: result.rows.map((row) => ({
        deviceId: row.device_id,
        recordedAt: toIso(row.recorded_at),
        arrivedAt: toIsoOrNull(row.arrived_at),
        departedAt: toIsoOrNull(row.departed_at),
        lat: row.lat,
        lon: row.lon,
        accuracy: row.horizontal_accuracy,
      })),
    };
    res.json(body);
  });

  return router;
}
