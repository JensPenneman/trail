import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, smallint, text } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";

/**
 * The map tiles (z14) fetched from OpenStreetMap (docs/architecture.md §17.3):
 * a cache, refreshed after PROCESSING_OSM_TTL_DAYS. `bytes` counts towards the
 * daily download budget; a `failed` tile is tried again at `retry_at`.
 */
export const osmTiles = pgTable(
  "osm_tiles",
  {
    z: smallint("z").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    status: text("status", { enum: ["ok", "failed"] }).notNull(),
    fetchedAt: timestamptz("fetched_at").notNull(),
    wayCount: integer("way_count").notNull(),
    poiCount: integer("poi_count").notNull(),
    bytes: integer("bytes").notNull(),
    failures: integer("failures").notNull().default(0),
    retryAt: timestamptz("retry_at"),
  },
  (table) => [
    primaryKey({ name: "osm_tiles_pkey", columns: [table.z, table.x, table.y] }),
    check("osm_tiles_status_check", sql`${table.status} IN ('ok', 'failed')`),
  ],
);
