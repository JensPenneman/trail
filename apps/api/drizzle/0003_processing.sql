CREATE TABLE "mode_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone,
	"mode" text NOT NULL,
	"source" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mode_overrides_kind_check" CHECK ("mode_overrides"."kind" IN ('segment', 'toggle')),
	CONSTRAINT "mode_overrides_source_check" CHECK ("mode_overrides"."source" IN ('ui', 'api', 'mcp')),
	CONSTRAINT "mode_overrides_mode_check" CHECK ("mode_overrides"."mode" IN ('stationary', 'walking', 'running', 'cycling', 'car', 'bus', 'tram', 'metro', 'train', 'boat', 'plane')),
	CONSTRAINT "mode_overrides_span_check" CHECK ("mode_overrides"."to_at" IS NULL OR "mode_overrides"."to_at" > "mode_overrides"."from_at")
);
--> statement-breakpoint
CREATE TABLE "osm_pois" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"name" text,
	"z" smallint NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "osm_pois_kind_check" CHECK ("osm_pois"."kind" IN ('station', 'halt', 'tram_stop', 'subway_station', 'bus_stop', 'ferry_terminal', 'aerodrome'))
);
--> statement-breakpoint
CREATE TABLE "osm_tiles" (
	"z" smallint NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"way_count" integer NOT NULL,
	"poi_count" integer NOT NULL,
	"bytes" integer NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	CONSTRAINT "osm_tiles_pkey" PRIMARY KEY("z","x","y"),
	CONSTRAINT "osm_tiles_status_check" CHECK ("osm_tiles"."status" IN ('ok', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "osm_tile_ways" (
	"z" smallint NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"way_id" bigint NOT NULL,
	CONSTRAINT "osm_tile_ways_pkey" PRIMARY KEY("z","x","y","way_id")
);
--> statement-breakpoint
CREATE TABLE "osm_ways" (
	"id" bigint PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"tags" jsonb NOT NULL,
	"nodes" bigint[] NOT NULL,
	"geometry" jsonb NOT NULL,
	"min_lat" double precision NOT NULL,
	"min_lon" double precision NOT NULL,
	"max_lat" double precision NOT NULL,
	"max_lon" double precision NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_points" (
	"device_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"kept" boolean NOT NULL,
	"lat_avg" double precision NOT NULL,
	"lon_avg" double precision NOT NULL,
	"speed_avg" real,
	"lat_map" double precision,
	"lon_map" double precision,
	"way_id" bigint,
	"way_kind" text,
	"snap_m" real,
	"path_map" jsonb,
	"version" smallint NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_points_pkey" PRIMARY KEY("device_id","recorded_at")
);
--> statement-breakpoint
CREATE TABLE "processing_queue" (
	"device_id" uuid NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"from_level" text DEFAULT 'averaged' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"missing_tiles" jsonb,
	"last_error" text,
	CONSTRAINT "processing_queue_pkey" PRIMARY KEY("device_id","from_at"),
	CONSTRAINT "processing_queue_from_level_check" CHECK ("processing_queue"."from_level" IN ('averaged', 'mapped', 'inferred')),
	CONSTRAINT "processing_queue_span_check" CHECK ("processing_queue"."to_at" > "processing_queue"."from_at")
);
--> statement-breakpoint
CREATE TABLE "processing_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"device_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"mode" text,
	"mode_inferred" text,
	"mode_user" text,
	"confidence" real,
	"review" boolean DEFAULT false NOT NULL,
	"distance_m" double precision NOT NULL,
	"duration_s" integer NOT NULL,
	"max_speed" real,
	"point_count" integer NOT NULL,
	"start_lat" double precision NOT NULL,
	"start_lon" double precision NOT NULL,
	"end_lat" double precision NOT NULL,
	"end_lon" double precision NOT NULL,
	"centroid_lat" double precision NOT NULL,
	"centroid_lon" double precision NOT NULL,
	"features" jsonb NOT NULL,
	"version" smallint NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segments_device_id_started_at_key" UNIQUE("device_id","started_at"),
	CONSTRAINT "segments_kind_check" CHECK ("segments"."kind" IN ('stop', 'move')),
	CONSTRAINT "segments_mode_check" CHECK ("segments"."mode" IN ('stationary', 'walking', 'running', 'cycling', 'car', 'bus', 'tram', 'metro', 'train', 'boat', 'plane', 'unknown')),
	CONSTRAINT "segments_mode_inferred_check" CHECK ("segments"."mode_inferred" IN ('stationary', 'walking', 'running', 'cycling', 'car', 'bus', 'tram', 'metro', 'train', 'boat', 'plane', 'unknown')),
	CONSTRAINT "segments_mode_user_check" CHECK ("segments"."mode_user" IN ('stationary', 'walking', 'running', 'cycling', 'car', 'bus', 'tram', 'metro', 'train', 'boat', 'plane'))
);
--> statement-breakpoint
ALTER TABLE "mode_overrides" ADD CONSTRAINT "mode_overrides_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mode_overrides" ADD CONSTRAINT "mode_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osm_tile_ways" ADD CONSTRAINT "osm_tile_ways_way_id_osm_ways_id_fk" FOREIGN KEY ("way_id") REFERENCES "public"."osm_ways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_points" ADD CONSTRAINT "processed_points_location_fkey" FOREIGN KEY ("device_id","recorded_at") REFERENCES "public"."locations"("device_id","recorded_at") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_queue" ADD CONSTRAINT "processing_queue_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mode_overrides_device_id_from_at_idx" ON "mode_overrides" USING btree ("device_id","from_at");--> statement-breakpoint
CREATE INDEX "osm_pois_tile_idx" ON "osm_pois" USING btree ("z","x","y");--> statement-breakpoint
CREATE INDEX "osm_tile_ways_way_id_idx" ON "osm_tile_ways" USING btree ("way_id");--> statement-breakpoint
CREATE INDEX "processing_queue_priority_next_at_idx" ON "processing_queue" USING btree ("priority","next_at");--> statement-breakpoint
CREATE INDEX "segments_device_id_ended_at_idx" ON "segments" USING btree ("device_id","ended_at");