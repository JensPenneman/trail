import { and, asc, desc, eq, gt, gte, lt } from "drizzle-orm";
import type { Executor } from "../db/database";
import { locations } from "../db/schema/locations";

export type LocationRecord = typeof locations.$inferSelect;

export interface PointWindow {
  /** Oldest first (v1) or newest first (the dashboard's raw points). */
  order: "asc" | "desc";
  /** Recorded at or after (included). */
  from?: Date | undefined;
  /** Recorded before (excluded). */
  to?: Date | undefined;
  /** The keyset: only points after this instant in reading order. */
  after?: Date | undefined;
  limit: number;
}

/**
 * A page of one device's stored points along the primary key (device_id,
 * recorded_at): unique per device, so the last point's time is an exact
 * keyset cursor. `more` says whether another page follows.
 */
export async function readPoints(
  db: Executor,
  deviceId: string,
  window: PointWindow,
): Promise<{ rows: LocationRecord[]; more: boolean }> {
  const ascending = window.order === "asc";
  const rows = await db
    .select()
    .from(locations)
    .where(
      and(
        eq(locations.deviceId, deviceId),
        window.from === undefined ? undefined : gte(locations.recordedAt, window.from),
        window.to === undefined ? undefined : lt(locations.recordedAt, window.to),
        window.after === undefined
          ? undefined
          : ascending
            ? gt(locations.recordedAt, window.after)
            : lt(locations.recordedAt, window.after),
      ),
    )
    .orderBy(ascending ? asc(locations.recordedAt) : desc(locations.recordedAt))
    .limit(window.limit + 1);
  return { rows: rows.slice(0, window.limit), more: rows.length > window.limit };
}
