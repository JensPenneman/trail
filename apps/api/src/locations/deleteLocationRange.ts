import { desc, eq, sql } from "drizzle-orm";
import { allowLongStatements } from "../db/allowLongStatements";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { locations } from "../db/schema/locations";
import { rebuildHeatCells } from "../heatmap/rebuildHeatCells";
import { localDate } from "../lib/localDate";
import { recomputeDailyStats } from "../stats/recomputeDailyStats";

interface DateRow extends Record<string, unknown> {
  date: string;
}

/**
 * Deletes a device's points, visits, trips and events in `[from, to)` in one
 * transaction and repairs everything derived from them: heat cells (rebuilt),
 * the point counter, the cached position, and the affected days' statistics.
 * Returns the number of deleted records of all kinds.
 */
export async function deleteLocationRange(
  db: Database,
  input: { deviceId: string; timezone: string; from: Date; to: Date },
): Promise<number> {
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
    const points = await tx.execute(sql`DELETE FROM locations WHERE ${inRange("recorded_at")}`);
    const visits = await tx.execute(sql`DELETE FROM visits WHERE ${inRange("recorded_at")}`);
    const trips = await tx.execute(sql`DELETE FROM trips WHERE ${inRange("started_at")}`);
    const events = await tx.execute(sql`DELETE FROM device_events WHERE ${inRange("recorded_at")}`);
    const deletedPoints = points.rowCount ?? 0;

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
      await recomputeDailyStats(
        tx,
        deviceId,
        timezone,
        days.rows.map((row) => row.date),
      );
    }
    return deletedPoints + (visits.rowCount ?? 0) + (trips.rowCount ?? 0) + (events.rowCount ?? 0);
  });
}
