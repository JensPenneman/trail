SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "processed_points" ADD COLUMN "lat_rail" double precision, ADD COLUMN "lon_rail" double precision, ADD COLUMN "path_rail" jsonb;--> statement-breakpoint
RESET lock_timeout;