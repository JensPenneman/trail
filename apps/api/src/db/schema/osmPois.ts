import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";

/** Public transport stops and airports from OpenStreetMap, with the tile they came with. */
export const osmPois = pgTable(
  "osm_pois",
  {
    /** `n<id>`, `w<id>` or `r<id>`. */
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    name: text("name"),
    z: smallint("z").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    fetchedAt: timestamptz("fetched_at").notNull(),
  },
  (table) => [
    index("osm_pois_tile_idx").on(table.z, table.x, table.y),
    check(
      "osm_pois_kind_check",
      sql`${table.kind} IN ('station', 'halt', 'tram_stop', 'subway_station', 'bus_stop', 'ferry_terminal', 'aerodrome')`,
    ),
  ],
);
