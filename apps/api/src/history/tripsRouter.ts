import { apiPaths } from "@trail/contracts/apiPaths";
import type { TripsResponse } from "@trail/contracts/trip";
import { eventRangeQuerySchema } from "@trail/contracts/visit";
import { sql } from "drizzle-orm";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { toIso } from "../db/toIso";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { parseQuery } from "../http/parseInput";

interface TripRow extends Record<string, unknown> {
  device_id: string;
  started_at: string;
  ended_at: string;
  mode: string;
  distance_m: number | null;
  duration_s: number | null;
  steps: number | null;
  stopped_automatically: boolean;
}

/** `GET /api/trips` — Overland trips overlapping `[from, to)`. */
export function tripsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.trips, async (req, res) => {
    const { user } = requireAuth(req);
    const query = parseQuery(eventRangeQuerySchema, req);
    const ids = (await resolveDeviceIds(ctx.db, user.id, query.deviceIds)).map(
      (device) => device.id,
    );
    const result =
      ids.length === 0
        ? { rows: [] }
        : await ctx.db.execute<TripRow>(sql`
            SELECT device_id, started_at, ended_at, mode, distance_m, duration_s, steps,
              stopped_automatically
            FROM trips
            WHERE device_id = ANY(${sql.param(ids)}::uuid[])
              AND started_at < ${new Date(query.to).toISOString()}::timestamptz
              AND ended_at >= ${new Date(query.from).toISOString()}::timestamptz
            ORDER BY started_at, device_id
          `);
    const body: TripsResponse = {
      trips: result.rows.map((row) => ({
        deviceId: row.device_id,
        startedAt: toIso(row.started_at),
        endedAt: toIso(row.ended_at),
        mode: row.mode,
        distanceM: row.distance_m ?? 0,
        durationS: row.duration_s ?? 0,
        steps: row.steps,
        stoppedAutomatically: row.stopped_automatically,
      })),
    };
    res.json(body);
  });

  return router;
}
