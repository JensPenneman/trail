import { bigint, index, integer, pgTable, primaryKey, smallint } from "drizzle-orm/pg-core";
import { osmWays } from "./osmWays";

/** Which ways a tile's download contained (a way can cross many tiles). */
export const osmTileWays = pgTable(
  "osm_tile_ways",
  {
    z: smallint("z").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    wayId: bigint("way_id", { mode: "number" })
      .notNull()
      .references(() => osmWays.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ name: "osm_tile_ways_pkey", columns: [table.z, table.x, table.y, table.wayId] }),
    index("osm_tile_ways_way_id_idx").on(table.wayId),
  ],
);
