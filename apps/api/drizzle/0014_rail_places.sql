ALTER TABLE "processed_points" ADD COLUMN "lat_rail" double precision;--> statement-breakpoint
ALTER TABLE "processed_points" ADD COLUMN "lon_rail" double precision;--> statement-breakpoint
ALTER TABLE "processed_points" ADD COLUMN "path_rail" jsonb;