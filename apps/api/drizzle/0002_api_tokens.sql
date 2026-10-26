CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"scopes" text[] NOT NULL,
	"device_ids" uuid[],
	"allowed_ips" "cidr"[],
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" "inet",
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_name_check" CHECK (char_length("api_tokens"."name") BETWEEN 1 AND 60),
	CONSTRAINT "api_tokens_scopes_check" CHECK (cardinality("api_tokens"."scopes") > 0 AND "api_tokens"."scopes" <@ ARRAY['profile:read', 'devices:read', 'devices:write', 'locations:read', 'locations:write', 'history:read', 'people:read', 'shares:read', 'shares:write']::text[])
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens" USING btree ("user_id");