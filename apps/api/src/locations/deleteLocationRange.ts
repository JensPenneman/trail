import { desc, eq, sql } from "drizzle-orm";
import { allowLongStatements } from "../db/allowLongStatements";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { locations } from "../db/schema/locations";
import { toIso } from "../db/toIso";
import { rebuildHeatCells } from "../heatmap/rebuildHeatCells";
import { tripDays } from "../history/tripTouches";
import { visitDays } from "../history/visitTouches";
import { localDate } from "../lib/localDate";
import { spannedLocalDays } from "../lib/spannedLocalDays";
import { lockDeviceProcessing } from "../processing/deviceLock";
import { enqueueWindow } from "../processing/processingQueue";
import { recomputeDailyStats } from "../stats/recomputeDailyStats";

interface DateRow extends Record<string, unknown> {
  date: string;
}

interface RemovedVisit extends Record<string, unknown> {
  recorded_at: string;
  arrived_at: string | null;
  departed_at: string | null;
}

interface RemovedTrip extends Record<string, unknown> {
  started_at: string;
  ended_at: string;
}

const instant = (value: string): Date => new Date(toIso(value));

/** The stops and moves around a deleted range are worked out again this far beyond it. */
const reprocessMarginMs = 30 * 60_000;

/**
 * Deletes a device's points, visits, trips and events in `[from, to)` in one
 * transaction and repairs everything derived from them: heat cells (rebuilt),
 * the point counter, the cached position, the affected days' statistics, and
 * the processed levels — the points' rows go with them, the segments that
 * touched the range are removed at once and the range is queued for
 * processing (`queueProcessing`) together with all of those segments' time,
 * so that a long stop reaching far beyond it leaves no hole, under the
 * device's processing lock so no window in progress writes them back. Returns
 * the number of deleted records of all kinds and the local days whose stamps
 * it changed, for the `days` event (docs/architecture.md §9): those whose
 * statistics it summed up again, those its visits and trips touched, and
 * those of the segments it removed — also when no point went.
 */
export async function deleteLocationRange(
  db: Database,
  input: { deviceId: string; timezone: string; from: Date; to: Date; queueProcessing: boolean },
): Promise<{ deleted: number; days: string[] }> {
  const { deviceId, timezone } = input;
  const from = input.from.toISOString();
  const to = input.to.toISOString();
  const inRange = (column: string) =>
    sql`device_id = ${deviceId} AND ${sql.identifier(column)} >= ${from}::timestamptz AND ${sql.identifier(column)} < ${to}::timestamptz`;

  return db.transaction(async (tx) => {
    await allowLongStatements(tx);
    const [device] = await tx
      .select({ lastRecordedAt: devices.lastRecordedAt })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .for("update");
    await lockDeviceProcessing(tx, deviceId);
    const points = await tx.execute(sql`DELETE FROM locations WHERE ${inRange("recorded_at")}`);
    const visits = await tx.execute<RemovedVisit>(sql`
      DELETE FROM visits WHERE ${inRange("recorded_at")}
      RETURNING recorded_at::text, arrived_at::text, departed_at::text
    `);
    const trips = await tx.execute<RemovedTrip>(sql`
      DELETE FROM trips WHERE ${inRange("started_at")}
      RETURNING started_at::text, ended_at::text
    `);
    const events = await tx.execute(sql`DELETE FROM device_events WHERE ${inRange("recorded_at")}`);
    const deletedPoints = points.rowCount ?? 0;
    // The days whose stamps change, besides those whose statistics are summed up below.
    const changed = new Set<string>();
    for (const visit of visits.rows) {
      const days = visitDays(
        {
          recordedAt: instant(visit.recorded_at),
          arrivedAt: visit.arrived_at === null ? null : instant(visit.arrived_at),
          departedAt: visit.departed_at === null ? null : instant(visit.departed_at),
        },
        timezone,
      );
      for (const day of days) changed.add(day);
    }
    for (const trip of trips.rows) {
      const days = tripDays(
        { startedAt: instant(trip.started_at), endedAt: instant(trip.ended_at) },
        timezone,
      );
      for (const day of days) changed.add(day);
    }
    // Visits and trips feed the inference too (stops, Overland's trip mode).
    const touched = deletedPoints + visits.rows.length + trips.rows.length;
    if (touched > 0) {
      const removed = await tx.execute<{ first: string | null; last: string | null }>(sql`
        WITH removed AS (
          DELETE FROM segments
          WHERE device_id = ${deviceId}
            AND started_at < ${to}::timestamptz AND ended_at > ${from}::timestamptz
          RETURNING started_at, ended_at
        )
        SELECT min(started_at)::text AS first, max(ended_at)::text AS last FROM removed
      `);
      const extent = removed.rows[0];
      if (extent?.first != null && extent.last != null) {
        for (const day of spannedLocalDays(instant(extent.first), instant(extent.last), timezone)) {
          changed.add(day);
        }
      }
      if (input.queueProcessing) {
        const first = extent?.first == null ? Infinity : Date.parse(toIso(extent.first));
        const last = extent?.last == null ? -Infinity : Date.parse(toIso(extent.last));
        await enqueueWindow(tx, {
          deviceId,
          from: new Date(Math.min(input.from.getTime() - reprocessMarginMs, first)),
          to: new Date(Math.max(input.to.getTime() + reprocessMarginMs, last)),
          reason: "delete",
        });
      }
    }

    let recomputed: string[] = [];
    if (deletedPoints > 0) {
      await rebuildHeatCells(tx, deviceId);

      const cached = device?.lastRecordedAt ?? null;
      const cacheDeleted = cached !== null && cached >= input.from && cached < input.to;
      const [latest] = cacheDeleted
        ? await tx
            .select()
            .from(locations)
            .where(eq(locations.deviceId, deviceId))
            .orderBy(desc(locations.recordedAt))
            .limit(1)
        : [];
      await tx
        .update(devices)
        .set({
          pointsTotal: sql`greatest(${devices.pointsTotal} - ${deletedPoints}, 0)`,
          // The heatmap's validator reads it: as many points uploaded as deleted keep the counter.
          updatedAt: new Date(),
          ...(cacheDeleted
            ? {
                lastRecordedAt: latest?.recordedAt ?? null,
                lastLat: latest?.lat ?? null,
                lastLon: latest?.lon ?? null,
                lastAccuracy: latest?.horizontalAccuracy ?? null,
                lastSpeed: latest?.speed ?? null,
                lastAltitude: latest?.altitude ?? null,
                lastCourse: latest?.course ?? null,
                lastMotion: latest?.motion ?? null,
              }
            : {}),
        })
        .where(eq(devices.id, deviceId));

      const days = await tx.execute<DateRow>(sql`
        SELECT date::text AS date FROM daily_stats
        WHERE device_id = ${deviceId}
          AND date BETWEEN ${localDate(input.from, timezone)}::date
            AND ${localDate(input.to, timezone)}::date
      `);
      recomputed = days.rows.map((row) => row.date);
      await recomputeDailyStats(tx, deviceId, timezone, recomputed);
    }
    for (const day of recomputed) changed.add(day);
    return {
      deleted: deletedPoints + visits.rows.length + trips.rows.length + (events.rowCount ?? 0),
      days: [...changed].sort(),
    };
  });
}
