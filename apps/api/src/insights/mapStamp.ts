import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";

/**
 * What the map data was when an answer was made, for the validator of
 * answers that name places after it (docs/architecture.md §8.8): the newest
 * tile fetched and the builds of the regions that are ready. A new build or
 * a refreshed tile changes the names, and with them the ETag.
 */
export async function mapStamp(db: Executor): Promise<unknown> {
  const result = await db.execute<{ tiles: string | null; builds: string | null }>(sql`
    SELECT
      (SELECT max(fetched_at)::text FROM osm_tiles) AS tiles,
      (SELECT string_agg(build_id, ',' ORDER BY build_id) FROM osm_regions WHERE status = 'ready')
        AS builds
  `);
  const row = result.rows[0];
  return [row?.tiles ?? null, row?.builds ?? null];
}
