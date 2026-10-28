CREATE TABLE "osm_regions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"build_id" text NOT NULL,
	"digest" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"extract_timestamp" timestamp with time zone NOT NULL,
	"built_at" timestamp with time zone,
	"polygon" jsonb NOT NULL,
	"min_lat" double precision NOT NULL,
	"min_lon" double precision NOT NULL,
	"max_lat" double precision NOT NULL,
	"max_lon" double precision NOT NULL,
	"way_count" integer DEFAULT 0 NOT NULL,
	"membership_count" integer DEFAULT 0 NOT NULL,
	"poi_count" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "osm_regions_name_digest_key" UNIQUE("name","digest"),
	CONSTRAINT "osm_regions_source_key" UNIQUE("source"),
	CONSTRAINT "osm_regions_status_check" CHECK ("osm_regions"."status" IN ('importing', 'ready', 'failed')),
	CONSTRAINT "osm_regions_name_check" CHECK ("osm_regions"."name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("osm_regions"."name") <= 31),
	CONSTRAINT "osm_regions_build_id_check" CHECK ("osm_regions"."build_id" ~ '^[0-9]{8}$'),
	CONSTRAINT "osm_regions_digest_check" CHECK ("osm_regions"."digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "osm_regions_polygon_check" CHECK (jsonb_typeof("osm_regions"."polygon") = 'object')
);
--> statement-breakpoint
ALTER TABLE "osm_tile_ways" DROP CONSTRAINT "osm_tile_ways_way_id_osm_ways_id_fk";
--> statement-breakpoint
DROP INDEX "osm_tile_ways_way_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "osm_regions_ready_key" ON "osm_regions" USING btree ("name") WHERE "osm_regions"."status" = 'ready';--> statement-breakpoint
-- By hand, as drizzle-kit cannot write it: keep this when the migration is generated again,
-- and delete what drizzle-kit writes for osm_ways, osm_tile_ways and osm_pois besides the two
-- statements above (a jsonb column has no cast to bytea, a table becomes partitioned only by
-- being created so, and it cannot name the keys it drops). The three tables become
-- partitioned by list on `source` (docs/architecture.md §5): the Overpass cache is the
-- partition `overpass`, never a default partition (DETACH ... CONCURRENTLY refuses a table
-- that has one), and every region build gets partitions of its own at its import
-- (apps/api/src/mapdata/importRegion.ts). The cache moves over in place, its geometry from
-- [[lon, lat], ...] to big-endian int32 pairs of 1e-7 degrees (mapdata/geometryCodec.ts).
ALTER TABLE "osm_tile_ways" RENAME TO "osm_tile_ways_cache";--> statement-breakpoint
ALTER TABLE "osm_tile_ways_cache" DROP CONSTRAINT "osm_tile_ways_pkey";--> statement-breakpoint
ALTER TABLE "osm_ways" RENAME TO "osm_ways_cache";--> statement-breakpoint
ALTER TABLE "osm_ways_cache" DROP CONSTRAINT "osm_ways_pkey";--> statement-breakpoint
ALTER TABLE "osm_pois" RENAME TO "osm_pois_cache";--> statement-breakpoint
ALTER TABLE "osm_pois_cache" DROP CONSTRAINT "osm_pois_pkey";--> statement-breakpoint
DROP INDEX "osm_pois_tile_idx";--> statement-breakpoint
CREATE TABLE "osm_ways" (
	"id" bigint NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"tags" jsonb NOT NULL,
	"nodes" bigint[] NOT NULL,
	"geometry" bytea NOT NULL,
	"min_lat" double precision NOT NULL,
	"min_lon" double precision NOT NULL,
	"max_lat" double precision NOT NULL,
	"max_lon" double precision NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "osm_ways_pkey" PRIMARY KEY("id","source")
) PARTITION BY LIST ("source");--> statement-breakpoint
CREATE TABLE "osm_ways_overpass" PARTITION OF "osm_ways" FOR VALUES IN ('overpass');--> statement-breakpoint
CREATE TABLE "osm_tile_ways" (
	"z" smallint NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"way_id" bigint NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "osm_tile_ways_pkey" PRIMARY KEY("z","x","y","way_id","source")
) PARTITION BY LIST ("source");--> statement-breakpoint
CREATE TABLE "osm_tile_ways_overpass" PARTITION OF "osm_tile_ways" FOR VALUES IN ('overpass');--> statement-breakpoint
-- Only the cache asks which tiles hold a way, to drop the ways none holds any more
-- (tileStore.ts): the partitions of a build do without this index.
CREATE INDEX "osm_tile_ways_overpass_way_id_idx" ON "osm_tile_ways_overpass" USING btree ("way_id");--> statement-breakpoint
CREATE TABLE "osm_pois" (
	"id" text NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"name" text,
	"z" smallint NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "osm_pois_pkey" PRIMARY KEY("id","source"),
	CONSTRAINT "osm_pois_kind_check" CHECK ("osm_pois"."kind" IN ('station', 'halt', 'tram_stop', 'subway_station', 'bus_stop', 'ferry_terminal', 'aerodrome'))
) PARTITION BY LIST ("source");--> statement-breakpoint
CREATE TABLE "osm_pois_overpass" PARTITION OF "osm_pois" FOR VALUES IN ('overpass');--> statement-breakpoint
CREATE INDEX "osm_pois_tile_idx" ON "osm_pois" USING btree ("z","x","y");--> statement-breakpoint
-- The cached ways, their [lon, lat] pairs as int32 1e-7 degrees, big-endian (int4send).
INSERT INTO "osm_ways" ("id", "source", "kind", "tags", "nodes", "geometry", "min_lat", "min_lon", "max_lat", "max_lon", "fetched_at")
SELECT w."id", 'overpass', w."kind", w."tags", w."nodes",
	coalesce((
		SELECT string_agg(
			int4send(round((p.position->>0)::numeric * 10000000)::integer)
				|| int4send(round((p.position->>1)::numeric * 10000000)::integer),
			''::bytea ORDER BY p.vertex)
		FROM jsonb_array_elements(w."geometry") WITH ORDINALITY AS p(position, vertex)
	), ''::bytea),
	w."min_lat", w."min_lon", w."max_lat", w."max_lon", w."fetched_at"
FROM "osm_ways_cache" w;--> statement-breakpoint
INSERT INTO "osm_tile_ways" ("z", "x", "y", "way_id", "source")
SELECT "z", "x", "y", "way_id", 'overpass' FROM "osm_tile_ways_cache";--> statement-breakpoint
INSERT INTO "osm_pois" ("id", "source", "kind", "lat", "lon", "name", "z", "x", "y", "fetched_at")
SELECT "id", 'overpass', "kind", "lat", "lon", "name", "z", "x", "y", "fetched_at" FROM "osm_pois_cache";--> statement-breakpoint
DROP TABLE "osm_tile_ways_cache";--> statement-breakpoint
DROP TABLE "osm_ways_cache";--> statement-breakpoint
DROP TABLE "osm_pois_cache";