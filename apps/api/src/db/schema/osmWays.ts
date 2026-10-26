import { bigint, doublePrecision, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";

/** OpenStreetMap ways people travel on, with their nodes (for connections) and shape. */
export const osmWays = pgTable("osm_ways", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull(),
  /** The tags that matter: highway, railway, service, maxspeed, name, route, public_transport, oneway. */
  tags: jsonb("tags").$type<Record<string, string>>().notNull(),
  nodes: bigint("nodes", { mode: "number" }).array().notNull(),
  /** `[[lon, lat], …]`, one entry per node. */
  geometry: jsonb("geometry").$type<[number, number][]>().notNull(),
  minLat: doublePrecision("min_lat").notNull(),
  minLon: doublePrecision("min_lon").notNull(),
  maxLat: doublePrecision("max_lat").notNull(),
  maxLon: doublePrecision("max_lon").notNull(),
  fetchedAt: timestamptz("fetched_at").notNull(),
});
