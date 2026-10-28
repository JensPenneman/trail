import { bigint, doublePrecision, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { bytea } from "../columns/bytea";
import { timestamptz } from "../columns/timestamptz";

/**
 * OpenStreetMap ways people travel on, with their nodes (for connections) and
 * shape, per source (docs/architecture.md §5): `overpass`, the tiles fetched
 * from Overpass, or the source of a region's build (`osm_regions.source`).
 * Partitioned by list on `source`, by hand in the migration (drizzle-kit
 * writes no partitions): a build's rows come and go as partitions of their
 * own (apps/api/src/mapdata/importRegion.ts).
 */
export const osmWays = pgTable(
  "osm_ways",
  {
    id: bigint("id", { mode: "number" }).notNull(),
    source: text("source").notNull(),
    kind: text("kind").notNull(),
    /** The tags that matter: highway, railway, service, maxspeed, name, route, public_transport, oneway. */
    tags: jsonb("tags").$type<Record<string, string>>().notNull(),
    nodes: bigint("nodes", { mode: "number" }).array().notNull(),
    /** Big-endian int32 pairs of lon and lat in 1e-7 degrees, one per node (mapdata/geometryCodec.ts). */
    geometry: bytea("geometry").notNull(),
    minLat: doublePrecision("min_lat").notNull(),
    minLon: doublePrecision("min_lon").notNull(),
    maxLat: doublePrecision("max_lat").notNull(),
    maxLon: doublePrecision("max_lon").notNull(),
    /** When Overpass sent the way; for a region, its extract's timestamp. */
    fetchedAt: timestamptz("fetched_at").notNull(),
  },
  (table) => [primaryKey({ name: "osm_ways_pkey", columns: [table.id, table.source] })],
);
