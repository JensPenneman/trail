CREATE TABLE "server_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"secret" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"device_ids" uuid[],
	"precision" text NOT NULL,
	"history_days" integer,
	"include_details" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	CONSTRAINT "share_links_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "share_links_precision_check" CHECK ("share_links"."precision" IN ('precise', 'approximate', 'area')),
	CONSTRAINT "share_links_history_days_check" CHECK ("share_links"."history_days" IS NULL OR ("share_links"."history_days" BETWEEN 1 AND 7 AND "share_links"."precision" = 'precise'))
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_user_id" uuid,
	"device_ids" uuid[],
	"precision" text NOT NULL,
	"history_days" integer,
	"include_details" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	CONSTRAINT "shares_precision_check" CHECK ("shares"."precision" IN ('precise', 'approximate', 'area')),
	CONSTRAINT "shares_history_days_check" CHECK ("shares"."history_days" IS NULL OR ("shares"."history_days" BETWEEN 1 AND 365 AND "shares"."precision" = 'precise')),
	CONSTRAINT "shares_recipient_email_check" CHECK ("shares"."recipient_email" = lower("shares"."recipient_email")),
	CONSTRAINT "shares_not_self_check" CHECK ("shares"."recipient_user_id" <> "shares"."owner_user_id")
);
--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_links_owner_user_id_idx" ON "share_links" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shares_owner_user_id_recipient_email_key" ON "shares" USING btree ("owner_user_id","recipient_email") WHERE "shares"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "shares_recipient_user_id_idx" ON "shares" USING btree ("recipient_user_id") WHERE "shares"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "shares_pending_recipient_email_idx" ON "shares" USING btree ("recipient_email") WHERE "shares"."recipient_user_id" IS NULL AND "shares"."revoked_at" IS NULL;