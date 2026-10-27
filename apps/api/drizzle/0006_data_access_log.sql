CREATE TABLE "data_access_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_access_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"owner_user_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"actor_kind" text NOT NULL,
	"channel" text NOT NULL,
	"actor_user_id" uuid,
	"actor_session_id" text,
	"actor_token_id" uuid,
	"actor_share_id" uuid,
	"actor_link_id" uuid,
	"actor_label" text,
	"visitor_key" text,
	"ip_coarse" text,
	"ua_family" text,
	"action" text NOT NULL,
	"access" text NOT NULL,
	"resource" jsonb NOT NULL,
	"status" smallint NOT NULL,
	"dedupe_key" text NOT NULL,
	CONSTRAINT "data_access_events_owner_user_id_bucket_start_dedupe_key_key" UNIQUE("owner_user_id","bucket_start","dedupe_key"),
	CONSTRAINT "data_access_events_bucket_check" CHECK ("data_access_events"."bucket_start" = date_trunc('hour', "data_access_events"."bucket_start", 'UTC') AND "data_access_events"."first_at" <= "data_access_events"."last_at"),
	CONSTRAINT "data_access_events_count_check" CHECK ("data_access_events"."count" > 0),
	CONSTRAINT "data_access_events_kinds_check" CHECK ("data_access_events"."actor_kind" IN ('owner', 'person', 'link', 'token') AND "data_access_events"."channel" IN ('web', 'api', 'mcp', 'people', 'live', 'link') AND "data_access_events"."access" IN ('read', 'write', 'export')),
	CONSTRAINT "data_access_events_actor_check" CHECK (CASE "data_access_events"."actor_kind"
        WHEN 'owner' THEN "data_access_events"."channel" = 'web' AND "data_access_events"."actor_session_id" IS NOT NULL
          AND "data_access_events"."actor_user_id" IS NULL AND "data_access_events"."actor_token_id" IS NULL
          AND "data_access_events"."actor_share_id" IS NULL AND "data_access_events"."actor_link_id" IS NULL
        WHEN 'token' THEN "data_access_events"."channel" IN ('api', 'mcp') AND "data_access_events"."actor_token_id" IS NOT NULL
          AND "data_access_events"."actor_user_id" IS NULL AND "data_access_events"."actor_session_id" IS NULL
          AND "data_access_events"."actor_share_id" IS NULL AND "data_access_events"."actor_link_id" IS NULL
        WHEN 'person' THEN "data_access_events"."channel" IN ('people', 'live') AND "data_access_events"."actor_user_id" IS NOT NULL
          AND "data_access_events"."actor_session_id" IS NULL AND "data_access_events"."actor_token_id" IS NULL
          AND "data_access_events"."actor_link_id" IS NULL
        WHEN 'link' THEN "data_access_events"."channel" = 'link' AND "data_access_events"."actor_link_id" IS NOT NULL
          AND "data_access_events"."actor_user_id" IS NULL AND "data_access_events"."actor_session_id" IS NULL
          AND "data_access_events"."actor_token_id" IS NULL AND "data_access_events"."actor_share_id" IS NULL
        ELSE false END),
	CONSTRAINT "data_access_events_visitor_check" CHECK (("data_access_events"."actor_kind" = 'link' OR ("data_access_events"."visitor_key" IS NULL AND "data_access_events"."ip_coarse" IS NULL AND "data_access_events"."ua_family" IS NULL))
        AND ("data_access_events"."ip_coarse" IS NULL OR masklen("data_access_events"."ip_coarse"::cidr) = CASE family("data_access_events"."ip_coarse"::cidr) WHEN 4 THEN 24 ELSE 48 END)
        AND ("data_access_events"."visitor_key" IS NULL OR char_length("data_access_events"."visitor_key") = 16)
        AND ("data_access_events"."ua_family" IS NULL OR char_length("data_access_events"."ua_family") <= 60)),
	CONSTRAINT "data_access_events_text_check" CHECK (char_length("data_access_events"."action") BETWEEN 1 AND 64 AND ("data_access_events"."actor_label" IS NULL OR char_length("data_access_events"."actor_label") <= 120)
        AND char_length("data_access_events"."dedupe_key") = 43 AND jsonb_typeof("data_access_events"."resource") = 'object'
        AND "data_access_events"."status" BETWEEN 100 AND 599)
);
--> statement-breakpoint
ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_scopes_check";--> statement-breakpoint
ALTER TABLE "data_access_events" ADD CONSTRAINT "data_access_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_access_events_actor_token_id_idx" ON "data_access_events" USING btree ("actor_token_id","bucket_start" DESC NULLS LAST) WHERE "data_access_events"."actor_token_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "data_access_events_actor_link_id_idx" ON "data_access_events" USING btree ("actor_link_id","bucket_start" DESC NULLS LAST) WHERE "data_access_events"."actor_link_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "data_access_events_actor_share_id_idx" ON "data_access_events" USING btree ("actor_share_id","bucket_start" DESC NULLS LAST) WHERE "data_access_events"."actor_share_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_scopes_check" CHECK (cardinality("api_tokens"."scopes") > 0 AND "api_tokens"."scopes" <@ ARRAY['profile:read', 'devices:read', 'devices:write', 'locations:read', 'locations:write', 'history:read', 'people:read', 'shares:read', 'shares:write', 'audit:read']::text[]);--> statement-breakpoint
-- By hand, as drizzle-kit cannot write it: room on each page for a row's next count,
-- so counting again is a heap-only update, without index churn. Keep it when this
-- migration is generated again.
ALTER TABLE "data_access_events" SET (fillfactor = 70);