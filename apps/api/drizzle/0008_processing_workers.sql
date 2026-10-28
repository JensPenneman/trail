CREATE TABLE "processing_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" text NOT NULL,
	"job_id" bigint,
	"passes" bigint DEFAULT 0 NOT NULL,
	"points" bigint DEFAULT 0 NOT NULL
);
