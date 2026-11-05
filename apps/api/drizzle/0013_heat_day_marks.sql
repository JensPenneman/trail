CREATE TABLE "heat_day_marks" (
	"device_id" uuid NOT NULL,
	"day" date NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "heat_day_marks_pkey" PRIMARY KEY("device_id","day")
);
--> statement-breakpoint
ALTER TABLE "heat_day_marks" ADD CONSTRAINT "heat_day_marks_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;