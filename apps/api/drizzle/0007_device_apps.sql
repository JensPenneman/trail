ALTER TABLE "devices" DROP CONSTRAINT "devices_source_check";--> statement-breakpoint
ALTER TABLE "ingest_log" ADD COLUMN "source" text DEFAULT 'overland' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_source_check" CHECK ("devices"."source" IN ('overland', 'owntracks', 'traccar', 'osmand', 'gpslogger'));--> statement-breakpoint
ALTER TABLE "ingest_log" ADD CONSTRAINT "ingest_log_source_check" CHECK ("ingest_log"."source" IN ('overland', 'owntracks', 'traccar', 'osmand', 'gpslogger'));