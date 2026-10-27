import { timeZoneSchema } from "@trail/contracts/datetime";
import { emailSchema } from "@trail/contracts/email";
import { z } from "zod";
import { databaseName } from "./databaseName";
import { normaliseOrigin } from "./normaliseOrigin";
import { readSatelliteStyle } from "./satelliteStyle";

/* Environment variables arrive as strings; an empty value (`FOO=` in an env
 * file) means "not set" so the default applies. */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const env = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema);

/** A required variable; "is required" reads better than zod's type message. */
const text = () =>
  z.string({ error: (issue) => (issue.input === undefined ? "is required" : undefined) });

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const originSchema = text().transform((value, context) => {
  const origin = normaliseOrigin(value);
  if (origin === null) {
    context.addIssue({
      code: "custom",
      message: `"${value}" is not an origin like https://trail.example.com (no path)`,
    });
    return z.NEVER;
  }
  return origin;
});

const httpUrlSchema = z.url({ protocol: /^https?$/ });

const originListSchema = z.string().transform(splitList).pipe(z.array(originSchema));

const allowlistEntrySchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (entry) => /^\*@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(entry) || emailSchema.safeParse(entry).success,
    { message: "Use an email address or *@domain" },
  );

/** CSP source expressions for the map; the shape is checked so a typo cannot break the header. */
const cspSourceSchema = z
  .string()
  .regex(/^(https?|wss?):\/\/[^\s;,'"]+$/, "Use an origin like https://tiles.example.com");

const intSchema = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const booleanSchema = z
  .enum(["true", "false"], { error: "Use true or false" })
  .transform((value) => value === "true");

/*
 * Unset: OpenStreetMap's public Overpass instance. Set but empty: no map data
 * at all (the mapped level degrades to averaged), which is why this one does
 * not go through `env` (where empty means "the default").
 */
const overpassUrlSchema = z
  .preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.union([z.literal(""), httpUrlSchema]).optional(),
  )
  .transform((value) =>
    value === undefined ? "https://overpass-api.de/api/interpreter" : value === "" ? null : value,
  );

export const envSchema = z
  .object({
    NODE_ENV: env(z.string().default("development")),
    DATABASE_URL: env(
      text().refine((value) => /^postgres(ql)?:\/\//.test(value) && URL.canParse(value), {
        message: "Use a postgres:// connection string",
      }),
    ),
    PORT: env(intSchema(1, 65_535).default(8080)),
    HOST: env(z.string().default("0.0.0.0")),
    PUBLIC_URL: env(originSchema),
    ADDITIONAL_ORIGINS: env(originListSchema.default([])),
    // Browser-based MCP clients that may call /mcp besides the origins above (docs/mcp.md).
    MCP_ALLOWED_ORIGINS: env(originListSchema.default([])),
    INGEST_BASE_URL: env(httpUrlSchema.optional()),
    SIGNUP_ALLOWLIST: env(
      z.string().transform(splitList).pipe(z.array(allowlistEntrySchema)).default([]),
    ),
    // Nobody by default: a trusted peer decides the client address (per-IP limits, session
    // IPs) and the protocol through X-Forwarded-*. deploy/compose.yaml names its proxies.
    TRUST_PROXY: env(z.string().default("false")),
    SESSION_TTL_DAYS: env(intSchema(1, 365).default(30)),
    LIVE_WINDOW_MINUTES: env(intSchema(1, 1440).default(15)),
    STALE_AFTER_HOURS: env(intSchema(1, 720).default(12)),
    // The data access log is a log, not location data: it is pruned (docs/architecture.md §8.8).
    DATA_ACCESS_RETENTION_DAYS: env(intSchema(1, 3650).default(365)),
    ALERT_NTFY_URL: env(httpUrlSchema.optional()),
    ALERT_NTFY_TOKEN: env(z.string().optional()),
    DEFAULT_TIMEZONE: env(timeZoneSchema.default("Europe/Brussels")),
    MAP_STYLE_LIGHT: env(httpUrlSchema.default("https://tiles.openfreemap.org/styles/liberty")),
    MAP_STYLE_DARK: env(httpUrlSchema.default("https://tiles.openfreemap.org/styles/dark")),
    // Off unless set: imagery has terms and usually a key (docs/operations.md).
    MAP_STYLE_SATELLITE: env(httpUrlSchema.optional()),
    MAP_STYLE_SATELLITE_ATTRIBUTION: env(z.string().trim().max(300).optional()),
    MAP_CONNECT_SRC: env(
      z
        .string()
        .transform(splitList)
        .pipe(z.array(cspSourceSchema))
        .default(["https://tiles.openfreemap.org"]),
    ),
    WEB_DIST_DIR: env(z.string().optional()),
    LOG_LEVEL: env(
      z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    ),
    APP_VERSION: env(z.string().optional()),
    GIT_SHA: env(z.string().optional()),
    BUILD_TIME: env(z.iso.datetime({ offset: true }).optional()),
    RATE_LIMIT_AUTH_PER_MINUTE: env(intSchema(1, 1_000_000).default(20)),
    RATE_LIMIT_API_PER_MINUTE: env(intSchema(1, 1_000_000).default(600)),
    RATE_LIMIT_INGEST_PER_MINUTE: env(intSchema(1, 1_000_000).default(300)),
    RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES: env(intSchema(1, 1_000_000).default(30)),
    RATE_LIMIT_TOKEN_PER_MINUTE: env(intSchema(1, 1_000_000).default(600)),
    RATE_LIMIT_TOKEN_FAILED_PER_10_MINUTES: env(intSchema(1, 1_000_000).default(30)),
    RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE: env(intSchema(1, 1_000_000).default(60)),
    PROCESSING_ENABLED: env(booleanSchema.default(true)),
    PROCESSING_OVERPASS_URL: overpassUrlSchema,
    PROCESSING_OVERPASS_DAILY_MB: env(intSchema(1, 100_000).default(300)),
    PROCESSING_OSM_TTL_DAYS: env(intSchema(1, 3650).default(90)),
    PROCESSING_MAX_ACCURACY_M: env(intSchema(10, 5000).default(150)),
    PROCESSING_STOP_MIN_S: env(intSchema(30, 7200).default(180)),
  })
  .superRefine((values, context) => {
    // Refinements see invalid fields too; an invalid URL has its own issue already.
    const problem = httpUrlSchema.safeParse(values.MAP_STYLE_SATELLITE).success
      ? readSatelliteStyle(values.MAP_STYLE_SATELLITE, values.MAP_STYLE_SATELLITE_ATTRIBUTION)
          .problem
      : null;
    if (problem !== null) {
      context.addIssue({ code: "custom", path: [problem.variable], message: problem.message });
    }
    // A development shell may export DATABASE_URL for an unrelated project:
    // outside production only databases named trail* are ever touched.
    if (values.NODE_ENV === "production") return;
    const name = databaseName(values.DATABASE_URL);
    if (name === null || !name.startsWith("trail")) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: `Refusing database "${name ?? ""}" outside production: its name must start with "trail"`,
      });
    }
  });
