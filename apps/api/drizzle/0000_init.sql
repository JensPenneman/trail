CREATE TABLE "auth_ceremonies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"challenge" text NOT NULL,
	"rp_id" text NOT NULL,
	"origin" text NOT NULL,
	"email" text,
	"webauthn_user_id" "bytea",
	"user_id" uuid,
	"invite_id" uuid,
	"link_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_ceremonies_kind_check" CHECK ("auth_ceremonies"."kind" IN ('register', 'authenticate', 'add_passkey', 'link'))
);
--> statement-breakpoint
CREATE TABLE "daily_stats" (
	"device_id" uuid NOT NULL,
	"date" date NOT NULL,
	"points" integer NOT NULL,
	"distance_m" double precision NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "daily_stats_pkey" PRIMARY KEY("device_id","date")
);
--> statement-breakpoint
CREATE TABLE "device_events" (
	"device_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"action" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"extra" jsonb,
	CONSTRAINT "device_events_pkey" PRIMARY KEY("device_id","recorded_at","action")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text DEFAULT 'overland' NOT NULL,
	"device_key" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_recorded_at" timestamp with time zone,
	"last_lat" double precision,
	"last_lon" double precision,
	"last_accuracy" real,
	"last_speed" real,
	"last_altitude" real,
	"last_course" real,
	"last_motion" text[],
	"battery_level" real,
	"battery_state" text,
	"battery_recorded_at" timestamp with time zone,
	"live_trip" jsonb,
	"points_total" bigint DEFAULT 0 NOT NULL,
	"pending_settings" text,
	"settings_applied_at" timestamp with time zone,
	"stale_alerted_at" timestamp with time zone,
	CONSTRAINT "devices_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "devices_user_id_device_key_key" UNIQUE("user_id","device_key"),
	CONSTRAINT "devices_source_check" CHECK ("devices"."source" IN ('overland')),
	CONSTRAINT "devices_pending_settings_check" CHECK ("devices"."pending_settings" IN ('balanced', 'high-resolution', 'battery-saver'))
);
--> statement-breakpoint
CREATE TABLE "heat_cells" (
	"device_id" uuid NOT NULL,
	"z" smallint NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"count" integer NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "heat_cells_pkey" PRIMARY KEY("device_id","z","x","y")
);
--> statement-breakpoint
CREATE TABLE "ingest_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"device_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"records" integer NOT NULL,
	"locations" integer NOT NULL,
	"duplicates" integer NOT NULL,
	"visits" integer NOT NULL,
	"trips" integer NOT NULL,
	"events" integer NOT NULL,
	"rejected" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "ingest_rejects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest_rejects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"device_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"record" jsonb
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"email" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	CONSTRAINT "invites_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"device_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"altitude" real,
	"speed" real,
	"course" real,
	"horizontal_accuracy" real,
	"vertical_accuracy" real,
	"speed_accuracy" real,
	"course_accuracy" real,
	"motion" text[] DEFAULT '{}'::text[] NOT NULL,
	"battery_level" real,
	"battery_state" text,
	"wifi" text,
	"extra" jsonb,
	CONSTRAINT "locations_pkey" PRIMARY KEY("device_id","recorded_at")
);
--> statement-breakpoint
CREATE TABLE "passkey_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "passkey_links_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "passkey_links_created_by_check" CHECK ("passkey_links"."created_by" IN ('cli', 'user'))
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"rp_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"aaguid" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkeys_device_type_check" CHECK ("passkeys"."device_type" IN ('singleDevice', 'multiDevice'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"device_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"mode" text NOT NULL,
	"distance_m" double precision,
	"duration_s" double precision,
	"steps" integer,
	"stopped_automatically" boolean DEFAULT false NOT NULL,
	"start_location" jsonb,
	"end_location" jsonb,
	"extra" jsonb,
	CONSTRAINT "trips_pkey" PRIMARY KEY("device_id","started_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"webauthn_user_id" "bytea" NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_webauthn_user_id_key" UNIQUE("webauthn_user_id")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"device_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"arrived_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"horizontal_accuracy" real,
	"extra" jsonb,
	CONSTRAINT "visits_pkey" PRIMARY KEY("device_id","recorded_at")
);
--> statement-breakpoint
ALTER TABLE "auth_ceremonies" ADD CONSTRAINT "auth_ceremonies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_ceremonies" ADD CONSTRAINT "auth_ceremonies_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_ceremonies" ADD CONSTRAINT "auth_ceremonies_link_id_passkey_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."passkey_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heat_cells" ADD CONSTRAINT "heat_cells_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_log" ADD CONSTRAINT "ingest_log_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_rejects" ADD CONSTRAINT "ingest_rejects_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_links" ADD CONSTRAINT "passkey_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_ceremonies_expires_at_idx" ON "auth_ceremonies" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ingest_log_device_id_received_at_idx" ON "ingest_log" USING btree ("device_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ingest_rejects_device_id_received_at_idx" ON "ingest_rejects" USING btree ("device_id","received_at");--> statement-breakpoint
CREATE INDEX "ingest_rejects_received_at_idx" ON "ingest_rejects" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "locations_received_at_brin" ON "locations" USING brin ("received_at");--> statement-breakpoint
CREATE INDEX "passkey_links_user_id_idx" ON "passkey_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkeys_user_id_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");