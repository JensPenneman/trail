import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { ExportRow } from "./exportRow";

/**
 * A device's points in `[from, to)`, oldest first, in pages (keyset on
 * recorded_at) — never the whole range in memory, and no transaction or
 * connection held while a slow client downloads.
 */
export async function* streamDevicePoints(
  db: Executor,
  deviceId: string,
  range: { from: Date; to: Date },
  pageSize = 2000,
): AsyncGenerator<ExportRow[]> {
  let cursor: string | null = null;
  for (;;) {
    const after: SQL =
      cursor === null
        ? sql`recorded_at >= ${range.from.toISOString()}::timestamptz`
        : sql`recorded_at > ${cursor}::timestamptz`;
    const page: { rows: ExportRow[] } = await db.execute<ExportRow>(sql`
      SELECT recorded_at, received_at, extract(epoch FROM recorded_at)::float8 AS epoch, lat, lon,
        altitude, speed, course, horizontal_accuracy, vertical_accuracy, speed_accuracy,
        course_accuracy, motion, battery_level, battery_state, wifi, extra
      FROM locations
      WHERE device_id = ${deviceId} AND ${after}
        AND recorded_at < ${range.to.toISOString()}::timestamptz
      ORDER BY recorded_at
      LIMIT ${pageSize}
    `);
    if (page.rows.length > 0) yield page.rows;
    const last: ExportRow | undefined = page.rows.at(-1);
    if (last === undefined || page.rows.length < pageSize) return;
    cursor = last.recorded_at;
  }
}
