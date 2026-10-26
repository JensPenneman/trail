import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";

export interface LatLon {
  lat: number;
  lon: number;
}

interface PositionRow extends Record<string, unknown> {
  user_id: string;
  last_lat: number;
  last_lon: number;
}

/**
 * Where each of these people is: the newest position among their own devices
 * (`onlyDevices` limits it to those, for a token restricted to them). The
 * starting point of the distances on the People page.
 */
export async function latestOwnPositions(
  db: Executor,
  userIds: readonly string[],
  onlyDevices: readonly string[] | null = null,
): Promise<Map<string, LatLon>> {
  if (userIds.length === 0 || onlyDevices?.length === 0) return new Map();
  const result = await db.execute<PositionRow>(sql`
    SELECT DISTINCT ON (user_id) user_id, last_lat, last_lon
    FROM devices
    WHERE user_id = ANY(${sql.param([...userIds])}::uuid[])
      AND last_recorded_at IS NOT NULL AND last_lat IS NOT NULL AND last_lon IS NOT NULL
      ${onlyDevices === null ? sql`` : sql`AND id = ANY(${sql.param([...onlyDevices])}::uuid[])`}
    ORDER BY user_id, last_recorded_at DESC
  `);
  return new Map(result.rows.map((row) => [row.user_id, { lat: row.last_lat, lon: row.last_lon }]));
}
