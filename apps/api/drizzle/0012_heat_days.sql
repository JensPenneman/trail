CREATE TABLE "heat_days" (
	"device_id" uuid NOT NULL,
	"z" smallint NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"day" date NOT NULL,
	"mode" text NOT NULL,
	"points" integer NOT NULL,
	"move_s" integer NOT NULL,
	"distance_m" real NOT NULL,
	"speed_s" real NOT NULL,
	"max_speed" real,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "heat_days_pkey" PRIMARY KEY("device_id","z","x","y","day","mode"),
	CONSTRAINT "heat_days_mode_check" CHECK ("heat_days"."mode" IN ('stationary', 'walking', 'running', 'cycling', 'car', 'bus', 'tram', 'metro', 'train', 'boat', 'plane', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "heat_days" ADD CONSTRAINT "heat_days_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "heat_days_device_day_idx" ON "heat_days" USING btree ("device_id","day");