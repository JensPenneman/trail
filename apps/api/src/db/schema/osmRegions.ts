import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";

/** A region's polygon as GeoJSON: `[lon, lat]` rings, the first of each polygon its outline. */
export interface RegionPolygon {
  type: "MultiPolygon";
  coordinates: [number, number][][][];
}

/**
 * The builds of the map regions imported from map data artefacts
 * (docs/architecture.md §5): one row per region and build, keyed by the
 * build's digest. At most one build of a region is `ready`, and its rows in
 * `osm_ways`, `osm_tile_ways` and `osm_pois` carry `source`; a new build is
 * `importing` until the import swaps it in, and `failed` (with `error`) when
 * it did not get there.
 */
export const osmRegions = pgTable(
  "osm_regions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    /** Geofabrik's name of the region: `belgium`. */
    name: text("name").notNull(),
    /** The UTC day of the extract, `yyyymmdd`, for people. */
    buildId: text("build_id").notNull(),
    /** What identifies the build: the OCI manifest's digest, or the SHA-256 of manifest.json for a hand import. */
    digest: text("digest").notNull(),
    /** The rows' source: `<name>@<build id>-<first 8 hex of the digest>`. */
    source: text("source").notNull(),
    status: text("status", { enum: ["importing", "ready", "failed"] }).notNull(),
    /** Why the last import of this build failed. */
    error: text("error"),
    /** The extract's replication timestamp: how old the region's map data is. */
    extractTimestamp: timestamptz("extract_timestamp").notNull(),
    builtAt: timestamptz("built_at"),
    /** The extract's polygon (region.poly), for the coverage of tiles. */
    polygon: jsonb("polygon").$type<RegionPolygon>().notNull(),
    minLat: doublePrecision("min_lat").notNull(),
    minLon: doublePrecision("min_lon").notNull(),
    maxLat: doublePrecision("max_lat").notNull(),
    maxLon: doublePrecision("max_lon").notNull(),
    wayCount: integer("way_count").notNull().default(0),
    membershipCount: integer("membership_count").notNull().default(0),
    poiCount: integer("poi_count").notNull().default(0),
    /** When the build became ready. */
    importedAt: timestamptz("imported_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("osm_regions_name_digest_key").on(table.name, table.digest),
    unique("osm_regions_source_key").on(table.source),
    // One build of a region serves at a time.
    uniqueIndex("osm_regions_ready_key").on(table.name).where(sql`${table.status} = 'ready'`),
    check("osm_regions_status_check", sql`${table.status} IN ('importing', 'ready', 'failed')`),
    check(
      "osm_regions_name_check",
      sql`${table.name} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${table.name}) <= 31`,
    ),
    check("osm_regions_build_id_check", sql`${table.buildId} ~ '^[0-9]{8}$'`),
    check("osm_regions_digest_check", sql`${table.digest} ~ '^sha256:[0-9a-f]{64}$'`),
    check("osm_regions_polygon_check", sql`jsonb_typeof(${table.polygon}) = 'object'`),
  ],
);
