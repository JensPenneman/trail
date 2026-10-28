import { bigint, integer, pgTable, primaryKey, smallint, text } from "drizzle-orm/pg-core";

/**
 * Which ways a z14 tile holds, per source (a way can cross many tiles):
 * what a tile's download contained, or what a region's import computed from
 * the ways' segments. Partitioned by list on `source` like `osm_ways`; the
 * key ends in `source`, so a tile is a prefix lookup. No foreign key to
 * `osm_ways`: a build's partitions are attached and dropped whole, and the
 * Overpass cache drops the ways no tile holds any more itself (tileStore.ts).
 */
export const osmTileWays = pgTable(
  "osm_tile_ways",
  {
    z: smallint("z").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    wayId: bigint("way_id", { mode: "number" }).notNull(),
    source: text("source").notNull(),
  },
  (table) => [
    primaryKey({
      name: "osm_tile_ways_pkey",
      columns: [table.z, table.x, table.y, table.wayId, table.source],
    }),
  ],
);
