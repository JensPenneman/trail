import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type ActivityResponse,
  activityQuerySchema,
  type DaysResponse,
  daysQuerySchema,
} from "@trail/contracts/stats";
import { sql } from "drizzle-orm";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { toIso } from "../db/toIso";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { parseQuery } from "../http/parseInput";

interface DayRow extends Record<string, unknown> {
  device_id: string;
  date: string;
  points: number;
  distance_m: number;
  first_at: string;
  last_at: string;
}

interface BucketRow extends Record<string, unknown> {
  start: string;
  device_id: string;
  recorded: number;
  uploads: number;
}

/** `GET /api/stats/days` (calendar, coverage) and `GET /api/stats/activity` ("is data flowing"). */
export function statsRouter(ctx: AppContext): Router {
  const router = express.Router();
  const { db } = ctx;

  router.get(apiPaths.statsDays, async (req, res) => {
    const { user } = requireAuth(req);
    const query = parseQuery(daysQuerySchema, req);
    const ids = (await resolveDeviceIds(db, user.id, query.deviceIds)).map((device) => device.id);
    const result =
      ids.length === 0
        ? { rows: [] }
        : await db.execute<DayRow>(sql`
            SELECT device_id, date::text AS date, points, distance_m, first_at, last_at
            FROM daily_stats
            WHERE device_id = ANY(${sql.param(ids)}::uuid[])
              AND date BETWEEN ${query.from}::date AND ${query.to}::date
            ORDER BY date, device_id
          `);
    const body: DaysResponse = {
      timezone: user.timezone,
      days: result.rows.map((row) => ({
        date: row.date,
        deviceId: row.device_id,
        points: row.points,
        distanceM: row.distance_m,
        firstAt: toIso(row.first_at),
        lastAt: toIso(row.last_at),
      })),
    };
    res.json(body);
  });

  router.get(apiPaths.statsActivity, async (req, res) => {
    const { user } = requireAuth(req);
    const { hours, deviceIds } = parseQuery(activityQuerySchema, req);
    const ids = (await resolveDeviceIds(db, user.id, deviceIds)).map((device) => device.id);
    const now = new Date();
    const currentHour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const from = new Date(currentHour.getTime() - (hours - 1) * 3_600_000);
    const to = new Date(currentHour.getTime() + 3_600_000);

    // Every hour × device, zeros included, so the client can draw the series as-is.
    const result =
      ids.length === 0
        ? { rows: [] }
        : await db.execute<BucketRow>(sql`
            WITH hours AS (
              SELECT generate_series(${from.toISOString()}::timestamptz,
                ${currentHour.toISOString()}::timestamptz, interval '1 hour') AS start
            ),
            ids AS (SELECT unnest(${sql.param(ids)}::uuid[]) AS device_id),
            recorded AS (
              SELECT device_id, date_trunc('hour', recorded_at, 'UTC') AS start, count(*)::int AS n
              FROM locations
              WHERE device_id = ANY(${sql.param(ids)}::uuid[])
                AND recorded_at >= ${from.toISOString()}::timestamptz
                AND recorded_at < ${to.toISOString()}::timestamptz
              GROUP BY 1, 2
            ),
            uploads AS (
              SELECT device_id, date_trunc('hour', received_at, 'UTC') AS start, count(*)::int AS n
              FROM ingest_log
              WHERE device_id = ANY(${sql.param(ids)}::uuid[])
                AND received_at >= ${from.toISOString()}::timestamptz
                AND received_at < ${to.toISOString()}::timestamptz
              GROUP BY 1, 2
            )
            SELECT h.start, i.device_id, coalesce(r.n, 0) AS recorded, coalesce(u.n, 0) AS uploads
            FROM hours h
            CROSS JOIN ids i
            LEFT JOIN recorded r ON r.device_id = i.device_id AND r.start = h.start
            LEFT JOIN uploads u ON u.device_id = i.device_id AND u.start = h.start
            ORDER BY h.start, i.device_id
          `);
    const body: ActivityResponse = {
      from: from.toISOString(),
      to: to.toISOString(),
      buckets: result.rows.map((row) => ({
        start: toIso(row.start),
        deviceId: row.device_id,
        recorded: row.recorded,
        uploads: row.uploads,
      })),
    };
    res.json(body);
  });

  return router;
}
