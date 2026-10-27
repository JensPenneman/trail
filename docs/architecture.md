# Trail — architecture

Trail is a self-hosted location history for the iOS app
[Overland](https://github.com/aaronpk/Overland-iOS). Phones post GPS batches to
the API; people sign in with passkeys and see where their devices are, where
they have been, and proof that data keeps arriving.

- One person owns many devices; many people can share one server.
- Everything runs as Docker containers on a home server, deployed by Launchway
  (the owner's self-hosted deployment platform) from GitHub releases, with a
  preview deployment per pull request; images come from GHCR.
- Public hostname (later): `trail.jenspenneman.com` (configurable, `PUBLIC_URL`).

This document is the specification. Code must follow it; when an
implementation has to deviate, update this document in the same change.

---

## 1. Repository layout

```
trail/
├── apps/
│   ├── api/            Express 5 API + Overland ingest + CLI (Node LTS, TypeScript)
│   └── web/            React 19 SPA (Vite 8), served by the API in production
├── packages/
│   └── contracts/      zod schemas + types = the HTTP contract (imported by both)
├── deploy/             production compose stack, env example, Windows docs/scripts
├── docs/               this file, the public API guide (api.md), operations and user docs
├── scripts/            repo tooling (dev, build, hooks, db init)
├── tests/e2e/          Playwright end-to-end suite (whole stack)
├── .devcontainer/      development container (scripts/devc.sh, §3)
├── compose.yaml        development services (Postgres)
└── Dockerfile          single production image (API + built SPA)
```

Package names: `@trail/api`, `@trail/web`, `@trail/contracts` (npm workspaces;
npm only — never pnpm/yarn).

## 2. Conventions (house rules)

- **Node = latest LTS** always (`.nvmrc` = `lts/*`, `engines.node >=24`,
  Docker `node:lts-alpine`). Never pin a Node major.
- **TypeScript 7** (`tsc` is the native compiler), maximum strictness from
  `tsconfig.base.json` (`exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature` → bracket
  access for index signatures, `erasableSyntaxOnly` → no enums/namespaces/
  parameter properties, `verbatimModuleSyntax` → `import type`). TS 7 gotchas:
  `types` defaults to `[]` (list what you need), no `baseUrl`, deprecated 5.x
  flags are hard errors.
- **Biome** for lint + format (`npm run lint`), **knip** for dead code,
  **lefthook** hooks (pre-commit: biome + typecheck; commit-msg: commitlint;
  pre-push: unit tests), **Conventional Commits**. Biome is pinned exactly
  (`"@biomejs/biome": "2.6.2"`, no caret): it treats minor releases as rule
  changes (new lint rules, new formatting), so it is updated deliberately, in
  a pull request of its own with the fixes it asks for.
- **One file = one purpose.** One component / one function / one router per
  file where practical. **No barrel files** (`index.ts` re-exports are banned by
  Biome `noBarrelFile`); import from the defining module. Contracts are imported
  by subpath: `import { deviceSummarySchema } from "@trail/contracts/device"`.
- Relative imports are extensionless (`./createDevice`); module resolution is
  `bundler` everywhere (the API is bundled by tsdown, the web by Vite).
- No `console.*` in app code (Biome `noConsole`): the API logs through pino;
  the CLI (`apps/api/src/cli/**`) and `scripts/**` may print.
- No `any`, no non-null assertions, no `forEach` (use `for…of`).
- Comments explain *why*, not what. Match the surrounding density.
- Dates on the wire are ISO 8601 UTC strings (`Date#toISOString`). Storage is
  `timestamptz`. Display uses the user's IANA time zone (`users.timezone`).
- Units: metres, m/s, degrees internally; the UI shows km, km/h, local time.
- No AI/assistant mentions anywhere (code, comments, commits, docs).

Every change, besides:

- **Recorded data is never changed.** `locations`, `visits`, `trips`,
  `device_events` and `ingest_rejects` stay as they were received; what is
  derived from them lives in tables of its own, carries the version of its
  algorithms and can be rebuilt (`trail reprocess`). A table of user data
  that a migration adds joins `laterTables` of the migration-upgrade test
  (§16).
- **Contracts first.** Every request and answer is a zod schema in
  `packages/contracts` with `.meta({ id, description, example })` for the
  OpenAPI document; the API validates what comes in, `apiFetch` what comes
  back. Errors keep `{ error: { code, message, fields? } }` with the codes of
  `errors.ts`; an unknown or someone else's id answers 404, never 403.
- **One migration per pull request**, generated
  (`npm run db:generate -w @trail/api`) and generated again after a rebase
  onto a `main` that gained one, so the chain stays linear; a statement
  written by hand at its end is kept when it is generated again. An applied
  migration is never edited.
- **A threat model first** for every new endpoint, event, table and page:
  who may read or change what, through which principal and scope, and what
  the owner, the people they share with, a link's visitors and a token's
  holder learn of each other. It goes into the pull request.
- **Scopes.** Whatever can yield coordinates needs `locations:read`, other
  data its own read scope. A new scope takes a migration of
  `api_tokens_scopes_check`, a line of `apiScopeDescriptions` and a row of
  docs/api.md (a test compares them).
- **Secrets** are random (32 bytes or more), kept as SHA-256, shown once and
  shape-checked before any lookup; a path or query name that carries one goes
  into the log redaction (§12). Every public endpoint has a rate limit; every
  change is tested against another account, a wrong scope and an expired or
  revoked credential.
- **A new environment variable** goes into `envSchema.ts`, `loadConfig.ts`,
  `deploy/.env.example`, `deploy/compose.yaml`, §4 and
  `tests/e2e/support/serverEnvironment.ts`.
- **The OpenAPI snapshot** is refreshed on purpose
  (`npm test -w @trail/api -- -u`) and read in the diff; every route has a
  summary, a description and examples.
- **Budgets.** No endpoint reads unbounded rows (93 days of points, pages of
  20 000); processing is incremental; the OpenAPI document is built once per
  process. Trail runs as one instance (the bus and the limiters are in
  memory); a queue that must survive a restart is a table.
- **Tests at every level** (§16): pure logic in unit tests, every route in
  integration tests (what it does and who may), every flow end to end on
  desktop and iPhone, axe green, no console errors; with Postgres or a
  browser in the development container (§3), the end-to-end suite after a
  build and under the machine's lock
  (`E2E_WORKERS=4 lockf -t 5400 /tmp/trail-e2e.lock scripts/devc.sh npm run test:e2e`).
- **Docs move with the code**: the sections of this document a change
  touches, the README's features, the guides in `docs/`.

## 3. Runtime topology

### Development (macOS)

```
Vite dev server :5173  ──/api proxy──▶  API (tsx watch) :8787  ──▶  Postgres :54329 (compose.yaml)
```

`npm run dev` (scripts/dev.mjs) starts Postgres, the API and Vite, loading
`.env` **with precedence over the shell** (the author's shell exports
unrelated `DATABASE_URL`/`NODE_ENV`/`AUTH_SECRET`; they must never leak in).
Databases: `trail` (dev), `trail_test` (API integration tests), `trail_e2e`
(Playwright). Passkeys in dev are bound to `localhost`.

**Development container.** `scripts/devc.sh` runs any command of the
repository in `.devcontainer/`: Node LTS with Chromium's headless shell (the
build the locked Playwright drives) as the unprivileged `node` user, and a
Postgres of its own with the same three databases. Each worktree is a Compose
project of its own, `trail-<branch>` (`/` as `-`), with its own database,
`node_modules` volumes and network, and publishes no host port, so worktrees
never share a database or compete for a port; `up --web` adds Vite's port on an
ephemeral loopback port and passes that origin as `PUBLIC_URL`. In the
container `npm run dev` takes the project's environment instead of `.env`, and
git and its hooks stay on the host. Playwright runs one worker there
(`E2E_WORKERS`), so the suites of several worktrees can share one machine.
`scripts/devc.sh down` removes the project, volumes included. The image
installs the lockfile's `playwright-core` with `npm ci` from a one-package
lockfile, so the lockfile's sha512 covers the package; that verified package
pins the Chromium build (`browsers.json`) and fetches it over HTTPS with a
size check only (Playwright compares the byte count with `Content-Length`,
and neither Playwright nor Chrome for Testing publishes checksums). CI builds
the image whenever `.devcontainer/`, `package-lock.json` or `ci.yml` change
(§15).

### Production (Launchway)

```
iPhone (Overland) ─┐
Browser ───────────┴─▶ Launchway edge (HTTPS, 10.210.0.2 on its proxy network) ─▶ app :8080 ──▶ db (postgres:18-alpine)
                                                                                     backup ──┘ (pg_dump → host folder)
GitHub release published ─▶ Launchway deploys deploy/compose.yaml with image sha-<commit>
Pull request (same repository) ─▶ preview project launchway-trail-pr-<n>, own host name and volume
```

`deploy/compose.yaml` services: `app` (GHCR image `sha-<commit>` of the
deployed commit, `pull_policy: always`), `db`, and `backup` (profile
`production`). Networks: the project's `default` (app; the way out, for ntfy and map data)
and `backend` (app, db, backup; `internal`, no route out); Launchway attaches
`app` to its proxy network itself. No host port is published. See §13 and the
runbook `docs/operations.md`.

## 4. Configuration (API environment)

All configuration is environment variables, validated at boot with zod
(`apps/api/src/config/*.ts`); invalid config → log the problem and exit 1.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres connection string |
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `PUBLIC_URL` | — (required) | Canonical origin, e.g. `https://trail.jenspenneman.com`; used in links, CSRF/WebAuthn origin checks |
| `ADDITIONAL_ORIGINS` | empty | More allowed origins, comma-separated (e.g. `http://localhost:8080`) |
| `MCP_ALLOWED_ORIGINS` | empty | Origins of browser-based MCP clients that may call `/mcp` besides `PUBLIC_URL` and `ADDITIONAL_ORIGINS` (§8.6), comma-separated |
| `INGEST_BASE_URL` | `PUBLIC_URL` | Base URL shown to phones; endpoint = `<base>/api/overland` |
| `SIGNUP_ALLOWLIST` | empty | Emails (or `*@domain`) that may create an account without an invite |
| `TRUST_PROXY` | `false` (nobody) | Express `trust proxy`: the proxies whose `X-Forwarded-For`/`-Proto` decide client address and HTTPS; `deploy/compose.yaml` defaults to Launchway's edge, `10.210.0.2` (§12) |
| `SESSION_TTL_DAYS` | `30` | Sliding session lifetime |
| `LIVE_WINDOW_MINUTES` | `15` | "live" status window |
| `STALE_AFTER_HOURS` | `12` | "stale" status + silent-device alert threshold; also how old the position of a live-only share may be (§8.5) |
| `DATA_ACCESS_RETENTION_DAYS` | `365` | How long the data access log keeps its hours (1–3650 days; §8.8, §10): a log, not location data, so it is pruned |
| `ALERT_NTFY_URL` | empty | ntfy topic URL for silent/recovered device alerts; empty = off |
| `ALERT_NTFY_TOKEN` | empty | Optional ntfy access token |
| `DEFAULT_TIMEZONE` | `Europe/Brussels` | Time zone of new accounts |
| `MAP_STYLE_LIGHT` | `https://tiles.openfreemap.org/styles/liberty` | MapLibre style URL |
| `MAP_STYLE_DARK` | `https://tiles.openfreemap.org/styles/dark` | MapLibre style URL |
| `MAP_STYLE_SATELLITE` | empty (none) | Satellite imagery for the map's style control: a MapLibre style URL, or a raster tile URL template with `{z}`, `{x}`, `{y}` (256 px tiles); its origin joins the CSP's map origins |
| `MAP_STYLE_SATELLITE_ATTRIBUTION` | empty | The imagery provider's credit, plain text; required with a tile template |
| `MAP_CONNECT_SRC` | `https://tiles.openfreemap.org` | Extra CSP `connect-src`/`img-src` origins for the map (comma-separated) |
| `WEB_DIST_DIR` | `apps/web/dist` (`../../web/dist` from the bundle in `apps/api/dist`) | Built SPA to serve; missing `index.html` = API only |
| `LOG_LEVEL` | `info` | pino level |
| `APP_VERSION`, `GIT_SHA`, `BUILD_TIME` | root package.json version / `dev` / null | Baked into the image by the Dockerfile |
| `RATE_LIMIT_AUTH_PER_MINUTE` | `20` | Auth routes, per IP (§12) |
| `RATE_LIMIT_API_PER_MINUTE` | `600` | Every other `/api` request (dashboard and v1) and `/docs`, per IP |
| `RATE_LIMIT_INGEST_PER_MINUTE` | `300` | Accepted uploads, per device token |
| `RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES` | `30` | Uploads with an unknown token, per IP |
| `RATE_LIMIT_TOKEN_PER_MINUTE` | `600` | `/api/v1` and `/mcp` requests with a valid API token, per token, both together (§8.3, §8.6) |
| `RATE_LIMIT_TOKEN_FAILED_PER_10_MINUTES` | `30` | `/api/v1` and `/mcp` requests with an invalid API token, per IP |
| `RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE` | `60` | The public share endpoint (`/api/public/share`), per IP (§8.5) |
| `PROCESSING_ENABLED` | `true` | Location processing (§17); `false` queues and processes nothing |
| `PROCESSING_OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Map data for the mapped level; set but empty: none (§17.3) |
| `PROCESSING_OVERPASS_DAILY_MB` | `300` | Map download budget per UTC day |
| `PROCESSING_OSM_TTL_DAYS` | `90` | Map tiles are refreshed after this many days |
| `PROCESSING_MAX_ACCURACY_M` | `150` | Less accurate points are dropped from the averaged level on |
| `PROCESSING_STOP_MIN_S` | `180` | The shortest stop |
| `NODE_ENV` | `development` | `production` in the image (see below) |

Development safety: when `NODE_ENV !== "production"` the API refuses to start
(or migrate) against a database whose name does not start with `trail`.
`NODE_ENV=development` also switches the logs to pino-pretty (a dev
dependency), so the image must set `NODE_ENV=production`.

Runtime paths resolve relative to the running entry module: migrations at
`../drizzle`, the SPA at `../../web/dist` — the same for the bundle
(`apps/api/dist/*.mjs`) and for `tsx` in development (`apps/api/src/*.ts`).

## 5. Data model (PostgreSQL 18)

Drizzle ORM schema in `apps/api/src/db/schema/*.ts` (one table per file),
SQL migrations generated by drizzle-kit into `apps/api/drizzle/`, applied
automatically at boot under a Postgres advisory lock (unattended deploys).
Snake_case columns, `timestamptz` everywhere, ids `uuid DEFAULT uuidv7()`.

**users** — `id`, `email` (text, unique, stored normalised lower-case),
`display_name` (text, default = local part of the email), `webauthn_user_id`
(bytea, 32 random bytes, unique — the WebAuthn user handle, never the uuid),
`is_admin` (bool; the first account ever created is admin), `timezone` (text),
`preferences` (jsonb, default `{}`, checked to be an object: only the
preferences the person set, see §8), `created_at`, `updated_at`.

**passkeys** — `id` (text PK = credential ID base64url), `user_id` → users
(cascade), `rp_id` (text), `public_key` (bytea), `counter` (bigint),
`transports` (text[]), `device_type` (`singleDevice|multiDevice`), `backed_up`
(bool), `aaguid` (text), `name` (text), `created_at`, `last_used_at`.
Index `(user_id)`.

**sessions** — `id` (text PK = SHA-256 hex of the cookie token), `user_id` →
users (cascade), `created_at`, `last_seen_at`, `expires_at`, `user_agent`,
`ip`. Index `(user_id)`, `(expires_at)`.

**auth_ceremonies** — pending WebAuthn challenges. `id` (uuid PK = ceremonyId),
`kind` (`register|authenticate|add_passkey|link`), `challenge` (text),
`rp_id`, `origin`, `email` (register), `webauthn_user_id` (register),
`user_id` (add_passkey / link / targeted authenticate), `invite_id`, `link_id`,
`expires_at` (now + 5 min), `created_at`. Single use: deleted when consumed.

**invites** — `id`, `token_hash` (unique), `email` (nullable = anyone),
`created_by` → users (set null), `created_at`, `expires_at`, `used_at`,
`used_by` → users (set null).

**passkey_links** — one-time links to add a passkey to an existing account
(recovery via CLI, or a new device/origin from Settings). `id`, `token_hash`
(unique), `user_id` → users (cascade), `origin` (the allowed origin the link
opens on), `created_by` (`cli|user`), `created_at`, `expires_at` (15 min),
`used_at`.

**devices** — `id`, `user_id` → users (cascade), `name`, `source`
(`overland`), `device_key` (the Overland "Device ID"; unique per user),
`token_hash` (unique), `token_hint` (last 4 chars), `alerts_enabled` (bool,
default true), `created_at`, `updated_at`, `last_seen_at` (last accepted
upload), latest-position cache `last_recorded_at`, `last_lat`, `last_lon`,
`last_accuracy`, `last_speed`, `last_altitude`, `last_course`, `last_motion`
(text[]), battery cache `battery_level`, `battery_state`,
`battery_recorded_at`, `live_trip` (jsonb: `{mode, startedAt, distanceM}` or
null), `points_total` (bigint counter), `pending_settings` (text preset or
null), `settings_applied_at`, `stale_alerted_at`.

**locations** — the points. PK `(device_id, recorded_at)` = natural dedupe
(Overland timestamps have 1 s resolution and at most one point per second;
re-sent batches collide and are skipped with `ON CONFLICT DO NOTHING`).
Columns: `device_id` → devices (cascade), `recorded_at`, `received_at`
(default now()), `lat`, `lon` (double precision), `altitude`, `speed`,
`course`, `horizontal_accuracy`, `vertical_accuracy`, `speed_accuracy`,
`course_accuracy` (real, nullable), `motion` (text[]), `battery_level` (real),
`battery_state` (text), `wifi` (text), `extra` (jsonb: every Overland property
without a column — tracking stats, `unique_id`, …). Extra index: BRIN on
`received_at` (activity chart).

**visits** — PK `(device_id, recorded_at)`; `arrived_at`, `departed_at`,
`lat`, `lon`, `horizontal_accuracy`, `extra`.

**trips** — PK `(device_id, started_at)`; `ended_at`, `mode`, `distance_m`,
`duration_s`, `steps`, `stopped_automatically`, `start_location` (jsonb),
`end_location` (jsonb), `extra`.

**device_events** — Overland app/tracking log actions ("Include tracking
stats"): PK `(device_id, recorded_at, action)`; `lat`, `lon` (nullable — log
actions may lack geometry), `extra`.

**ingest_log** — one row per accepted upload: `id` (bigint identity),
`device_id` → devices (cascade), `received_at`, `records`, `locations`,
`duplicates`, `visits`, `trips`, `events`, `rejected`, `duration_ms`,
`user_agent`. Index `(device_id, received_at DESC)`. Retention 90 days.

**ingest_rejects** — dead letter for invalid records (never silently drop
data): `id`, `device_id` → devices (cascade), `received_at`, `reason`,
`record` (jsonb). Kept forever, like every other recorded row: it is raw phone
data that a later fix may still recover.

**heat_cells** — pre-aggregated all-time density for the heatmap: PK
`(device_id, z, x, y)`; `count` (int), `first_at`, `last_at`. `z` ∈ {6, 9, 12,
15, 18} (slippy-map tile coordinates). Maintained in the same statement that
inserts locations (a CTE over `INSERT … RETURNING`, SQL tile math, upsert
`count = count + excluded.count`), only for points with horizontal accuracy
≤ 200 m or unknown. Rebuilt per device after deletions (`recompute`).

**daily_stats** — PK `(device_id, date)` where `date` is the local calendar day
in the owner's time zone: `points`, `distance_m`, `first_at`, `last_at`.
Recomputed from `locations` for every (device, day) touched by an ingest
(debounced ~10 s, after the response) or a deletion, and in bulk by the CLI.

**api_tokens** — credentials of the public API (§8.4): `id`, `user_id` → users
(cascade), `name` (1–60 characters, checked), `token_hash` (unique, SHA-256
hex of the secret), `token_hint` (its last 4 characters), `scopes` (text[],
non-empty, values from the contracts' scope vocabulary, checked — a new scope
needs a migration), `device_ids` (uuid[]; null = every device of the user, an
empty array = none; no foreign key into an array: deleting a device removes
its id from every array in the same transaction, after the device row, so a
token change that holds the device is already in), `allowed_ips` (cidr[], null
= any address), `expires_at` (null = never), `created_at`, `last_used_at`,
`last_used_ip` (inet), `revoked_at`. Index `(user_id)`. Revoked or expired rows
are kept 30 days for the record, then pruned.

**Processing** (§17.2): the derived, rebuildable `processed_points` (cascading
from `locations`), `segments`, `processing_queue`, `processing_state` and the
OpenStreetMap cache (`osm_tiles`, `osm_ways`, `osm_tile_ways`, `osm_pois`);
and `mode_overrides`, the transport modes people set — user data, kept when
everything else is rebuilt.

**shares** — one person's location shared with another (§8.5): `id`,
`owner_user_id` → users (cascade), `recipient_email` (lower-case, checked),
`recipient_user_id` → users (cascade; null until the share is bound: pending,
or joined and waiting for the owner's confirmation), `device_ids` (uuid[];
null = every device of the owner, also later ones; a deleted device is
removed from the array, which never turns it into null), `precision`
(`precise|approximate|area`), `history_days` (int 1–365, only with
`precise`, checked; null = live only), `include_details` (bool, default
true), `expires_at` (null = until stopped), `created_at`, `revoked_at`,
`hidden_at` (set by the recipient), `last_viewed_at`. Partial unique
`(owner_user_id, recipient_email)` where `revoked_at` is null; indexes on
`recipient_user_id` (current) and on `recipient_email` of pending shares.

**share_links** — public links (§8.5): `id`, `owner_user_id` → users (cascade),
`token_hash` (unique, SHA-256 of the `trls_` secret), `label`, `device_ids`,
`precision`, `history_days` (1–7, precise only), `include_details` (default
false), `expires_at` (not null), `created_at`, `revoked_at`, `view_count`,
`last_viewed_at`. Index `(owner_user_id)`.

**hidden_people** — whom a person has hidden on their People page (§8.5):
`user_id` → users (cascade), `hidden_user_id` → users (cascade), `hidden_at`;
PK `(user_id, hidden_user_id)`. A share bound to that person starts hidden.

**server_secrets** — keys the server generates for itself on first use and
keeps: `name` (PK), `secret` (bytea), `created_at`. `share-grid` (32 random
bytes) keys the offset of each owner's sharing grid; it must never change, or
a recipient who saw old and new cells could intersect them.
`data-access-visitor` (32 random bytes) keys the visitor keys of the data
access log (§8.8), which stay the same for a visitor as long as it does.

**data_access_events** — the data access log (§8.8): who read or changed
whose data, one row per owner, UTC hour and access. `id` (bigint identity),
`owner_user_id` → users (cascade), `bucket_start` (the hour, checked to be
one), `first_at`, `last_at`, `count` (> 0), `actor_kind`
(`owner|person|link|token`), `channel` (`web|api|mcp|people|live|link`),
`actor_user_id`, `actor_session_id`, `actor_token_id`, `actor_share_id`,
`actor_link_id` (no foreign keys: the row outlives them), `actor_label` (the
name at the time, ≤ 120 characters), `visitor_key`, `ip_coarse` (text, an
IPv4 /24 or IPv6 /48), `ua_family` (link visitors only), `action`, `access`
(`read|write|export`), `resource` (jsonb object, no coordinates), `status`
(smallint), `dedupe_key` (43 characters). Unique `(owner_user_id,
bucket_start, dedupe_key)` — the upsert's key and the index of the owner's
log, by hour, for the list, the summary and the retention (PostgreSQL 18's
skip scan goes through it owner by owner) — and partial indexes
`(actor_token_id, bucket_start DESC)`, `(actor_link_id, …)` and
`(actor_share_id, …)` for one actor's rows. Checks tie each kind of actor to
its channels and its one reference, keep the network fields to link
visitors and to /24 and /48 networks, and keep a person's row free of
session and token ids. `fillfactor = 70` (set by the migration by hand):
counting a row again stays a heap-only update. Kept
`DATA_ACCESS_RETENTION_DAYS` (365) days; it is a log, not recorded location
data.

## 6. Overland ingest

`POST /api/overland` — the "Receiver Endpoint" configured in Overland.

**Auth.** `Authorization: Bearer <device token>`; also accepts `?token=` /
`?access_token=` for clients that cannot set headers. Token → SHA-256 →
`devices.token_hash`. Unknown token → `401 {"error":"Invalid access token"}`.
Tokens: `trl_` + 32 random bytes base64url. Never log tokens (redact the
header and those query params).

**Protocol** (verified against Overland's source):
- Body `{ "locations": Feature[], "current"?: Feature, "trip"?: {...} }`,
  `Content-Type: application/json`, up to ~600 kB (1000-point batches).
  JSON limit on this route: 5 MB.
- The app deletes its queued batch only if the response is JSON
  `{"result":"ok"}`. Anything else → it retries the whole batch later. A
  response `{"error":"…"}` is shown to the user as a notification.
- Optional `set` object in the ok-response pushes settings to the app (§6.3).
- Timestamps: current app sends `YYYY-MM-DDTHH:MM:SSZ`; old versions sent
  offsets without a colon (`2015-10-01T08:00:00-0700`). Accept `Z`, `±HH:MM`,
  `±HHMM`, optional fractions. Reject anything else, and anything before 1990
  (a reset clock or iOS's `distantPast`; year 0000 is not even a Postgres date).
- Invalid-value sentinels are negative numbers: `speed`, `course`,
  `*_accuracy`, `battery_level` < 0 → null; `vertical_accuracy` < 0 → altitude
  null too. Coordinates truncated to 7 decimals by the app.
- `GET /api/overland` with a valid token → `{"name": "<device name>"}` (Overland
  account-info probe; also a handy connectivity test). Other methods →
  `405 {"error":"Method not allowed"}`.
- The token is checked before the body is parsed, so an unauthenticated
  request never costs a 5 MB JSON parse. Errors of this route always use
  Overland's `{"error":"…"}` body (413 `Payload too large`, 429, 500, 503).

**Record kinds** in `locations[]` (classification by properties):
1. `properties.action === "visit"` → **visit** (`arrival_date`,
   `departure_date` — may be null, `horizontal_accuracy`).
2. `properties.type === "trip"` → **trip** (`mode`, `start`, `end`,
   `duration`, `distance`, `steps`, `stopped_automatically`,
   `start_location`, `end_location`).
3. other `properties.action` (e.g. `paused_location_updates`,
   `resumed_location_updates`, `exited_pause_region`, `did_enter_background`,
   `will_terminate`, `will_resign_active`,
   `application_launched_with_location`) → **device event**; geometry optional.
4. otherwise → **location** (`timestamp`, `altitude`, `speed`, `course`,
   `horizontal_accuracy`, `vertical_accuracy`, `speed_accuracy`,
   `course_accuracy`, `motion[]`, `battery_state`, `battery_level`, `wifi`,
   `device_id`, `unique_id`, plus optional tracking stats `pauses`,
   `activity`, `desired_accuracy`, `deferred`, `significant_change`,
   `locations_in_payload`). Unknown properties go to `extra`.
Every record also carries metadata `device_id`, `wifi`, `battery_*`.
`properties.device_id` is informational — the token decides the device.

### 6.1 Validation policy

- Top level not an object with a `locations` array (or > 5000 items) →
  `400 {"error":"Expected Overland JSON with a \"locations\" array. In Overland set Logging Mode to “All Data”."}`
  (OwnTracks mode sends a single object — tell the user to switch).
- An individual invalid record (bad geometry, lat/lon out of range, exactly
  0,0, unparseable timestamp, timestamp before 1990 or > now + 24 h, an event
  action over 100 characters) → stored in `ingest_rejects` with a reason; the
  batch is still acknowledged so the phone's queue never gets stuck on one bad
  record. A rejected record larger than 16 kB is kept as a 2 000-character
  preview.
- Every stored value is one Postgres accepts — a value it refuses would fail
  the whole upload, and Overland resends an unacknowledged batch forever. Text
  (columns, `extra`, trip locations, the dead letter; keys too) loses NUL
  characters and has lone UTF-16 surrogates replaced by U+FFFD; readings for
  `real` columns outside float4's normal range become null, trip steps beyond
  `integer` too; JSON nested deeper than 16 levels is cut off.
- Should Postgres still refuse a value (SQLSTATE class 22, 23502, 23514,
  54000), the upload is stored again in a new transaction, record by record,
  each in its own savepoint: a refused record goes to `ingest_rejects` with
  its SQLSTATE, a refused device update is retried without the newest
  readings, and the batch is acknowledged.
- Log events keep an unusable geometry in `extra` instead of being rejected;
  visit dates before 1990 or more than a year ahead (iOS `distantPast` /
  `distantFuture`) become null.
- Database unavailable → `503 {"error":"Server temporarily unavailable"}` so
  the phone keeps the data and retries.

### 6.2 Processing (one transaction)

0. Lock the device row (`SELECT … FOR UPDATE`): concurrent uploads of one
   phone never interleave their cache updates.
1. Insert locations (`ON CONFLICT DO NOTHING RETURNING`) + upsert heat cells;
   insert visits / trips / events (`ON CONFLICT DO NOTHING`); insert rejects.
2. Update the device: `last_seen_at = now()`, `points_total += inserted`,
   latest position from the newest record if newer than the cached one; if
   `current` is present and newer, use it for the cached position (not stored
   as a point — it arrives later in a batch), battery from the newest record,
   `live_trip` from the payload's `trip` (null when absent).
3. Insert the `ingest_log` row.
4. Respond `{"result":"ok"}` (plus `set` when a preset is pending, §6.3).
   `duplicates` = valid location records − inserted points (repeats within
   one batch count too).
5. After commit and the response: publish SSE events (`ingest`, `device`;
   `person` to the people the device is shared with, §8.5), schedule
   daily-stats recomputation for touched days, and if `stale_alerted_at` was
   set send the "sending data again" alert (the stamp is cleared in step 2).

### 6.3 Remote settings presets

`devices.pending_settings` (one of `balanced | balanced-plus |
high-resolution | battery-saver`, contracts `remoteSettings.ts`) is sent once as `set` in the
next ok-response, then cleared and `settings_applied_at` stamped. Mapping
(Overland value vocabularies from its README; never `send_interval: "off"` or
`tracking_mode: "off"`):

- **balanced** — `send_interval "5m"`; main: `tracking_mode "standard"`,
  `visit_tracking true`, `desired_accuracy "100m"`, `activity_type "other"`,
  `pause_automatically true`, `resume_with_geofence "200m"`,
  `logging_mode "all"`, `batch_size 200`, `min_distance "10m"`,
  `min_time "5s"`.
- **balanced-plus** — `send_interval "5m"`; main: `tracking_mode "both"`,
  `visit_tracking true`, `desired_accuracy "best"`, `activity_type "other"`,
  `background_indicator false`, `pause_automatically true`,
  `resume_with_geofence "100m"`, `logging_mode "all"`, `batch_size 500`,
  `min_distance "off"`, `min_time "1s"`. Full detail while moving, still pauses;
  significant-change monitoring (`both`) relaunches tracking if iOS suspends
  it, which is what lets the blue background indicator stay off.
- **high-resolution** — `send_interval "1m"`; main: `tracking_mode
  "standard"`, `visit_tracking true`, `desired_accuracy "best"`,
  `activity_type "other"`, `background_indicator true`,
  `pause_automatically false`, `resume_with_geofence "off"`,
  `logging_mode "all"`, `batch_size 500`, `min_distance "off"`,
  `min_time "1s"`.
- **battery-saver** — `send_interval "10m"`; main: `tracking_mode
  "significant"`, `visit_tracking true`, `desired_accuracy "100m"`,
  `activity_type "other"`, `pause_automatically true`,
  `resume_with_geofence "500m"`, `logging_mode "all"`, `batch_size 200`,
  `min_distance "off"`, `min_time "1s"`.

## 7. Authentication

Passkeys only (no passwords), SimpleWebAuthn v14 on both ends.

- **RP ID per origin.** Allowed origins = `PUBLIC_URL` + `ADDITIONAL_ORIGINS`.
  A ceremony's origin is the request's `Origin` header, which must be allowed;
  RP ID = its hostname. A passkey stores its `rp_id`; login offers only
  passkeys of the current RP ID. So one account can hold passkeys for
  `localhost` and for the public domain.
- **Unified start** `POST /api/auth/start {email, inviteToken?}`:
  - account exists → `authenticate` options (allowCredentials = passkeys of
    this RP ID; none → `409 no_passkey_for_origin` "Use a sign-in link");
  - new address and (`SIGNUP_ALLOWLIST` matches or a valid invite whose email
    is null or equal) → `register` options (new random `webauthn_user_id`,
    `residentKey: "required"`, `userVerification: "required"`,
    `attestationType: "none"`, algorithms Ed25519/ES256/RS256 — ML-DSA-44 is
    left out while Node marks it experimental);
  - otherwise → `403 signup_not_allowed`.
- **Usernameless** `POST /api/auth/passkey` → discoverable request options
  (empty allowCredentials) for conditional UI (autofill) and "Use a passkey".
- **Finish** `POST /api/auth/finish {ceremonyId, response}` → verifies with
  `expectedOrigin` = ceremony origin, `expectedRPID` = ceremony RP ID,
  `requireUserVerification: true`; registration creates user (+ admin if
  first) + passkey in one transaction and consumes the invite; pending
  shares of the address bind only for an invitation to that very address,
  otherwise their owners confirm (§8.5; they get a `share` event either
  way); authentication
  checks the credential belongs to the user (targeted) or resolves the user
  from the credential (discoverable), updates `counter`/`last_used_at`. Then
  creates a session and sets the cookie (a session the browser already had is
  deleted). A credential the server does not know (deleted passkey) →
  `401 unknown_credential`, so the client can call the WebAuthn Signal API
  (`signalUnknownCredential`) and the password manager forgets it. The finish
  request must come from the origin the ceremony started on (else `403
  origin_not_allowed`). `add_passkey` ceremonies (normally finished through
  `POST /api/me/passkeys`) can also be finished here by the signed-in user;
  they keep the current session. Any verification failure is `400
  webauthn_failed` (details only in the debug log), a consumed or expired
  ceremony `400 ceremony_expired`.
- **Ceremonies** expire after 5 min, are single use, bound to origin + RP ID.
- **Sessions.** Token = 32 random bytes base64url in cookie
  `__Host-trail_session` (`Secure; HttpOnly; SameSite=Strict; Path=/`) on
  HTTPS, or `trail_session` (no `Secure`) on plain-HTTP localhost. `Strict`:
  the dashboard calls its API from its own pages only, so no request another
  site starts — a link followed, a form, an image — carries the cookie; the
  page itself (`index.html`) is public, and the requests it makes once it has
  loaded are same-site, invitation and passkey links included. DB keeps only the
  SHA-256. Sliding expiry `SESSION_TTL_DAYS`; `last_seen_at` updated at most
  every 5 min (the cookie is re-sent then). Logout deletes the row. On HTTPS
  only the `__Host-` cookie is read, on HTTP only the plain one; an unknown or
  expired cookie is cleared.
- **CSRF.** Cookie-authenticated unsafe methods require an allowed `Origin`
  header (and `Sec-Fetch-Site` `same-origin` when present) and a JSON body
  where there is one. The ingest route is exempt (bearer token, no cookies),
  and so are `/api/v1` requests with an API token. Requests of every method
  that a session authenticates — on `/api` and `/api/v1` — are refused (403
  `origin_not_allowed`, `sameOriginSessions`) when their `Sec-Fetch-Site` is
  anything but `same-origin` or `none` (a client that is no browser sends
  none): a GET from another site's link or image would otherwise read with
  the visitor's session and write their look into someone's data access
  log (§8.8).
- **Principals.** Every request has at most one: a session (cookie) or, on
  `/api/v1` only, an API token. Routes ask for `requireAuth` (either),
  `requireSession` (sessions, passkeys, live events, device credentials,
  account deletion) or `requireAdmin` (an administrator's session); §8.3 has
  the details.
- **Passkey links** (one-time, 15 min): Settings › Passkeys → "Add a passkey
  on another device or address" (`POST /api/me/passkey-links {origin?}`), and the CLI
  `trail passkey-link <email> [--origin URL]` for recovery. Opening
  `/link/<token>` on that origin → `POST /api/auth/link/:token/start` →
  registration for that account → `/api/auth/finish` signs in.
- **Invites** (admins): `/invite/<token>` pre-fills the email when bound and
  passes `inviteToken` to `/api/auth/start`.
- AAGUID → provider name for the passkey list (small curated map: iCloud
  Keychain, Google Password Manager, Chrome on Mac, Windows Hello, 1Password,
  Bitwarden, Dashlane, Proton Pass, Samsung Pass, KeePassXC, NordPass,
  Enpass …).
- Rate limits on every auth route (per IP).

## 8. HTTP API

JSON over `/api`. Request/response shapes are the zod schemas in
`packages/contracts` (paths in `apiPaths.ts`); the API validates every input
with them, the web parses every response with them. Errors: `{ error: { code,
message, fields? } }` (`errors.ts`). All `/api` responses are `Cache-Control:
no-store` unless stated. The routes below are the dashboard's private API; the
public, versioned one is `/api/v1` (§8.3).

| Method & path | Auth | Contract |
|---|---|---|
| `GET /api/config` | — | `config.ts` `PublicConfig` |
| `GET /api/health`, `GET /api/health/live` | — | `{status, db?, version, commit, uptimeS}`; 503 when the DB is down (`/live` never touches the DB) |
| `POST /api/overland`, `GET /api/overland` | device token | §6 |
| `GET /api/auth/session` | cookie | `sessionResponseSchema` or 401 |
| `POST /api/auth/start` | — | `startAuthRequest/Response` |
| `POST /api/auth/passkey` | — | `passkeyOptionsResponse` |
| `POST /api/auth/finish` | — | `finishAuthRequest/Response` + cookie |
| `POST /api/auth/logout` | cookie | 204 |
| `GET /api/auth/link/:token` | — | `linkInfoResponse` (404 `link_invalid` when unknown/used/expired) |
| `POST /api/auth/link/:token/start` | — | `linkStartResponse` |
| `GET/PATCH/DELETE /api/me` | cookie | `sessionResponse` / `updateMeRequest` (name, time zone, preferences) / `deleteAccountRequest` |
| `GET /api/me/passkeys` | cookie | `passkeyListResponse` |
| `POST /api/me/passkeys/options`, `POST /api/me/passkeys` | cookie | `addPasskeyOptionsResponse`, `addPasskeyRequest/Response` |
| `PATCH/DELETE /api/me/passkeys/:id` | cookie | `renamePasskeyRequest`; delete refuses the last passkey (`409 last_passkey`) |
| `GET /api/me/sessions`, `DELETE /api/me/sessions/:id`, `POST /api/me/sessions/revoke-others` | cookie | `sessionListResponse` |
| `POST /api/me/passkey-links` | cookie | `createPasskeyLinkRequest/Response` |
| `GET/POST /api/me/tokens` | cookie | `apiTokenListResponse`, `createApiTokenRequest` → `apiTokenWithSecretResponse` (201) |
| `PATCH/DELETE /api/me/tokens/:id`, `POST /api/me/tokens/:id/roll` | cookie | `updateApiTokenRequest` → `apiTokenResponse`; revoke 204; roll → `apiTokenWithSecretResponse` |
| `GET/POST /api/admin/invites`, `DELETE /api/admin/invites/:id` | admin | `invite.ts` |
| `GET /api/admin/users` | admin | `adminUser.ts` |
| `GET/POST /api/devices` | cookie | `deviceListResponse`, `createDeviceRequest` → `deviceWithCredentialsResponse` (201) |
| `GET/PATCH/DELETE /api/devices/:id` | cookie (owner) | `deviceResponse`, `updateDeviceRequest`; delete removes all its data |
| `POST /api/devices/:id/token` | cookie (owner) | rotate → `deviceWithCredentialsResponse` |
| `GET /api/devices/:id/ingest-log` | cookie (owner) | `ingestLogQuery/Response` |
| `GET /api/tracks` | cookie | `tracksQuery/Response` |
| `GET /api/heatmap` | cookie | `heatmapQuery/Response` |
| `GET /api/stats/days` | cookie | `daysQuery/Response` |
| `GET /api/stats/activity` | cookie | `activityQuery/Response` |
| `GET /api/visits`, `GET /api/trips` | cookie | `eventRangeQuery` → `visitsResponse` / `tripsResponse` |
| `GET /api/locations` | cookie (owner) | `locationsQuery` → `locationsPage` |
| `POST /api/locations/delete` | cookie (owner) | `deleteLocationsRequest/Response` |
| `GET /api/export` | cookie | `exportQuery` → streamed GeoJSON / GPX 1.1 / CSV attachment |
| `GET /api/events` | cookie | SSE, `events.ts` |
| `/api/v1/*` | API token or cookie | §8.3; `GET /api/v1/openapi.json` is public; people, shares and public links §8.5 |
| `GET /api/public/share` | the link's secret in `X-Share-Secret` | `shareLink.ts` `publicShareResponse` (§8.5) |
| `POST /mcp` | API token | the MCP server (§8.6); `GET`, `DELETE` and other methods answer 405 |
| `GET /docs` | — | the API reference page (§8.3) |

Ownership: every device-scoped query is filtered by the session user's
devices; a foreign or unknown id is `404 not_found` (never 403, no probing).

Status codes: creations answer `201` (devices, invites, passkeys, passkey
links, API tokens), deletions, revocations and logout `204`; `PATCH /api/me/passkeys/:id` answers
`addPasskeyResponse`, `POST /api/me/sessions/revoke-others` the remaining
sessions. Invalid input → `400 validation_failed` with `fields`; malformed JSON
→ `400 bad_request`; a non-JSON body → `415 bad_request`; too large → `413
payload_too_large`; database down → `503 unavailable`; unknown `/api` route →
JSON `404 not_found`. Stack traces are logged, never sent.

- **Preferences** (`preferences.ts`): defaults an account takes to every
  browser — `mapStyle` (`auto|light|dark|satellite`), `level`
  (`raw|averaged|mapped|inferred`) and `showOwnActivity` (whether the access
  log lists the account's own activity too). `PATCH /api/me { preferences }`
  changes the ones it names and leaves the others: the statement merges them
  into the stored object (`preferences || $patch`), so two changes at once
  keep each other's. A name it does not know, or a value outside a
  preference's choices, is `400 validation_failed` and nothing is stored, so
  the column only ever holds these. The column keeps only what was set;
  `SessionUser.preferences` (the session, `GET/PATCH /api/me`, the sign-in
  answers) has every one filled in — a preference never set, or holding a
  value this version does not know (a later release's), reads as its default
  (`auto`, `inferred`, `false`). They are the owner's only: the v1 profile,
  MCP, shares, links and the administrators' account list do not carry them.
- **Visits** returned are those recorded, arrived or departed inside the
  range, or spanning it; iOS reports a visit on arrival and again on
  departure, and the two reports are merged (the one knowing the departure
  wins). **Trips** overlap the range.
- **Activity** buckets are dense: every UTC hour × requested device, zeros
  included.
- **Delete** (`POST /api/locations/delete`) removes points, visits, trips and
  events in `[from, to)` in one transaction; `deleted` counts all of them. It
  rebuilds the device's heat cells, recomputes the touched days' statistics,
  decrements `points_total` and refreshes the cached position when it was
  deleted.
- **Export** streams the points page by page (keyset on `recorded_at`) with
  backpressure and stops querying when the client disconnects; the devices'
  visits (recorded in the range, arrival and departure reports merged) and
  trips (started in the range) come first. GeoJSON uses Overland's property
  names (+ `device_name`, `device_id` = Device ID) so an export can be
  replayed into an Overland receiver: points, visits (`action: "visit"`) and
  trips (`type: "trip"`), each with `kind` = `location` | `visit` | `trip`;
  GPX has the visits as `<wpt>` (time = arrival, `<type>visit</type>`), then
  one `<trk>` per device and a `<trkseg>` per `trackSegments()` segment with
  `<ele>`/`<time>`; CSV has the points only (one kind of row per table), a
  header row, CRLF line ends, `motion` joined with `;`, and text cells
  starting like a formula prefixed with `'`. File name
  `trail-<first local day>_<last local day>.<ext>`.

### 8.1 Tracks, distance, simplification

- Points in `[from, to)` with `horizontal_accuracy <= maxAccuracy` (or null),
  ordered by `recorded_at`, split into segments with `trackSegments()`
  (contracts: gap > 600 s), simplified with Ramer–Douglas–Peucker on a local
  equirectangular projection (metres) with one tolerance for the whole track,
  so it fits `maxPoints`; segment end points are always kept. The tolerance is
  found exactly rather than by bisection: each point's RDP importance (the
  largest tolerance at which it survives) is computed once, and the
  (budget + 1)-th largest importance is the smallest tolerance that fits —
  what a binary search converges to. If segment end points alone exceed
  `maxPoints`, points are sampled evenly instead.
- Points are read in pages of 20 000. A track holding more than 200 000
  points in memory is thinned first (minimum spacing doubling up to 300 s,
  segment first/last points kept); the distance always uses every point.
- `distanceM`: haversine over the unsimplified filtered points with jitter
  suppression — accumulate from an anchor point, count a step only when it
  exceeds `max(15 m, (acc_anchor + acc_point) / 2)`, and ignore glitches: a
  fix implying more than 350 m/s from the fix before it (never from the
  anchor, which stays put while the phone stands still). A fix is used once
  the next one agrees with it, so a far-off glitch that looks plausible after
  a gap is dropped when the phone reports from where it is; the newest fix
  counts as long as nothing contradicts it. `daily_stats.distance_m` uses the
  same function (with `maxAccuracy` 100 m).

### 8.2 Heatmap

Pick `cellZoom` = the largest level in {6, 9, 12, 15, 18} that is
`≤ round(zoom) + 5` (minimum 6); return cell centres in the bbox (handle the
antimeridian when `west > east`) summed across the requested devices, at most
20 000 cells (highest counts first, `truncated: true`).

### 8.3 Public API v1

`/api/v1` is the documented, versioned API for other clients: scripts, apps,
agents and, for new features, the dashboard itself. The guide for its users is
[docs/api.md](api.md); the OpenAPI 3.1 document at `/api/v1/openapi.json` and
the reference page at `/docs` are generated from the route registry. A
breaking change means `/api/v2`, never a silent change in v1. The routes of
§8 without `v1` stay the dashboard's private API.

**Mounting order.** `/api/v1` is mounted before the dashboard's `/api` chain,
so it sets its own order. `createApp` puts steps 1 and 2 in front of
`createV1Router(ctx)` (`apps/api/src/v1/createV1Router.ts`), which does the
rest:

1. CORS headers on every response, refusals and 429s included
   (`Access-Control-Allow-Origin: *`, no credentials; exposed: `ETag`,
   `RateLimit`, `RateLimit-Policy`, `Retry-After`, `WWW-Authenticate`,
   `X-Request-Id`). They come before the limiter so a browser client can read
   a 429.
2. The per-IP limiter, the same instance as the dashboard's `/api` chain and
   `/docs` (`RATE_LIMIT_API_PER_MINUTE`, policy `"ip"`).
3. Preflight: any `OPTIONS` answers 204 with `Allow-Methods` (the methods of
   the registry), `Allow-Headers: Authorization, Content-Type, Last-Event-ID`
   and `Max-Age: 600`, before credentials and the session are looked at.
4. `authenticateBearer(ctx)`: a request whose `Authorization` header uses the
   Bearer scheme (in any letter case) is a bearer request; any other scheme
   (`Basic` from a proxy in front, say) carries no API token, and the request
   goes on to the session as if the header were absent. A bearer value must
   be `Bearer trlk_` + 43 base64url characters (`apiTokenPattern`), else it is
   refused without a lookup, a valid session cookie notwithstanding; otherwise
   `ctx.apiTokens.verify(secret, { ip })` returns a `TokenPrincipal`, which
   becomes the request's principal, or a refusal. A refused token counts
   towards the failed-token limiter (per IP, `RATE_LIMIT_TOKEN_FAILED_PER_10_MINUTES`,
   consulted after the lookup and skipping valid tokens, like the ingest's)
   and answers 401 `unauthorized` — `token_expired` for an expired one — with
   `WWW-Authenticate: Bearer realm="trail", error="invalid_token"`.
5. The per-token limiter for token requests (`RATE_LIMIT_TOKEN_PER_MINUTE`,
   key = token id, policy `"token"`, draft-8 headers).
6. The public routes of the registry (`auth: "public"`: the OpenAPI
   document). They never load the session, because their answers may be kept
   by shared caches, which must not pass the session's sliding refresh, or the
   clearing of a stale cookie, on to someone else; they take no body.
7. The session (`loadSession`), only when there was no bearer token: a bearer
   request never reads the cookie; a session from another site's page is
   refused, whatever the method (`sameOriginSessions`, §7).
8. The CSRF guard of §7 for every request without a token (a token is no
   ambient credential).
9. `express.json` (100 kB; `application/json` and `application/*+json`).
10. The other routes of the registry, then a JSON 404 `not_found` for
    anything else under `/api/v1`. Errors go through the shared error handler.

**Principals.** `RequestAuth` is `{ kind: "session", user, sessionId }` or
`{ kind: "token", user, tokenId, scopes, deviceIds }` (`deviceIds` null = all of
the user's devices). `requireAuth(req)` accepts either; `requireSession(req)`
(401 without a principal, 403 `forbidden` for a token) guards what only a person
signed in with a passkey may do: sessions, passkeys, passkey links, the
`/api/events` stream, creating, rotating and deleting device tokens, deleting
the account and finishing an `add_passkey` ceremony. `requireAdmin` takes a
session too: an API token gets 403 `forbidden`, an administrator's own
included, although the private chain that serves `/api/admin/*` reads no
tokens anyway. `hasScope(auth, scope)` is true for every scope of a session.
Device lookups take the principal (`DeviceAccess`): `findOwnedDevice`,
`resolveDeviceIds` and `loadDeviceSummaries` never return a device outside a
token's `deviceIds`, which therefore answers 404 like a foreign one.

**Scopes** (`packages/contracts/src/apiScope.ts`): `profile:read`,
`devices:read`, `devices:write`, `locations:read`, `locations:write`,
`history:read`, `people:read`, `shares:read`, `shares:write`, `audit:read`
(the data access log, §8.8). A route lists the
scopes that grant access; any one of them is enough, all of them with
`all: true`. A failure answers 403 `insufficient_scope`, naming the missing
scopes in the message and in `WWW-Authenticate: Bearer realm="trail",
error="insufficient_scope", scope="…"`. Without any principal a scoped route
answers 401 with `WWW-Authenticate: Bearer realm="trail"`. Scopes are the
privacy boundary, and anything with coordinates needs `locations:read`: the
points, visits and the heatmap are its operations, and `toDevicePublic` leaves
`DevicePublic.lastLocation` out for a principal without it (null keeps meaning
"no position yet"), so `devices:read` alone shows names, status, last-seen time
and battery, never where a device is. `history:read` is the history without
coordinates: trips, daily statistics, activity and Insights (§8.7).

**The token seam.** `ApiTokenVerifier` (`apps/api/src/v1/apiTokens.ts`) is the
only thing a token store has to provide: `verify(secret, { ip })` resolves a
well-formed secret to a `TokenPrincipal` or a `{ reason: "unknown" | "expired"
| "revoked" | "ip" }`; it answers rather than throws for a bad token and never
logs the secret. `AppContext.apiTokens` holds it: `createAppContext` wires in
the `api_tokens` store (`DatabaseTokenVerifier`, §8.4); integration tests may
inject another verifier through `createTestContext({ apiTokens })`
(`tests/support/fakeApiTokens.ts`) to try every outcome.

**Route registry.** Every operation is a `defineRoute(spec, handler)`
(`apps/api/src/v1/defineRoute.ts`) in a module of its own,
`apps/api/src/v1/routes/<feature>/<operationId>.ts`. Each feature lists its
operations in reference order in `routes/<feature>/<feature>Routes.ts`
(`profileRoutes`, `tokenRoutes`, `deviceRoutes`, `locationRoutes`,
`transportRoutes`, `historyRoutes`, `insightsRoutes`, `sharingRoutes`,
`accessLogRoutes`), and `apps/api/src/v1/v1Routes.ts`
aggregates the groups — one line per feature — plus the document's own route.
The spec:

| Field | Meaning |
|---|---|
| `method`, `path` | `"get" \| "post" \| "put" \| "patch" \| "delete"`; an OpenAPI path template under `/api/v1/` with `{param}`s, converted to Express's `:param` (`toExpressPath`; any other brace, colon, `*`, `?`, `(` … is refused) |
| `operationId` | unique, lowerCamelCase (`getDevice`) |
| `summary`, `description` | a few words for the sidebar; Markdown, to which the document appends who may call the route |
| `tags` | names from `v1Tags.ts` |
| `auth` | `"public"` (no session is loaded, no body accepted: the handler sees a token's principal or none); `"token"`, any API token whatever its scopes, for operations about the calling token itself (a session gets 400 `bad_request`); or `{ scopes: [...] }` (any one grants access) / `{ scopes: [...], all: true }`, with `allDevices: true` for an answer that covers the whole account (a token limited to some devices gets 403 `insufficient_scope`) |
| `request` | optional zod schemas: `params` (one key per path parameter; a value that fails it answers 404 — it names nothing), `query` (values are strings: coerce in the schema; failure 400 `validation_failed` with `fields`), `body` (JSON; not JSON 415, invalid 400) |
| `responses` | the body schema of each success status (`200`, `201`, `202`, `204`); `null` for no body |
| `errors` | error statuses beyond the implied ones (401, 403 and 503 for scoped routes; 400, 401 and 503 for token routes; 404 with path parameters, 400 with a query or body, 413 and 415 with a body, 429 and 500 always), e.g. `[409]` |
| `access` | how a scoped route counts in the data access log (§8.8): left out, every success is recorded for the caller with the operationId and what the validated input names, `read` for GET and `write` otherwise; `{ kind }` names another kind (`export`); `{ people: true }` marks an answer with other people's data, whose handler names their owners; `false` records nothing (the log's own routes). Not allowed on public and token routes, which are never recorded |

The handler receives `{ ctx, auth, params, query, body, req }`, typed from the
spec — `auth` is non-null on scoped routes and a `TokenPrincipal` on token
routes, absent parts are `undefined` — and
returns `{ status, body, headers? }` with a status the spec lists — and, for
the data access log, `owners` (required with `access: { people: true }`)
or `resource` (what else the answer names, such as a new share's id) — the
type checker enforces all of it. The body goes out through that status's
schema, so fields the schema does not name are dropped and a mismatch is a
logged 500; after it, the access is recorded (§8.8).
Errors are thrown as `HttpError`s. Streaming responses (SSE) are not supported
yet: extend `defineRoute` rather than mounting around the registry. Mistakes in
a spec (path parameters without params keys, a duplicate operationId or
method and path, a public route with a body, a schema the document generator
cannot describe) stop the
server at startup and fail the unit tests.

Adding a route:

1. The contract in `packages/contracts/src/<resource>.ts`: request and
   response schemas with `.meta({ id, description, example })` where it helps
   the reference; a path helper in `apiPaths.v1`.
2. The route in `apps/api/src/v1/routes/<feature>/<operationId>.ts`, added to
   the feature's group in `routes/<feature>/<feature>Routes.ts`. The domain
   logic stays in the feature's own folder (`apps/api/src/<feature>/`) and
   takes the principal, so device restrictions hold.
3. A new feature adds its group to `operations` in
   `apps/api/src/v1/v1Routes.ts` (one line: `...tokenRoutes,`) and its tag to
   `v1Tags.ts`.
4. Integration tests (session, a token with and without the scope, a token
   limited to other devices, another user's ids) and the OpenAPI snapshot:
   `npm test -w @trail/api -- -u`, then review the diff of
   `apps/api/tests/unit/__snapshots__/openapi.json`.

A worked example — renaming a device (`devices:write`) in
`routes/devices/updateDevice.ts`, then listed in `deviceRoutes`;
`renameDeviceRequestSchema` and `renameDevice` are what such a change adds:

```ts
import {
  deviceParamsSchema,
  devicePublicResponseSchema,
  renameDeviceRequestSchema,
} from "@trail/contracts/devicePublic";
import { renameDevice } from "../../../devices/renameDevice";
import { toDevicePublic } from "../../../devices/toDevicePublic";
import { defineRoute } from "../../defineRoute";

/** `PATCH /api/v1/devices/{id}` */
export const updateDevice = defineRoute(
  {
    method: "patch",
    path: "/api/v1/devices/{id}",
    operationId: "updateDevice",
    summary: "Rename a device",
    description: "Changes the device's name in Trail; the phone keeps sending as before.",
    tags: ["Devices"],
    auth: { scopes: ["devices:write"] },
    request: { params: deviceParamsSchema, body: renameDeviceRequestSchema },
    responses: { 200: devicePublicResponseSchema },
  },
  async ({ ctx, auth, params, body }) => ({
    status: 200,
    body: { device: toDevicePublic(await renameDevice(ctx.db, auth, params.id, body.name)) },
  }),
);
```

**OpenAPI document.** `buildOpenApiDocument(info, routes)`
(`apps/api/src/v1/openapi/`) renders the registry with zod-openapi:
`openapi: "3.1.1"`, `info` (title "Trail API", the build's version, and
docs/api.md without its title as the description), `servers` = `PUBLIC_URL`,
`securitySchemes.bearer` (http bearer, `trlk_…`, the scope table), one security
requirement per granting scope (`security: []` on public routes, a bearer
requirement without scopes on token routes), the tags of
`v1Tags.ts`, shared error responses per status listing their codes, and the
contracts as components (request parts as input schemas, responses as output
schemas; regex patterns of UUIDs and timestamps are left out for
readability). `createV1Router` builds it once at startup; `GET
/api/v1/openapi.json` (public, operation `getOpenApiDocument`) serves it with a
weak `ETag` and `Cache-Control: public, max-age=300`. The image has no `docs/`:
`.dockerignore` lets `docs/api.md` through and the API build (tsdown `copy`)
puts it next to the bundle, where `src/packagedFiles.ts` finds it; from the
sources it reads the repository's file.

**Reference page.** `GET /docs` (`apps/api/src/apiReference/`, mounted before
the SPA router, under the per-IP limiter) is Scalar's standalone bundle
(`@scalar/api-reference`, a development dependency whose `browser/standalone.js`
the build copies to `apps/api/dist/api-reference/`), never a CDN. The page
holds a mount point and three same-origin scripts whose names carry their
hash (`setup`, `scalar`, `start`; `Cache-Control: public, max-age=31536000,
immutable`, and a weak `ETag` that answers a revalidation with 304). The
4.6 MB bundle is read and hashed once, when `createApp` builds the router at
startup, so no request waits for the disk (an unreadable bundle leaves
`/docs` out, like a missing one); it is compressed once per process on first
request, brotli and gzip, not per request. The page itself revalidates
(`no-cache`). Its CSP is the one of §12 with
`style-src 'self' 'unsafe-inline'` — the reference writes its styles at
runtime — on this page only; `script-src 'self'` stays. Three details keep it
free of CSP violations: `setup` switches on zod's jitless mode before the
bundle runs (zod probes `new Function` otherwise); the mount point is not
`#api-reference` (the bundle auto-mounts an unconfigured copy there, which
loads Scalar's web fonts); the configuration turns off default fonts,
telemetry, Scalar's chat agent, MCP hints and the button that opens Scalar's
hosted client.

### 8.4 API tokens

The credentials of `/api/v1` for scripts, apps and agents: created in Settings
(§14), described for their users in [docs/api.md](api.md#tokens), stored in
`api_tokens` (§5). Contracts: `packages/contracts/src/apiToken.ts`; domain:
`apps/api/src/apiTokens/`.

- **Secret.** `trlk_` + 32 random bytes in base64url (`apiTokenSecretPattern`,
  which `authenticateBearer` checks before any lookup). Only its SHA-256 hex is
  stored, with the last four characters as the hint; the secret itself is in
  the answer of creating and rolling, and nowhere else.
- **Verification** (`DatabaseTokenVerifier`, the `ApiTokenVerifier` of §8.3):
  hash → one lookup joined with the user → refused when revoked, then when the
  client address is outside `allowed_ips`, then when expired, so a caller
  outside the allowlist learns nothing, not even the expiry → a
  `TokenPrincipal` with the token's scopes and devices. The address is `req.ip`
  as `trust proxy` settles it — an allowlist is only as good as
  `TRUST_PROXY`: with `true`, every client chooses its address — read as IPv4
  when it is IPv4-mapped and without a link-local zone, and matched with
  `node:net`'s `BlockList` against the networks of its own family only (IPv4
  networks must be written as IPv4); no address, no match. Use is
  recorded after the answer through `BackgroundTasks`, at most once a minute
  per token: the row's `last_used_at` decides, a set of tokens being recorded
  collapses bursts, and the `UPDATE` repeats the condition. A failed write is
  logged and never touches the request.
- **Management** (`/api/me/tokens`, `apps/api/src/me/apiTokensRouter.ts`) is
  session-only — `requireSession`, and the private chain does not read bearer
  tokens at all — and behind the CSRF guard: a token never manages tokens.
  Creating takes a name (1–60, trimmed), scopes (at least one, put in the
  vocabulary's order), devices (null = all; at most 50 of the user's own, else
  404, held `FOR KEY SHARE` until the commit so a device deleted meanwhile
  cannot stay in the list), an address allowlist (null, or 1–20 IPv4 or IPv6
  addresses or CIDR networks without host bits, `ipNetworkSchema`) and an
  expiry (stated: null for never, otherwise in the future). At most 50 tokens
  per user are active and 200 kept in all, revoked and expired ones included,
  so the list stays bounded (409 `conflict`); the user row is locked `FOR NO
  KEY UPDATE` while counting, so parallel requests cannot pass the limit
  together.
  `PATCH` changes those settings of an active token and keeps its secret (it
  locks the devices before the token, the order a device deletion takes them);
  rolling gives an active token a new hash and hint in the same row, so the old
  secret is unknown from the commit on; a revoked or expired token can be
  neither changed nor rolled (409). `DELETE` revokes (`revoked_at`, 204, also
  when it already was). Unknown, malformed and other people's ids are 404.
- **What a token reaches**: the scopes of its routes (§8.3) — coordinates
  (points, visits, the heatmap) only with `locations:read` — field by field
  where a scope guards part of an answer (`hasScope`: a device's position only
  with `locations:read`, `toDevicePublic(summary, auth)`), and its devices
  through `DeviceAccess`. `devices:write` renames a device, switches its alerts
  and queues presets, never its credentials or its deletion, which stay with
  the session. The dialog's templates (`apiTokenTemplates`): Read-only = every
  `:read` scope, Agent = those but `audit:read` (an agent has no business
  with who looked at the account) and `locations:write`, Full access = all.
  `GET /api/v1/tokens/verify` (`auth: "token"`) lets a token describe itself.
- **Audit**: `API token created`, `changed`, `rolled` and `revoked` at info,
  with the token's and the user's id (and the scopes or the changed fields),
  never the secret; the same four count in the owner's data access log
  (§8.8), and so does every call a token makes, by token.
- **Retention**: revoked and expired tokens stay listed for 30 days, then the
  hourly prune removes them (§10); deleting the account removes all of them.
### 8.5 Sharing (People)

Location sharing in the spirit of Find My: one person shows another where they
are — one way, on purpose, for as long as they choose — or shows anyone who has
a secret link. Code in `apps/api/src/sharing/`; the user guide is
[sharing.md](sharing.md), the threat model in `SECURITY.md`.

**Concepts.**

- A *share* goes from its owner to an address (lower-case). An address with an
  account is bound to it at once. Otherwise the share is *pending*; when
  someone signs up with the address it binds at once only if they came with an
  invitation to that very address — the administrator vouched for it. Any
  other sign-up (the allow-list, an open invitation) leaves it waiting: the
  owner sees `joined` with the new account's name and address and confirms
  (`POST /api/v1/shares/{id}/confirm`) or cancels. Until then the new account
  sees nothing. Trail does not verify addresses; this is where a person
  decides. New shares take the sign-up lock (`lockSignups`), so a share and a
  sign-up of its address at the same moment never miss each other.
- One current share per owner and address (a partial unique index); an ended
  one is stopped automatically when a new one is made. At most 50 current
  shares (pending and joined ones count) and 20 working links per owner, else
  409 `conflict`.
- The owner picks the devices (all — also later ones — or a list), the
  precision, history (only with precise), details (battery and activity) and
  the duration: one hour, until the end of the owner's local day, a week
  (7 × 24 h) or until stopped. The end of the day is found by bisection on the
  local date (`endOfLocalDay`), so days of 23 or 25 hours and zones that skip
  midnight need no special case. A `duration` in a change counts from now.
- The owner changes or stops a share; the recipient hides the owner or shows
  them again. Hiding is per person (`hidden_people`), not per share: a later
  share from someone hidden arrives hidden, without a `created` notice, until
  they are shown again. The owner sees the share as `hidden`. All of it takes
  effect with the next read and the next live event.

**Access rules.** `resolveAccessibleDevices(viewer, requested?)`
(`accessibleDevices.ts`) is the one place that decides what a viewer sees of
devices other than through their own device routes: the viewer's own devices
— precise and unbounded; for a token only with `locations:read`, and only the
devices it is limited to — and the devices of the shares that grant the viewer
access (`grantsViewer`: bound to the viewer, not stopped, not ended, not
hidden by the viewer; for a token only with `people:read`), each as
`{ deviceId, ownerId, shareId, precision, historyDays, from, includeDetails }`.
`from` is now − `history_days` for history shares and now − `STALE_AFTER_HOURS`
(the live window, 12 h by default) for live-only ones: Overland pauses while a
phone stands still, so a shorter window would hide everyone who sits still.
Requested ids must all be accessible (else 404). Shared data is readable
through the people routes, the live events, the public link endpoint and the
MCP server's `get_people` (§8.6, through `loadPeople`) only;
every other read (devices, locations, tracks, visits, trips, statistics, the
heatmap, exports) stays own-devices-only.

**Scopes.** Anything that can yield coordinates needs `locations:read`:
creating or changing a share or a link, and confirming a share, take
`shares:write` *and* `locations:read` (a share to an address the token
controls, or a precise link read back through the public endpoint, would
otherwise hand out positions the token may not read). Listing takes
`shares:read`; stopping a share or a link and hiding or showing a person take
`shares:write` alone; the people routes take `people:read`.

**Projection** (`gridProjection.ts`, `toSharedDevice.ts`). Per shared device a
recipient gets its name, the newest position recorded since `from` at the
share's precision, battery and activity of that window when the share
includes details, and the distance from the viewer's own most recently
located device — for principals with `locations:read` only — to the position
*shown*. Never device tokens or keys, settings, alerts, counts, ingest logs,
points outside the window, exports or deletion.

- `precise` passes the position on.
- `approximate` gives the centre of a cell of one grid per owner: rows of
  0.005° latitude (≈ 556 m); ten rows form a band, and each band is divided
  into a whole number of columns — a multiple of ten — about as wide in metres
  as the rows are high. `area` gives the centre of a block of ten by ten of
  those cells (≈ 5.6 km), so an area cell is always a union of approximate
  cells. Whole columns tile the full circle, so the cell at the antimeridian is
  whole too.
- The grid is offset by an HMAC-SHA256 of the owner's id under the
  `share-grid` key (`server_secrets`): the same for every device, share and
  link of the owner and for both precisions, so holding several of them —
  devices in one pocket, a share again after a stop, several links, an
  approximate and an area share — never narrows a position below one
  approximate cell. It is fixed (the same position gives the same cell on
  every read, so averaging gains nothing) and cannot be derived from anything
  public. The accuracy reported is the cell size (or the fix's own, when
  worse); altitude and course are dropped, for `area` the speed too.
- Battery and activity only with `include_details`: `motion`, the mode of an
  Overland trip in progress, and the current transport mode as location
  processing has it for the owner (`GET /api/v1/devices/{id}/mode`, §17.5:
  the quick toggle in force, else the latest stop or move while it ended
  within `LIVE_WINDOW_MINUTES`, a stop being `stationary`) — read by
  `loadCurrentModes` for all the shared devices of a request, an upload's
  fan-out or a link page in one query.

**Routes** (`apps/api/src/v1/routes/sharing/`, group `sharingRoutes`, tags
People and Sharing):

| Operation | Scope | Notes |
|---|---|---|
| `GET /api/v1/people` | `people:read` | people sharing with the caller, by name, with their shared devices |
| `GET /api/v1/people/{userId}` | `people:read` | one of them; 404 for anyone else or a hidden person |
| `GET /api/v1/people/{userId}/track` | `people:read` | shares with history only: points in `[from, to)` (≤ 93 days), `from` moved up to the start of the history, split and simplified as in §8.1 |
| `GET /api/v1/shares` | `shares:read` | current outgoing shares: `pending`, `joined`, `active`, `hidden` |
| `POST /api/v1/shares` | `shares:write` + `locations:read` | start one (201) |
| `PATCH /api/v1/shares/{id}` | `shares:write` + `locations:read` | change (duration from now, devices, precision, history, details) |
| `POST /api/v1/shares/{id}/confirm` | `shares:write` + `locations:read` | a `joined` share starts; 409 when nobody joined or it is bound already |
| `DELETE /api/v1/shares/{id}` | `shares:write` | stop (204) |
| `GET /api/v1/shares/incoming` | `shares:read` | current shares with the caller, hidden ones included |
| `POST /api/v1/shares/incoming/{id}/hide`, `…/unhide` | `shares:write` | hide or show a person |
| `GET /api/v1/share-links` | `shares:read` | the working links, then expired ones, each newest first, at most 50 |
| `POST /api/v1/share-links` | `shares:write` + `locations:read` | the secret and its URL only in the 201 |
| `DELETE /api/v1/share-links/{id}` | `shares:write` | turn off (204) |

History needs `precise` (400 `validation_failed`, also for a change that would
leave history on a coarse share); sharing with yourself is 400; devices must
be the caller's (404). `people:*` and `shares:*` reads are not limited by a
token's devices, but a token limited to devices shares only those, listed by
id (`deviceIds: null` is 400), and changes or confirms only shares that show
nothing but its devices, before and after the change (403 `forbidden`);
stopping is always allowed. Reading people stamps the shares'
`last_viewed_at`, at most once a minute and after the response; the owner sees
it, and every look counts in the owner's data access log (§8.8): the person,
the share, the devices shown and the range of a track, never the
recipient's session, token, browser or address. Accepted: starting a share tells the owner whether the address has an
account, and its name — on a server whose accounts come from the allow-list
and invitations, there is little to learn from it.

**Public links.** A link's secret is `trls_` + 32 random bytes (base64url),
stored as its SHA-256; the 201 carries it and `${PUBLIC_URL}/s#<secret>` once.
The secret lives in the fragment: browsers never send a fragment to a server,
a proxy or as a referrer, so no URL that reaches the network carries it. The
`/s` page reads it from `location.hash` (it stays there, so a reload works;
never in history state or storage) and sends it in the `X-Share-Secret`
request header. A link runs at least an hour and at most 30 days (24 h by
default); history 1–7 days and precise only; details off by default; without
a label it reads "Shared location", never the owner's name. `GET
/api/public/share` (`publicShareRouter`, mounted before the dashboard's `/api`
chain behind its own per-IP limiter `RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE`; no
session is read and no cookie set) answers 404 `not_found` for a missing
secret or one of the wrong shape (no lookup) or an unknown one, 404
`share_expired` for an expired or turned-off link, and otherwise the label,
expiry, precision, history and the devices it names: name, a per-link key (an
HMAC, never the device id), the projected position, details, and for history
links the simplified track (≤ 2 000 points per device, built at most every
30 s per link). It never names the owner's account, address or device ids. A
request counts as a view at most once a minute per link, and in the owner's
data access log per visitor and hour, a visitor being a network (/24 or /48)
and a kind of browser (§8.8). `/s` and `/api/public/share` send
`Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`.

**Lifecycle.** Stopped and ended shares and links are pruned 30 days later
(§10); `hidden_people` rows stay until the person is shown again or one of the
two accounts goes. Deleting a device takes it out of the owner's shares and
links (a share of only that device then shows none; it never widens to every
device) and tells their recipients; deleting an account removes its shares in
both directions and its links and tells the other sides. Live updates: §9.

### 8.6 MCP server

`/mcp` serves the Model Context Protocol for agents (`apps/api/src/mcp/`;
the guide for its users is [docs/mcp.md](mcp.md)). It answers with the data
of the v1 operations through the same query functions — never an HTTP round
trip — with the same tokens, scopes and device restrictions, shaped for a
model: units in the field names, times in the account's time zone with its
offset, a summary line beside the structured content.

**Transport.** Streamable HTTP with the official TypeScript SDK v2
(`@modelcontextprotocol/server`, adapted to Express 5 by `toNodeHandler` of
`@modelcontextprotocol/node`), stateless: one `McpServer` per request from
`createTrailMcpServer(session)`, no `Mcp-Session-Id`, answers as single JSON
bodies (`createMcpEndpoint`). Requests of the 2026-07-28 revision (the
per-request `_meta` envelope) go to the SDK's `createMcpHandler` with
`legacy: "reject"`; 2025-era requests (`initialize` and everything without
the envelope) to a stateless leg of the SDK's `WebStandardStreamableHTTPServerTransport`
with `enableJsonResponse` — routed by the SDK's own `isLegacyRequest`, so the
two cannot disagree. `@modelcontextprotocol/express` is not used: its app
factory and middleware (hostname-only Origin check, OAuth verifier) are
replaced by Trail's own below. The server declares no `listChanged` and no
resource subscriptions, so a 2026-07-28 `subscriptions/listen` is
acknowledged with an empty filter and completed at once, and nothing holds a
stream open.

**Mounting order.** `/mcp` is mounted before compression and the `/api`
chain; `createApp` puts steps 1 and 2 in front of `mcpRouter`, which does the
rest:

1. `Cache-Control: no-store` and the CORS headers on every response
   (`Access-Control-Allow-Origin: *`, no credentials; exposed: `RateLimit`,
   `RateLimit-Policy`, `Retry-After`, `WWW-Authenticate`, `X-Request-Id`),
   refusals included, as on `/api/v1`.
2. The per-IP limiter the whole API shares (`RATE_LIMIT_API_PER_MINUTE`).
3. The Origin check (`mcpOriginGuard`): no `Origin` passes (clients that are
   not browsers); an `Origin` must equal one of `mcpAllowedOrigins`
   (`PUBLIC_URL`, `ADDITIONAL_ORIGINS`, `MCP_ALLOWED_ORIGINS`; scheme, host
   and port), else 403 `origin_not_allowed`, before any token lookup. Host
   validation is left out: every request needs a bearer token, which a
   DNS-rebinding page cannot have.
4. Preflight: `OPTIONS` answers 204 with `Allow-Methods: GET, POST, DELETE`
   (GET and DELETE only to reach their 405), `Allow-Headers: Authorization,
   Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name`
   and `Max-Age: 600`.
5. `authenticateBearer(ctx)` with its failed-token limiter — one chain per
   app, so refused tokens count once per address for `/api/v1` and `/mcp` —
   then `requireApiToken`: without a token principal — no `Authorization`, or
   one in another scheme (`Basic` from a proxy) — 401 `unauthorized` with
   `WWW-Authenticate: Bearer realm="trail"`. The session is never loaded, so a
   cookie alone is refused.
6. The per-token limiter: `tokenRateLimit(ctx)` gives one instance per app,
   the one `/api/v1` uses too (`RATE_LIMIT_TOKEN_PER_MINUTE`): one budget per
   token for both.
7. `postJsonOnly`: other methods 405 `method_not_allowed` with `Allow:
   POST`; a POST without a body 400, with another media type 415.
8. `express.json` (1 MB, `application/json`) and `singleMessage` (a JSON
   array is 400: the SDK's 2025 transport would take a batch of 100 calls
   for one count of the rate limits), then the SDK, which gets the parsed
   body and the principal (in `AuthInfo.extra` as an `McpCall`, with
   the token's id as `token`, never the secret).
9. A JSON 404 for other paths under `/mcp` and an error handler with the
   API's error body. Before the SDK every refusal uses `{ error: { code,
   message } }`; from the SDK on, JSON-RPC.

**Tools.** `defineTool(spec)` (`mcp/defineTool.ts`) takes a snake_case
`name`, a `title`, a `description` for the model (never anything a user
typed), the `scopes` it needs (all of them), zod input and output schemas
(`packages/contracts/src/mcp.ts`: no component ids, so no `$ref`s; instants,
dates and ids described by `format` rather than their long patterns),
`access` (`read` or `write`) and `run(input, context)`, which returns
`{ result, text, items?, truncated?, access }` — `access` says what the call
read or changed, for the data access log: the devices it resolved and the
range or day, or for `get_people` the owners shown. `createTrailMcpServer`
registers only
the tools whose scopes the token holds, in the order of `mcpTools` (stable,
so clients can cache the list); a tool it may not use answers like an
unknown one (JSON-RPC `-32602`). A call goes through `runMcpWork`: the scopes
again; for `read` a transaction `READ ONLY` with `SET LOCAL
statement_timeout = '10s'` (unless the tool's functions take the whole
context and query the pool themselves, `transaction: false`: `get_people`);
the answer through the output schema (whatever it does not name is
dropped; a mismatch is logged with codes and paths only and answers a
generic failure); a log line at info with the tool, outcome,
duration, items, `resultBytes` and the token's id — never arguments, results
or the secret; and the access, counted in the data access log (§8.8) as
`mcp.<tool>` (resources as `mcp.resource.<name>`; listings are not counted).
Failures become tool results with `isError: true` and count nowhere: an
`HttpError` below 500 passes its message (static texts written for the
agent), a statement timeout says to ask for less, anything else is logged
and answers a generic message.

| Tool | Scopes | Built on |
|---|---|---|
| `list_devices` | `devices:read` | `loadDeviceSummaries`; `loadDeviceMode` only for a token with `locations:read` too (the mode tells when a device moves, as `GET /api/v1/devices/{id}/mode`); no position, no segment id |
| `get_current_location` | `locations:read` | the device cache (`loadDeviceSummaries`), `loadDeviceMode` |
| `get_location_at` | `locations:read` | `readPoints`, twice: the last point at or before `at` and the first after it within the tolerance |
| `get_timeline` | `locations:read` | `loadTimeline`, 500 items a call |
| `get_day_summary` | `history:read` | `loadModeStats` and `loadTimeline` for one local day; only times, counts and distances leave it |
| `get_visits` | `locations:read` | `findVisits` |
| `get_trips` | `history:read` | `findTrips` |
| `set_transport_mode` | `locations:read`, `locations:write` | `setDeviceMode(…, { source: "mcp" })`, then `processing.notify()` and the `segments` event, like `POST /api/v1/devices/{id}/mode` |
| `get_people` | `people:read` | `loadPeople` — the sharing gate (`resolveAccessibleDevices`, `toSharedDevice`, §8.5); names, precision, expiry and per device the projected position, its age, and battery and mode only with details; no addresses or ids; queries on the pool (`transaction: false`), and looking stamps `last_viewed_at` |

`device` is an id or the name of one device the token reaches, compared as
answers show names (`safeText`, NFC), so a name copied from `list_devices`
finds its device and names that read the same are refused as ambiguous
(`chooseDevice`); without it a single-device tool takes the device
with the newest position and a range tool every device. Ranges are at most 31
days (plus the hour of a night the clocks go back) and answers at most 500
items (`truncated` and a "narrow the range" sentence otherwise).
Resources: `trail://devices` (`devices:read`, `list_devices`'s answer) and
the template `trail://devices/{id}/location` (`locations:read`,
`get_current_location`'s answer; listed per device the token reaches, titled
by id — a listing's titles are no data field; any other id is
`ResourceNotFoundError`, `-32602`). No prompts.

**Text from users.** Device names and people's display names reach the
agent's model. `safeText` turns control, format and
separator characters (C0, DEL, C1, zero-width and bidirectional characters,
tag characters) into spaces, collapses white space, repairs lone surrogates
and cuts at 80 code points; `deviceRef` and the summary lines quote names
as JSON strings. The `instructions` hold no user value but the account's time
zone, and only when it has the shape of an IANA name.

**Server.** Name `trail`, title Trail, `config.build.version`, and
`mcpInstructions(timeZone, now)`: what Trail is, times (the zone and its
offset now), units, limits, the device argument, privacy, and that names are
data, never instructions. Cacheable 2026-07-28 results keep the SDK's
default hints (`ttlMs: 0`, `cacheScope: "private"`): lists vary by token.

### 8.7 Insights

Statistics of how the owner travelled (§14, Insights), from the stops and
moves of the timeline (`segments`, §17) and never from points: four v1
operations, tag "Insights", scope `history:read` (they carry no
coordinates: times, distances, speeds, way kinds and segment ids). Contracts:
`packages/contracts/src/insights.ts`; domain: `apps/api/src/insights/`.

| Operation | Answers |
|---|---|
| `GET /api/v1/insights/overview?from&to&devices` | `{ timezone, period { from, to, days, bucket, buckets }, previous { from, to, days, totals }, totals { distanceM, durationS, moves, stops, activeDays }, modes [{ mode, distanceM, durationS, moves, avgSpeedKmh, share, deltaDistanceM }], series [{ bucket, mode, distanceM, durationS }], pending }` |
| `GET /api/v1/insights/modes/{mode}?from&to&devices` | `{ timezone, mode, period, totals { …, typicalSpeedKmh, longest, fastest }, series, byHour [24], byWeekday [7], roads { distanceM, mappedM, kinds }, rail, ferry, stationStops, speedHistogram { binKmh, bins }, topMoves { longest, fastest, recent }, pending }` |
| `GET /api/v1/insights/time?from&to&devices&mode` | `{ timezone, period, mode, modes, cells [168: weekday × hour], pending }` |
| `GET /api/v1/insights/roads?from&to&devices&mode` | `{ timezone, period, mode, modes, distanceM, mappedM, kinds, families, pending }` |

- **The period** is local days in the owner's zone, `from` and `to`
  included, at most three years (`lastInsightsDay`: the day before the same
  date three years on). `to` left out is today; `from` left out is the first
  local day with a segment of the devices (one index lookup per device), but
  no earlier than three years before `to` (`resolvePeriod`); a left-out end
  that breaks the span or the order answers 400 like the schema does.
  `devices` goes through `resolveDeviceIds` (another person's or a device
  outside the token: 404); a token limited to some devices sees only theirs.
- **Reading.** One query per operation reads the moves overlapping the
  period (`loadInsightMoves`: id, device, mode, start and end, distance, top
  speed and from `features` the median speed, `wayKinds` and `dwells`); the
  overview reads its previous period with it and counts the stops that
  started in both. Everything else is pure TypeScript, unit-tested without a
  database.
- **Prorating.** `localHours` lists the period's local hours (a day of 24
  hours numbers them from 0; a day of 23 or 25 hours, or one that starts after
  a skipped midnight, asks the zone for each hour's number, so 02:00 is
  missing on the day summer time starts and comes twice on the day it ends).
  `hourParts` splits every move over them by time, its distance in
  proportion — as `GET /api/v1/stats/modes` does by day — so a move across
  midnight or the period's edge counts with the part inside; days, weeks,
  months, hours of the day and weekdays add up those parts. Counts (moves,
  stops) are of what started inside the period, as are the statistics of
  whole moves: the typical speed (median of the moves' median speeds,
  weighted by time), the longest and fastest (top speed), the halts at
  stations (`features.dwells`: stations for trains, tram stops for trams,
  metro stations for metros), the speed histogram and the top five longest,
  fastest and most recent.
- **Steps.** By the period's length: up to 31 days by day, up to 26 weeks
  by week (Monday to Sunday, named by the Monday, the first possibly before
  `from`), else by month; `period.buckets` lists them all, `series` leaves out
  empty ones (a mode page's series lists every step).
- **Deltas** compare with the period of as many days just before; the
  overview gives that period's totals, and each mode's `deltaDistanceM`.
- **Roads.** `features.wayKinds` (§17.3) gives every move's distance per
  kind of way, scaled so the stored, rounded shares add up to the whole;
  `mappedM` is the distance of moves that have them, which the shares are
  of. Moves without (no map data; or worked out before inferred version 2,
  until the backfill reaches them) count towards `distanceM` only. Families
  are the kinds grouped as the inference groups them (`wayFamilyOf`); the
  rail share of trains, trams and metros is rail, light rail, tram and subway
  track, the ferry share of boats ferry routes.
- `pending` is the timeline's (`hasPendingWork` over the period's devices
  and instants). A request covering three years reads at most the segments
  of those years and builds about 26 000 local hours in some 30 ms.

### 8.8 Data access log

Every read of a person's data, and every change to it or to who may see it,
is recorded for that person: who, when, through which channel and which
data. Only they can read it (`audit:read`, below). Code in
`apps/api/src/dataAccess/`; the guide for API users is
[docs/api.md](api.md#access-log). It is not the request log of §12, which
pino-http writes for the operator.

**Rows** (`data_access_events`, §5). A row counts one access — the same
actor doing the same thing to the same data — within one UTC hour:
`count`, `first_at`, `last_at`. Actors and their channels, as the table's
check has them:

| `actor_kind` | `channel` | Actor | Reference kept |
|---|---|---|---|
| `owner` | `web` | the owner's own browser session | `actor_session_id`, label = the browser ("Safari on iPhone") |
| `token` | `api`, `mcp` | one of the owner's API tokens, directly or through the MCP server | `actor_token_id`, label = its name |
| `person` | `people`, `live` | someone the owner shares with: looking (People, their token, their agent), or their open page receiving a position | `actor_user_id`, `actor_share_id`, label = their display name |
| `link` | `link` | a visitor of a public link | `actor_link_id`, label = the link's label; `visitor_key`, `ip_coarse`, `ua_family` |

References have no foreign keys: sessions, tokens, shares, links and
accounts end long before their rows do, and `actor_label` keeps the name
they had (cleaned like the MCP server's names, at most 80 characters).
`action` is the server's name for the access — a v1 `operationId`,
`dashboard.<route>`, `mcp.<tool>` or `mcp.resource.<name>`, `link.view`,
`live.position` — `access` is `read`, `write` or `export`, `status` the
answer's, and `resource` says which data in the server's words
(`dataAccessResourceSchema`: devices, a range, an instant, a day, hours, a
level, precision, mode, export format, days of history, a segment, share,
link or token, and `folded`), canonical — keys and devices sorted — and
checked against the contract before it is kept. `dedupe_key` is the SHA-256
(base64url) of the actor's identity, the channel, action, kind and
resource; `(owner_user_id, bucket_start, dedupe_key)` is unique.

**Recording.** `ctx.dataAccess.record(access)` (`DataAccessRecorder`) only
touches memory: accesses are counted per owner, hour and dedupe key, and two
seconds after the first — at once when 500 distinct rows wait — they go into
the table in one statement per 500 rows: `INSERT … SELECT … FROM unnest(…)
ON CONFLICT … DO UPDATE SET count = count + excluded.count, first_at =
least(…), last_at = greatest(…)`, the newest label and status. Rows of an
account deleted meanwhile are left out (`WHERE EXISTS`). When the database
refuses a statement's data, its rows go in one by one and only the refused
one is dropped and logged; any other failure leaves the rows for the next
write, a row at most three times; at most 10 000 rows wait in memory, more
are dropped and logged. The shutdown writes what is waiting (§12). `record`
never throws and never waits, so the log cannot slow or fail a request, and
the chain of writes survives even a write that throws. An access whose
action or resource the contract refuses is not recorded — a bug, logged —
rather than kept with less. A link visitor's key needs the
`data-access-visitor` key of `server_secrets`, which the write loads once
(again only after a failed load) rather than the request.

**Bounded.** Hour rows bound repetition but not variety: a caller could ask
for a new range every second. So per owner, hour, actor and action at most
50 distinct rows are kept, and per owner, hour and actor 200 over all
actions; further accesses are counted on one row per action whose resource
keeps only the devices and `"folded": true`. Per link and hour at most 50
distinct visitors are kept, a visitor being a network — other kinds of
browser from a network that came already add rows, but there are only a
handful of kinds — and further ones are counted together on a row without a
visitor (no key, network or browser). What tells rows apart for these
limits is itself bounded: 50 000 entries an hour, past which every new
access folds. Nobody — a recipient, a script, a botnet opening a link — can
grow somebody's log faster than that, and the retention ends every row
(`DATA_ACCESS_RETENTION_DAYS`, 365 days by default; §10). The table has
`fillfactor = 70`, so counting a row again is a heap-only update.

**What is recorded, and where.**

- **v1** (`defineRoute`, §8.3): after `send`, every answer of a scoped route
  with a success status, for the caller's own account — a session on `web`,
  a token on `api` — with the operationId as the action, `read` for GET and
  `write` otherwise (or the spec's `access.kind`), and the resource from the
  validated path, query and body (`inputResource`: `device`, `devices`,
  `deviceId`, `deviceIds`, `from` and `to` (instants in UTC, local days as
  they are), `at`, `date`, `hours`, `level`,
  `precision`, `mode`, `format`, `historyDays`, and the path's `{id}` as a
  device, segment, share or link, `accessPathId`) plus what the handler's
  result names (`resource`: a new share's or link's id). The people routes
  (`access: { people: true }`) return `owners` instead: one access for each
  person shown, on `people`, the caller recorded as that person and the
  share they looked through — never which session or token they used, their
  browser or their address. A token's call of a people route also counts in
  the token's own account, like every token call, with an empty resource:
  that it happened, not whom it showed. `access: false` leaves a route out
  (the access log's own); token routes (`tokens/verify`) and public ones (the
  OpenAPI document) record nothing; nor does a refusal, an invalid request or
  a failure, which throw before.
- **The dashboard's private API** (`recordDashboardAccess`, after the
  answer): tracks (level `raw`), the heatmap (its devices; the viewport is a
  place and is never kept), daily statistics, activity, visits, trips, raw
  points (the device; the page cursor stays out), the export (`export`, as
  the download starts), deleting a period or a device, and creating,
  changing, rolling and revoking an API token. Not the device list, the
  configuration, health, the session or the other settings.
- **MCP** (`runMcpWork`, §8.6): every tool call and resource read that
  succeeds, as `mcp.<tool>` or `mcp.resource.devices` /
  `mcp.resource.device_location`, on `mcp` with the token. A tool's answer
  says what it read (`ToolAnswer.access`): the devices it resolved — an id,
  also when the agent named the device — and the range or day, or for
  `get_people` the owners: on `people`, like the people routes, and as
  `listPeople` — that someone asked an agent is their own business — while
  the token's account counts `mcp.get_people` with an empty resource.
  Resource listings name only devices and are not recorded.
- **Live** (`publishPeopleLater`, §9): each `person` event, per recipient,
  device and hour, `count` = the positions pushed.
- **Public links** (`loadPublicShare`, §8.5): each view of a working link,
  per visitor and hour: `ip_coarse` = `coarseNetwork(req.ip)` — the IPv4
  /24 (`81.82.83.0/24`) or IPv6 /48 (`2001:db8:1234::/48`), an IPv4-mapped
  or 6to4 address (`2002::/16`, whose /48 is a whole IPv4 address) read as
  the IPv4 address it carries, null for anything else — `ua_family` =
  `userAgentFamily` ("iPhone · Safari", from the session labels' tables),
  and `visitor_key` = HMAC-SHA256 under the `data-access-visitor` key of the
  owner, the network and the family, cut to 16 hex digits. The full address
  never leaves `loadPublicShare`. Ended links record nothing.

**Reading** (`apps/api/src/v1/routes/accessLog/`, group `accessLogRoutes`,
tag Access log; both `audit:read`, which every session holds and the
Read-only template includes, the Agent template not):

| Operation | Notes |
|---|---|
| `GET /api/v1/access-log` | the owner's rows, newest hour first (within an hour by dedupe key), `limit` 1–200 (50), keyset `cursor` on `(bucket_start, dedupe_key)` — the unique key, which never changes once a row exists, so a row counted again while someone pages stays where it was; filters `from`, `to` (the hours they touch), `actor` and `channel` (comma-separated kinds), `action`, and `actorId` — one actor (`actorCondition`): `person:<userId>` (every share they looked through), `token:<tokenId>`, `link:<linkId>` (all its visitors) or `session:<browser>` (the owner's browser by the row's label, as the summary lists the sessions: the log shows no session ids), made and read by `dataAccessActorId` and `parseDataAccessActorId` in the contracts. A line's `id` is its hour and dedupe key (`498630.<key>`): the identity column, which counts the rows of every account, never leaves the server — its gaps would tell an owner how much others are read |
| `GET /api/v1/access-log/summary` | `days` 7, 30 (default) or 90 local days, today included, in the account's time zone: totals per actor kind, channel and kind of access, and the distinct people and link visitors (visitor keys); a dense series per day by actor kind and by channel (an hour counts on the local day it starts in — the totals' period follows the same rule, so in a zone with half hours they always add up); the people (with their actions), links (with distinct visitor keys) and tokens (api and mcp apart, with their actions), each with events and last seen, at most 20 each; the owner's own sessions apart. `actorId`, as for the list, sums up that actor alone — the pages of an actor, a token, a link and a share (§14) |

Every query filters by the principal's user: no route reads another
account's log, an administrator's neither. The log covers the whole
account, so a token limited to some devices is refused (`allDevices` in the
route's `auth`: 403 `insufficient_scope`, explaining why), and Settings does
not offer `audit:read` with a device list (`everyDeviceScopes`). Actor
names are the current ones while the actor exists — the token's name, the
link's label, the session's user agent, and a person's display name while
the share they looked through is in force (in the summary: while a share
with them is), so the owner learns no new name of someone they no longer
share with — and the snapshot otherwise; current names are cleaned like
the stored ones. Reading the log is not recorded (`access: false`). The
pages (Settings › Who viewed you and Access log, §14) hide the owner's own
sessions unless the `showOwnActivity` preference says otherwise; the API returns
them unless the `actor` filter leaves them out.

**Threat model.**

- *Who learns what.* The owner learns which person looked, when (to the
  hour, with the first and last time), through which share, at what
  (devices, a range, a precision) and how often — what the sharing guide
  tells recipients (docs/sharing.md). They never learn a recipient's
  sessions, tokens, browser or address: `personActor` keeps none of it, and
  the table's check refuses a person row with a session or token id. Of a
  link visitor, who is anonymous anyway, the owner learns the network (/24,
  /48) and the kind of browser, never the address: the check refuses any
  network address but a /24 or /48, and refuses one on any row but a link
  visitor's. Two visitors of one network and browser are one visitor.
- *Readable by the owner alone.* Owner-scoped queries, no administrator
  path, `audit:read` for tokens (not in the Agent template); a recipient's
  own log holds nothing of what they read of others.
- *No coordinates, no secrets.* Resources are built from validated input
  by whitelist and checked against a contract without a place in it (no
  bounding box, no position); token and link secrets, device tokens and
  cookies never reach a row (`actor_session_id` is the session's id, the
  SHA-256 of its cookie, as in `sessions`). The visitor key is made of the
  coarse values only, so even the server's key turns it into nothing the row
  does not show.
- *Not forgeable.* Actions are the server's constants, resources come from
  validated input and the server's own results, actors from the principal;
  the only text from people is a name (a token's, a display name, a link's
  label), cleaned and cut. A caller cannot write a row for another account:
  the owner is the principal, the owner of what was shown, or the link's.
- *Not slowing or failing requests.* `record` is a few hashes and a map
  entry; the write is batched, in the background, and its errors are logged.
- *Bounded growth.* Hour rows, the fold limits per actor and per link, the
  in-memory limit, the retention, and the cascade with the account.

## 9. Live updates (SSE)

`GET /api/events` — `text/event-stream`, `Cache-Control: no-store`,
`X-Accel-Buffering: no`, never compressed, `: ping` every 20 s (proxies drop
idle streams after ~100 s). A stream starts with `retry: 5000` and a `hello`
event. In-process event bus keyed by user id (the app is a single instance).
At most 10 streams per user (the 11th → `429 rate_limited`). Logout, session
revocation and account deletion close the affected streams at once, and every
ping re-checks the session; such a stream first gets a `session-ended` event,
so the page shows the sign-in page instead of checking the session (a 401)
and reconnecting. A shutdown closes streams without it (clients reconnect). A
client with more than 1 MB unsent is dropped.
`ingest` is published for every accepted upload (also when everything was a
duplicate), followed by a `device` event with the fresh summary. The web app
replaces device cache entries from `device` events and appends
`ingest.points` to today's track. `segments { deviceId, from, to }` follows when processing finished a
window of a device's history, or a person corrected a mode (§17.4): the
dashboard refetches the tracks at their level, the timeline and the current
mode.

Sharing (§8.5) adds two events. `person` (`{ userId, device }`, the device as
the stream user's share shows it) follows every upload of a shared device, to
each recipient with an open stream whose share is in force, covers the device
and is not hidden; the owner's data access log counts them per recipient,
device and hour (`live.position`, §8.8). An owner's shares come from a per-process cache
(`SharingState`, one minute) that every change to them clears, and expiry is
checked whenever it is used, so a stopped, hidden or ended share receives
nothing from the next upload on. `share` (`{ shareId, userId, change }`) tells
the other side of a share what changed: the recipient on `created` (also when
the owner confirms a joined share; never while the recipient hides the owner),
`updated` and `revoked`, the owner on `hidden`, `unhidden` and `claimed`
(someone signed up with the address of a pending share — bound, or waiting
for confirmation). The web app updates the people list from `person`
events and refetches people and shares on `share` events.

## 10. Background jobs (in-process, single instance)

- every 5 min (only when `ALERT_NTFY_URL` is set) — silent-device check:
  alerts-enabled devices whose `last_seen_at` is older than
  `STALE_AFTER_HOURS` and not yet alerted → ntfy message ("<device> (<owner>)
  has sent nothing for 12 h — last upload …" in the owner's time zone; `Title`,
  `Tags`, `Priority` headers, RFC 2047 for non-ASCII titles, `Authorization:
  Bearer` when `ALERT_NTFY_TOKEN` is set), then stamp `stale_alerted_at` —
  only after delivery, so an unreachable ntfy is retried next run. Recovery
  alert when data resumes (§6.2). Turning a device's alerts off clears its
  stamp.
- hourly — delete expired sessions, ceremonies, links, invites (used/expired
  > 30 days), API tokens (revoked/expired > 30 days) and stopped or ended
  shares and share links (> 30 days); prune `ingest_log` (> 90 d) and the
  hours of the data access log older than `DATA_ACCESS_RETENTION_DAYS` (365 d;
  a log, not recorded data). Recorded data — locations, visits, trips,
  events, rejects — is never pruned.
- every 2 s while accesses wait — the data access log's write (§8.8), in one
  statement per 500 rows; a failed write is tried again with the next.
- debounced (10 s) — daily-stats recomputation per touched (device, day), in
  the owner's time zone at run time; a failed pass is retried with the next.
  Changing the time zone (`PATCH /api/me`) rebuilds every day of the user's
  devices in the background.
- the processing worker (§17.4) — 3 s after new work, every minute for
  retries and every 15 minutes for windows waiting on map data and lost
  windows; the boot-time backfill when a level's algorithms changed version;
  map tiles fetched alongside, within the daily budget.
Jobs must never crash the process; failures are logged. Runs never overlap.

## 11. CLI

`apps/api/src/cli.ts` (bundled to `dist/cli.mjs`; `/usr/local/bin/trail` in
the image, so `docker compose exec app trail <command>`):

- `migrate` — apply migrations (also done at boot)
- `passkey-link <email> [--origin <url>]` — one-time URL to add a passkey (recovery)
- `invite [--email <email>] [--days <n>]` — invite URL
- `users` — list accounts
- `recompute [--device <id>]` — rebuild heat cells + daily stats
- `reprocess [--device <id>] [--from <iso> --to <iso>] [--from-level averaged|mapped|inferred]`
  — work out the processed levels again (§17.4)
- `prune` — run the retention cleanup now
- `help` / `--help`

Every command applies pending migrations first (same advisory lock as the
server). Output on stdout, logs on stderr. Exit codes: 0 success, 1 failure
(including invalid configuration), 2 wrong usage (unknown command or option,
invalid value).

## 12. Security

- helmet: CSP `default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data: blob: <map origins>; connect-src 'self' <map origins>;
  worker-src 'self' blob:; child-src 'self' blob:; font-src 'self';
  manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self';
  frame-ancestors 'none'` (+ `upgrade-insecure-requests` on HTTPS); the map
  origins are `MAP_CONNECT_SRC` plus the origins of the map styles and of the
  satellite imagery (§4). No inline scripts or styles in HTML; CSSOM style changes (React `style`, MapLibre) are
  allowed by CSP. HSTS (2 years, includeSubDomains) on HTTPS only.
  `Referrer-Policy: same-origin`, `Permissions-Policy` denying the powerful
  features (camera, microphone, geolocation, payment, USB, …) and allowing
  only `publickey-credentials-get/create`, `clipboard-write` (the copy buttons
  of the device setup) and `fullscreen` (map) for the page itself — only
  feature names Chromium knows are listed, an unknown one is a console error on
  every page. COOP `same-origin`, CORP `same-origin`, `Origin-Agent-Cluster:
  ?1`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, every
  response tagged with `X-Request-Id` (a well-formed incoming one is kept).
  The one exception is the API reference at `/docs`, a third-party app that
  writes its styles at runtime: its page adds `'unsafe-inline'` to
  `style-src` (scripts stay `'self'`, everything else as above; §8.3).
- `/api/v1` answers any origin (`Access-Control-Allow-Origin: *`) without
  credentials: a page on another site reaches it with an API token, never with
  the visitor's session cookie (which is `SameSite=Strict`, never sent with a
  credential-less request either, and refused from another site's page by
  `Sec-Fetch-Site`, §7).
- `/mcp` (§8.6) takes an API token only, never the session cookie, and
  refuses a request whose `Origin` is not one of the instance's or
  `MCP_ALLOWED_ORIGINS` (403, before the token lookup). Its tools see what
  the token's scopes and devices allow — coordinates only with
  `locations:read` — and every answer leaves through its output schema;
  names typed by users reach the agent's model only as sanitised data fields
  (`safeText`), never in instructions or descriptions. Reads run read-only
  under a 10 s statement timeout (except `get_people`, which reads through
  `loadPeople` on the pool and stamps the shares' `last_viewed_at`), a call
  covers at most 31 days and 500 items in one message, and a call is logged
  with its tool, outcome, duration and size only.
- `trust proxy` from `TRUST_PROXY`, by default nobody: the client address (per-IP
  rate limits, session IPs) and HTTPS (`req.secure`: the `__Host-` cookie, HSTS)
  come from `X-Forwarded-For`/`-Proto` of trusted hops only, otherwise anyone
  could claim a new address per request. `deploy/compose.yaml` trusts exactly
  Launchway's edge at its fixed address on Launchway's proxy network (§13);
  the app publishes no host port.
- Rate limits: auth routes ~20/min/IP (all `/api/auth/*` except the session
  probe); ingest ~300/min/token and ~30 failed tokens/10 min/IP; API tokens
  ~600/min/token and ~30 failed tokens/10 min/IP; the data of public share
  pages ~60/min/IP; everything else, `/docs` included, ~600/min/IP
  (`/api/health*` and `/api/config` excluded). `429
  rate_limited` (ingest: Overland's `{"error"}`), IETF `RateLimit` headers.
  Configurable (§4). The failed-token limits are consulted after the token
  lookup and only for requests without a valid token: a scanner sharing the
  phones' or a client's address (NAT, proxy) never locks out a valid token.
  The per-token budget is one for `/api/v1` and `/mcp` together.
- Database statements time out after 120 s (10 s for the MCP server's reads);
  deleting a device or an account and rebuilding derived data lift that limit
  for their own transaction.
- Body limits: 100 kB default, 1 MB on `/mcp`, 5 MB on the ingest route.
- Map data (§17.3) is the only outbound request besides ntfy: tile bounding
  boxes posted to `PROCESSING_OVERPASS_URL` without credentials or cookies,
  without redirects, with a capped answer parsed strictly, and a User-Agent
  that names the software (`Trail/<version>
  (+https://github.com/JensPenneman/trail)`), not the instance. The tiles
  requested show the Overpass operator which squares of about 1.5 km the
  devices passed through and when (fetches follow uploads), from the server's
  IP address — not the tracks or who the user is; a self-hosted Overpass or an
  empty `PROCESSING_OVERPASS_URL` keeps that at home, and a local extract
  behind the `WaySource` interface is a possible later step.
- pino-http redacts `authorization`, `cookie`, `referer`, `set-cookie`, token
  query params and the `X-Share-Secret` header; coordinates, map tile keys and
  OSM ids are never logged above `debug` (the processing log keeps counts,
  times and the kind of failure, `TileFetchError.reason`). The access log keeps
  method, redacted URL, status, client address and user agent only. The URL is
  redacted from its parsed parts, as the routers read them (decoded,
  case-insensitive): device tokens in `token`/`access_token`, the one-time
  tokens of `/link/…`, `/invite/…` and `/api/auth/link/…`, and any API token or
  share link secret (`trlk_…`, `trls_…`) a client puts into a URL after all —
  public links keep theirs in the fragment and a header (§8.5). Database errors are
  logged without query parameters or failing-row details; for an error from
  Postgres only its SQLSTATE, routine and the names of what failed (constraint,
  table, column), because its message can quote the refused value.
- Graceful shutdown (SIGTERM/SIGINT): stop accepting, end SSE streams, stop
  jobs, let in-flight requests finish for up to 10 s (then cut them), flush
  pending daily statistics and data access rows, then background work, and
  the data access rows it recorded (≤ 2 s each), close the pool.
  A hung shutdown exits after 13 s, so the container's stop grace period
  should be at least 15 s.
- Tokens (device, session, invite, link, API, share link) are stored hashed
  only, and each secret is shown once. API token and share link secrets are
  shape-checked before any lookup and never logged; API token secrets are only
  ever accepted in the `Authorization` header of `/api/v1` and `/mcp`, in the
  Bearer scheme (another scheme there is no credential at all). An API token
  does what its scopes allow, with its devices, from its addresses, until it
  expires or is revoked (§8.4); none can manage tokens, sessions, passkeys or
  device credentials, which take a passkey session. Creating, changing,
  rolling and revoking a token is logged with its id. Public link pages and
  their data send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex,
  nofollow` (§8.5).
- Sharing: other people's data is read through `resolveAccessibleDevices`
  only, coarse positions never leave the server unprojected, anything that
  can yield coordinates (a share, a link, a confirmation) needs
  `locations:read`, and a stopped, ended or hidden share shows nothing from
  that moment on (§8.5, §9).
- The data access log (§8.8) tells an owner who read their data — their
  browser, their tokens and agents, the people they share with, their links'
  visitors — and is theirs alone: owner-scoped queries, `audit:read` for
  tokens, no administrator path. It keeps no coordinates (resources are built
  by whitelist and checked against a contract without places), no secrets, no
  recipient's session, token, browser or address, and of a link visitor only
  the /24 or /48 network and the kind of browser, which the table's checks
  enforce too. Recording is in memory and written in the background, so it
  can neither slow nor fail a request, and hour rows, fold limits and the
  retention bound it.
- The container runs as the unprivileged `node` user on a read-only root
  filesystem (`tmpfs /tmp`), `no-new-privileges`, all capabilities dropped.
- Postgres is not published outside the Docker network in production.
- The app container receives an explicit list of its own variables (§4), not
  the whole `deploy/.env`: Launchway's and the backup's variables never reach
  it.

## 13. Deployment

### 13.1 Image

`Dockerfile` (repo root), multi-stage; build stages run on `$BUILDPLATFORM`
(pure JS, no native modules) so the multi-arch image (`linux/amd64`,
`linux/arm64`) needs no emulation, and the final stage has no `RUN` step.
Runtime: `node:lts-alpine` (digest-pinned, Dependabot keeps it current),
production `node_modules` of the API only (`npm ci --omit=dev --workspace
@trail/api`, installed on the build platform — which is why the API's runtime
dependencies must stay pure JavaScript; the build fails on a `.node` addon),
`apps/api/dist` (with the API guide and the reference bundle the API build
copies next to the server, §8.3), `apps/api/drizzle`, `apps/web/dist`, the CLI wrapper
`/usr/local/bin/trail`; `USER 1000:1000` (`node`); `EXPOSE 8080`;
`HEALTHCHECK` on `/api/health/live` (busybox `wget`); OCI labels
(`org.opencontainers.image.source` links the GHCR package to the repo);
build args `APP_VERSION`, `GIT_SHA`, `BUILD_TIME` → env (CI sets the
package.json or tag version, the 7-character commit that matches the
`sha-<short>` tag, and an ISO UTC time; empty means unset).

### 13.2 Images and releases

GitHub Actions (`ci.yml`): on every push to a branch of this repository
(after lint/typecheck/unit/integration/E2E pass) build and push
`ghcr.io/jenspenneman/trail` tags `sha-<short>` and the branch name, plus
`latest` on `main`; a `v*` tag adds `<version>` and `<major>.<minor>`, never
`latest`. Pull request runs only build, so a fork never publishes; Dependabot
branches only build too (read-only token). BuildKit provenance (`mode=max`)
and SBOM attestations, plus a signed GitHub build provenance attestation when
the repository is public (GitHub offers those on private repositories only
with Enterprise Cloud). Base-image patches arrive as Dependabot digest updates
of the Dockerfile, auto-merged on green CI; the weekly scheduled run (Monday
03:00 UTC) rebuilds and republishes `main`.

Releases: release-please (`release-please-config.json`, `release-type: node`,
`"draft": true`) keeps a release pull request open; `scripts/release.sh`
cherry-picks its commit onto `main` signed, pushes a signed tag `vX.Y.Z` and
creates the GitHub release as a draft. CI on the tag publishes the images and
then the draft (job `release`); a release pull request merged on GitHub
instead gets its tag and CI run from the Release Please workflow.

### 13.3 Deployment

Launchway deploys `deploy/compose.yaml` (the only Compose file) on every
published release (`release.published`; drafts are ignored) as the project
`launchway-trail`, and every pull request from this repository as
`launchway-trail-pr-<n>` with its own host name. It writes the app's
variables to `deploy/.env` and adds `LAUNCHWAY_COMMIT_SHA_SHORT` (the image
tag) and `LAUNCHWAY_PUBLIC_URL` (the default of `PUBLIC_URL`). Production sets
`COMPOSE_PROFILES=production` (starts `backup`, which bind-mounts
`BACKUP_DIR`) and `TRAIL_DB_VOLUME` (a volume created by hand; Compose never
removes a volume it did not create, `down -v` included); the app is marked
trusted in Launchway for both. A preview sets neither: no backup, no host
mounts, and a database volume of its own project (`<project>_trail-db`),
removed with the preview. The app migrates the database on boot. Rollback =
redeploy an older release. `deploy/compose.dev.yaml` builds the working tree
for a local run (`TRAIL_IMAGE`). The former standalone stack (Watchtower,
Cloudflare Tunnel or Caddy on a Windows laptop) is in the history at
`3e560ee`.

### 13.4 Backups

`backup` service (production only; same Postgres image, a POSIX `sh` loop
from a Compose config): `pg_dump -Fc` daily at `BACKUP_HOUR` (3, local time in `TZ`) to
`BACKUP_DIR/trail-<UTC timestamp>.dump` (e.g. a synced folder for an
off-site copy), written to a temporary name, read back with `pg_restore --list`
and only then renamed. The first dump of each month is copied to `monthly/`,
the first of each year to `yearly/`. Retention: dailies and leftover
`pre-update/` dumps of the standalone stack `BACKUP_KEEP_DAYS` (14), monthlies `BACKUP_KEEP_MONTHS` (12), yearlies
`BACKUP_KEEP_YEARS` (0 = forever). It also dumps at start when the newest dump
is older than a day, or always with `BACKUP_ON_START=true`. A failure exits non-zero
and the restart retries. Restore with `pg_restore --clean --if-exists
--single-transaction` (runbook in `docs/operations.md`).

## 14. Web app

React 19 + React Router 8 + TanStack Query 5 + MapLibre GL 6 (OpenFreeMap
vector styles, light/dark and optional satellite imagery from `/api/config`),
`@simplewebauthn/browser`,
`uqr` for QR codes. Plain CSS with custom properties (LCH colours with sRGB
fallbacks), system font stack, no web fonts, no third-party scripts, CSP-clean.

Navigation (`PrimaryNav`, one landmark): **People · Devices · Insights ·
Settings**, in the header on wide screens and as a tab bar along the bottom
edge on phones (the same element, restyled); the current item carries
`aria-current="page"` on every address below it. Settings leads to
`/settings`: the list of Settings on phones, its first page beside the list
on wide screens.

| Route | Page |
|---|---|
| `/login`, `/invite/:token`, `/link/:token` | sign-in and sign-up (public) |
| `/s` | a public link; its secret is the fragment, `/s#trls_…` (public) |
| `/` | **People**, the home page: the map with Live, History and Heat, and the people list (signed in) |
| `/devices`, `/devices/:id` | Devices, one device |
| `/insights`, `/insights/transport/:mode`, `/insights/time`, `/insights/roads` | Insights: the overview, a transport mode's page, when you travel, roads |
| `/settings` | Settings: on phones the list with search; on wide screens the first page (Profile) beside the list. An anchor of the single page of 0.2 (`/settings#tokens`, `#browsers`, …) opens its page (`settingsPathFor`) |
| `/settings/profile`, `…/passkeys`, `…/browsers`, `…/sharing`, `…/links`, `…/privacy/viewers`, `…/privacy/access-log`, `…/data`, `…/tokens`, `…/mcp`, `…/preferences`, `…/notifications`, `…/about`, `…/accounts` | a page of Settings each; `…/accounts` for administrators only, everyone else lands on `/settings` |
| `/settings/passkeys/:id`, `…/sharing/:shareId`, `…/links/:id`, `…/tokens/:id`, `…/privacy/viewers/:actor` | the page of one passkey, share, public link, API token or viewer — an actor of the access log, its actor id (§8.8) as base64url |
| `/settings/people` | Accounts' address of 0.3: redirects (replacing the entry) to `/settings/accounts` |
| `/history?…`, `/explore?…` | redirect (replacing the entry) to `/?view=history&…` and `/?view=heat&…`, every parameter kept (`legacyMapPath`) |
| `/people?…` | redirect (replacing the entry) to `/?…`, every parameter kept (`legacyPeoplePath`): People had an address of its own before it took in the map |
| anything else | 404 |

`isSignedInPath` lists the signed-in paths, those of Settings taken from its
tree (it decides whether the session is fetched at startup); the redirects
count among them, since they lead to signed-in pages.

- **People** (`pages/people/PeoplePage`, the home page) — one map and three
  **views** of it, chosen with a switch in the head (Live · History · Heat),
  and beside it (below it on phones) the people: **Me** first, then a card for
  everyone who shares with you. The state is the URL:
  `/?view=live|history|heat&people=me,<userId>,…&devices=<id>,…&date=…` or
  `&from=…&to=…`, plus `level=` (§17.6) and `style=`. Defaults (Live, Me,
  every device, today) are left out of it; an unknown view is Live, unknown
  people and devices are dropped once the lists have loaded, and every
  control changes its own parameter only, so a day chosen in History is still
  there after a look at Heat. Every view keeps its queries and state in a
  hook (`useLiveView`, `useHistoryView`, `useHeatView`, in `pages/map`) that
  asks for nothing while another view is shown, and hands the page what to
  draw: the page has one `TrailMap` for all three, so switching views keeps
  the map — no new canvas, style or tiles. The camera frames what is drawn
  when that changes (another day, other people or devices; Live and History
  on today share it), never merely because the view did; Heat frames it only
  when the page opened on it.

  **Whose data**: the map shows the people chosen, Me alone by default (not
  remembered). **Show on map** on a card makes that person the choice — the
  map then shows them alone — or, for someone on the map already, only moves
  the camera to them; **Show everyone** (a toggle, once two or more people
  share) chooses everyone and, pressed again, Me alone; the person selector
  in the head chooses any mix. The page offers what can be shown of whoever
  is chosen: one's own levels, legend, timeline, corrections, visits, trips
  and Heat exist only while Me is chosen. Without Me they are not there (not
  disabled), since the API has none of them for other people, and an address
  that asks for Heat shows Live until Me is chosen again (`shownView`; the
  address keeps its `view`). A card on the map says "On the map".
  - **Live** — every shown device's latest position (accuracy circle,
    pulsing when live) and today's tracks; in the Me card, device cards:
    status badge (`deviceStatus()`), last upload ("2 min ago", ticking),
    battery, speed / motion, current trip, points today, 48 h activity
    sparkline, the quick toggle of the transport mode (§17.6); and the live
    feed of uploads from SSE. This is the "data still comes in" proof
    screen. The people chosen appear as their initials.
  - **History** — pick a day (prev/next, calendar with days that have data
    from `/api/stats/days`) or a range ≤ 93 days; tracks per device at a
    level (Raw · Averaged · Mapped · Transport, §17.6), stops and moves in
    their modes' colours with a legend; time scrubber showing the position at
    a moment; distance, points, first/last; the timeline of stops and moves,
    with a dialog to correct a mode; visits and trips of the day. Other
    people's tracks as their shares allow (below).
  - **Heat** — all-time heatmap (`/api/heatmap`, refetched as the map moves),
    totals and the busiest places in view. Heatmaps cover one's own devices
    only, so Heat offers no people and says so when some are chosen with Me.

  The head holds the controls the views share, in this order: **people**
  (Me and everyone who shares with me, plus Everyone — a checkbox for all,
  "mixed" while some are chosen — once two or more share; somebody always
  stays chosen), the **device filter** (grouped by person; someone else's
  devices in their colour from `personPalette`), the **map style** (Auto,
  which follows the system's light or dark setting, Light, Dark, and
  Satellite when the server has imagery; remembered in localStorage
  `trail.mapStyle`, else the account's preference, a dark or satellite map
  drawing Trail's lines and dots in their dark-background steps whatever the
  page's scheme), and the tracks' **level** with the mode legend (Live and
  History, with Me). The style and the level resolve in the same order: the
  address (`?style=`, `?level=`) › the choice last made on this browser › the
  account's preference (Settings › Preferences) › Auto and Transport. On
  phones and small tablets they fold into one "Map options" button with a
  one-line summary, so the map stays near the top; beside a full-height map
  (≥ 64rem) the panel scrolls by itself under a sticky title and view switch.

  **The people list** — Find My for Trail (§8.5). The **Me** card: your
  initials in the accent ring, and while Me is on the map what the view has
  of one's own (Live's device cards and uploads), otherwise a line with how
  many devices, how many are live and the last upload, and Show on map. Then
  "Sharing with you": a card per person (`PersonCard`), each as their
  initials in their colour (`personPalette`, a second ring beside the device
  colours, assigned in the order they started sharing): the shared devices,
  how fresh their position is, what they are doing (`describeActivity`,
  which takes the inferred mode when there is one), battery, distance; Show
  on map, Apple Maps and Google Maps links, Share back — or, when you share
  with them, "You share with <name>" and Stop (`StopShareDialog`) — and Hide.
  People you hid are listed under Hidden, to be shown again. A notice says
  who started sharing while the page was open. Last, one's own side: **Share my
  location** (`ShareDialog`): address (with the people who share with you as
  suggestions), devices, precision with plain-language explanations, history
  (precise only), details, duration; a pending address gets "They will see
  you once they sign up and you confirm", an administrator a one-click
  invitation to that address (which skips the confirmation); and a line "You
  share with N people" — with how many signed up and wait for a confirmation
  — that leads to Settings › Sharing, where the outgoing shares are changed,
  stopped and confirmed. `person` and `share` events keep cards, markers and
  the line live.

  **People, as their shares allow** (§8.5): positions come from
  `GET /api/v1/people` (projected by the server) and `person` events; an
  approximate or area position is drawn as a circle of the precision it was
  cut to, never as a track, and the camera frames the whole circle
  (`positionExtent`) rather than its centre, which would pass for an exact
  spot. A track — Live's today, History's period — is asked for
  (`/api/v1/people/{id}/track`, one request per person) only when the share
  is precise with history; everyone else gets a calm note in History instead
  of a request, so no 404 ever reaches the console. Those queries are keyed
  by the share's id and history, so a share that changes (a `share` event
  refetches the people) is never asked for what it allowed before, and they
  are not cached once off screen (`gcTime` 0); `person` events refetch them.
- **Devices** — list; "Add device" flow: name → big QR of `setupUrl` ("scan
  with the iPhone camera, Overland opens with everything filled in"), "Open in
  Overland" button (on the phone itself), manual values with copy buttons,
  recommended Overland settings, then "Waiting for the first upload…" that
  turns into a success state via SSE. Device page: status, ingest log, raw
  points (paginated), remote settings preset, rotate token (re-shows the QR),
  rename, alerts toggle, delete (type the name to confirm).
- **Insights** (`pages/insights/`) — how the signed-in person travelled,
  from the operations of §8.7, on four pages that share a heading, a
  navigation of their own (Overview · When you travel · Roads; a mode's page
  has a way back instead), one row of filters above everything they scope and
  a notice while processing has work in the period ("Processing is still
  catching up"). The state is the URL: `?period=7d|30d|90d|year|all` or
  `?from=…&to=…` (a custom range of local days, three years at most), plus
  `devices=` and, on When you travel and Roads, `mode=`; the default (the
  last 30 days, every device, every mode) is left out, anything that cannot
  be one is dropped (`parseInsightsSearch`), and links between the pages keep
  the period and the devices (`insightsLink`). A new period or mode is a step
  of the history; device toggles replace it. The period's chips and a custom
  range behind the last one (`PeriodPicker`), the device filter of the People
  page when there are two devices or more. Refetching keeps the previous
  numbers on screen, dimmed (`aria-busy`); `segments` events refetch every
  Insights query.
  - **Overview** (`/insights`) — tiles for distance, time on the move, moves,
    stops and active days, each with its change against the period of as
    many days before ("12% more than the 30 days before", "3 fewer than …";
    none for all of the history, nor against a period without moves); the
    distance by mode as one bar per mode in its colour, labelled with the
    distance and share; the distance or time per day, week or month stacked
    by mode in the modes' fixed order, past seven modes the smallest folding
    into "Other modes" (`foldModes`); the table of modes — distance,
    time, moves, average speed, share and change — whose rows open the modes'
    pages; and, once someone but you looked at your data in the last 30
    days, **Who viewed you** (`WhoViewedYouCard`): people, link visitors and
    token calls, who looked most often, and the way to Settings › Who viewed
    you. It follows the access log, not the period of the page.
  - **A mode** (`/insights/transport/:mode`) — tiles (distance, time, moves,
    average and typical speed, the longest move, the top speed), the
    distance over the period as a line, distance or time per hour of the day
    and per weekday, then by mode: the distance by kind of road (walking,
    running, cycling, car, bus), the share on railway track and the halts at
    stations (train, tram, metro), the share on ferry routes (boat), with a
    word when map data is missing or covers only part; the top moves
    (Longest · Fastest · Latest, five each), each with "Show on the map",
    which opens History on the move's local day with its details
    (`/?view=history&date=…&segment=<id>`: `useHistoryView` opens the
    dialog of the segment the address names once the day's timeline has it,
    and closing it drops the parameter); and the moves by median speed as a
    histogram. An unknown mode is a page saying so, asking for nothing.
  - **When you travel** (`/insights/time`) — time on the move in every hour
    of every weekday as a grid, for every mode or the one chosen (the modes
    of the period in a select).
  - **Roads** (`/insights/roads`) — the distance by kind of way and by group
    of ways, for every mode or one, with how much of the distance map data
    covers; a notice where it covers none.

  The charts (`apps/web/src/charts/`, no library): `BarChart` (stacked or
  grouped, columns or horizontal bars; one series may give each row its own
  tone, as the bars per mode do), `LineChart` (up to four lines on one axis,
  a wash under a single one), `Histogram`, `HeatGrid` with its scale legend,
  `StatTiles`/`StatTile`, `Legend` and `ChartTable`; `BarChart`'s `integer`
  keeps an axis of counts to whole steps. Inline SVG drawn at the
  box's real width (a `ResizeObserver`; the viewBox is in CSS pixels, so
  text stays crisp) with fixed heights that include the axes. Marks keep the
  modes' `--mode-*` colours (single-series charts not about a mode take the
  accent; series of other things — who looked, which channel — take the
  categorical slots `--chart-category-1` … `-3` in their fixed order, always
  for the same thing, with "You" muted: the first three of the validated
  categorical palette, light and dark), the grid a neutral sequential ramp (`--heat-0` … `--heat-5`, light
  and dark, monotone in lightness); text never wears a series colour. Bars
  are at most 24 px thick with a rounded data end, touching fills are
  separated by a 2 px surface gap, lines are 2 px, gridlines solid
  hairlines; ticks are round and thinned so labels never collide, at 320 px
  too. Every chart is a figure named by its visible title and described by
  its visible one-line summary (`describeBars`, `describeExtremes`, or the
  page's own words); it is not an image as a whole, since its marks are
  focusable, which a role with presentational children would hide from
  assistive technology: the SVG is a group of marks, each an image named by
  its row (a day, an hour, a mode, a cell "Monday, 08:00–09:00") and
  described by its values ("Car 12.3 km, Train 30 km, total 42.3 km"). The
  marks are one tab stop: arrow keys, Home and End move between them (in two
  dimensions on the grid, Ctrl+Home/End to its corners), Escape hides the
  tooltip. One tooltip per chart, for the hovered, tapped or focused mark —
  the whole band or cell is the target, values first, then their names with
  a line key of their colour — never the only way to a number: every chart
  has its numbers as a table in a disclosure ("Show the numbers"). Legends
  for two or more series. Forced colours: marks in system colours, series
  told apart by line textures at 45° and 135° that the legend repeats, focus
  in `Highlight`; nothing in the charts moves, and the dimming on refetch
  only fades without `prefers-reduced-motion: reduce`.
- **Settings** — a tree of pages in the style of the iPhone's Settings app
  (`apps/web/src/settings/`). The tree is data (`settingsTree.ts`): the
  groups Account · Privacy & data · Developer · App · Admin, and each row's
  id, path, label, icon and tile colour, keywords for search, `adminOnly`,
  the parts of its page that search lists on their own (with their heading's
  id) and the pages of its items (`/settings/tokens/:tokenId`). The routes
  (`settingsRoutes.tsx`, a chunk per page), `isSignedInPath`, the old anchors
  (`settingsPathFor`, own keys only) and the search index are built from it.
  `useSettingsTree` adds what the person sees: the administrators' group for
  administrators only, and the value on the right of a row from the lists
  the pages load anyway (one cache) — the display name; the number of
  passkeys, browsers, people shared with, working links ("3 active") and
  active tokens; how many people, links and tokens looked in the last 30
  days (the summary Who viewed you and Insights' card load too); whether
  alerts are on; the version.

  The frame (`SettingsShell`): on phones (below 64rem) the list — the search
  field, then the groups as inset cards of rows — is the page at `/settings`,
  and every other page has the screen to itself under a bar with the way back
  and the page's title, which starts large and moves into the bar once it
  scrolls under it; going deeper slides the new page in from the right,
  coming back from the left, with no motion under `prefers-reduced-motion`.
  On wide screens the list stands beside the page (as in the Mac's System
  Settings), marks the row of the page on screen (`aria-current`), scrolls by
  itself and keeps its search while pages change; `/settings` opens the first
  page there. The components: `SettingsGroup` (a titled card of rows, of
  label/value facts or of a form, with small print below; a list is named by
  its title), `SettingsRow` (an icon tile, the label, a second line and the
  value, then a chevron — or a switch, a choice, an action, an arrow for a
  page outside the app; a row's link is named by its label and described by
  the rest), `SettingsPage` (a region named by its h1, the bar, the title and
  description) and `SettingsSearch`. Every page has the document title
  "<page> · Settings" ("<item> · <page> · Settings" one level deeper) and
  takes focus when it opens; coming back up, focus returns to the row of the
  page that was left, and an address with `#part` focuses that part's
  heading. The way back goes back in the history when the page was opened
  from the one above it (a row puts its address in the location's state),
  so Back and Forward keep making sense; opened from a bookmark it goes to
  the page above. Search folds case, accents and punctuation, finds rows by
  label and keywords (every word of the query, anywhere; the best label
  matches first) and shows each with where it is ("Privacy & data › Your
  data"); Enter opens the first.

  The pages: **Profile** (name, time zone); **Passkeys** (the list, adding
  one here, a one-time link with a QR code for another device or address)
  and a passkey's page (where it is kept, synced or not, its address, added,
  last used; rename, delete — never the last); **Browsers** (the signed-in
  browsers; sign out one, or all but this one); **Sharing** (the people you
  share with, Share my location) and a share's page (devices, precision,
  history, details, end, last look; change it, confirm someone who signed up
  with its address, stop); **Public links** (the list; making one in a
  dialog) and a link's page (what it shows, until when, its views; turn it
  off after a confirmation, or remove an ended one) — right after a link is
  made its page shows the address and its QR code, once: the secret exists
  only in the answer to making it (the server keeps a hash), and the page
  holds it in memory, never in the history's state, until it is left;
  **Who viewed you**, its pages of each viewer and **Access log** (below);
  **Your data** (export, delete a
  period, delete the account); **API tokens** (the list, creating one) and a
  token's page (status, hint, template, devices, addresses, lifetime, last
  use, its use, its scopes with what each allows; roll, revoke — renaming it
  or changing its scopes and devices is in the API, `PATCH
  /api/me/tokens/:id`, not on the page yet); **MCP** (the steps of
  docs/mcp.md — a token from the Agent template, whose form a button opens,
  the server address, the header, a client configuration — and the guide);
  **API reference** (`/docs`, outside the app); **Preferences**;
  **Notifications** (whether the server sends alerts through ntfy, and a
  switch per device); **About** (version, commit, build time, receiver
  endpoint, and Sign out — the place for it on phones); **Accounts**
  (administrators: invite someone, invitations, the accounts on the server).
  An item that does not exist gets a page that says so.

  **The access log's pages** (`apps/web/src/accessLog/`, from §8.8 with the
  session):
  - **Who viewed you** (`/settings/privacy/viewers?days=7|30|90`, 30 by
    default, a step of the history): tiles — people, link visitors, API
    calls, MCP calls and, with your own activity, yours —, the accesses per
    day stacked by who, and a row per person, link, token and (with your own
    activity) browser, each leading to its page. A person's row is a
    sentence from their actions (`viewerSentence`): "Ana looked at your live
    position 14 times and your history twice, last on Tuesday at 18:03" —
    position for `listPeople` and `getPerson`, history for
    `getPersonTrack`, live updates (`live.position`) apart; once, twice,
    *n* times; the day as the formatter's `onDay` (today, yesterday, a
    weekday within the week, else the date). A link's says its views and
    distinct visitors, a token's its API and MCP calls apart.
  - **A viewer** (`/settings/privacy/viewers/:actor`, the period kept): the
    actor id (`person:<userId>`, `token:<tokenId>`, `link:<linkId>`,
    `session:<browser>`; `dataAccessActorId` in the contracts) as one
    base64url segment (`actorAddress.ts`: only it makes and reads the
    segment, so the address holds no name to escape, and one that names no
    actor shows a page saying so). It shows the summary of that actor (its
    sentence and the accesses per day by channel: looks and live updates,
    views, API and MCP), then hour by hour its lines with what each read,
    and the way to the person's share, the link's or the token's page.
  - **Access log** (`/settings/privacy/access-log`): the lines, newest
    first, a card per local day (within an hour the last access first),
    each line a disclosure that opens to who, the channel, the action (in
    words and by its name), when, how often, the devices by name (a deleted
    one as such, and only once the list has come), the period, level,
    precision, mode, format, history and the share, link or token it named,
    the answer, and the way to its viewer's page; a line that counts
    what is not listed one by one (`folded`, a link's other visitors) reads
    "… and 37 more". The filters — who, channel, period (today, 7, 30 or 90
    local days, or everything kept) and action (looks at you, downloads,
    changes of who may see you and of your data) — are the address
    (`?actor=&channel=&days=&action=`, `parseAccessLogSearch`), each in a
    select, two columns on a phone; a period starts with the first hour
    that starts on its first local day, as the summary counts it. Pages of
    50 follow the keyset cursor (`useAccessLog`, an infinite query): with
    **Load more**, which keeps its focus while it loads (it is never
    disabled), says how many lines came and, after the last page, hands
    its focus to the line that says so; and by themselves as the end of
    the list comes into view (an `IntersectionObserver`, set up again
    after each page so a short one brings the next; never twice at once).
    Empty, filtered-empty and error states; what is recorded, with the
    sharing and API guides.
  - Both pages and the viewer's leave your own sessions out
    (`actor=person,link,token`) unless `showOwnActivity` is on; both have
    its switch, which saves the preference as Preferences does (shown at
    once, put back if the save fails).
  - **Use on the pages of a token, a link and a share** (the last 30 days,
    the summary of that actor): a token's calls per day, API and MCP
    stacked, and its last five actions; a link's views, distinct visitors
    and last view as tiles, and its views per day; what the person of a
    share looked at (every share of theirs), as their sentence and a bar per
    kind of look. Each leads to the viewer's page; every chart has its table
    of numbers. A share changing refetches the log (`invalidateSharing`):
    it records the change, and names people only while a share is in force.

  **Preferences** (§8): the map style (Auto · Light · Dark, and Satellite
  where the server has imagery), the level of the tracks, and whether Who
  viewed you and the access log count your own activity (their switch
  changes it too). A change is saved at once (a choice, a
  switch), announced, and shown before the answer arrives (the session in
  the cache, put back if the save fails); changes go out one after another.
  Saving the map style or the level forgets this browser's own choice of it,
  so the browser follows the account again. A public link's page has no
  session and uses the built-in defaults.
- **Public link** (`/s#<secret>`) — no session, no navigation: the label, a map
  of the shared devices (with the route for history links), how fresh each
  position is, details when included, the expiry, a refresh every 15 s, and a
  friendly page for a link that ended or does not exist.
- **Login** — one email field (`autocomplete="username webauthn"`) + Continue
  (unified start), conditional UI running in the background, "Use a passkey"
  button; clear states for not invited, no passkey for this address,
  cancelled, unsupported browser.

Quality bar: responsive from 320 px (phone-first, bottom tab bar on phones,
safe-area insets), keyboard and screen-reader accessible (landmarks, focus
management on navigation, labelled controls, text alternatives for map-only
information, scrolling panels and wide tables reachable by keyboard while
they scroll), 44 px targets, WCAG AAA text contrast where feasible, dark mode,
`prefers-contrast: more`, `forced-colors`, `prefers-reduced-motion`. The
map chunk is lazy-loaded. PWA manifest + icons (home-screen app on iPhone).

## 15. CI/CD

`.github/workflows/ci.yml` (push to `main`, `v*` tags, pull requests, Monday
03:00 UTC schedule, manual): `quality` (biome, typecheck, knip, unit tests
with coverage via `npm run test --workspaces --if-present -- --coverage`,
because the root `test` script would swallow the flag) → `integration` (API
tests against a `postgres:18-alpine` service, `TEST_DATABASE_URL` →
`trail_test`) → `e2e` (Playwright container whose tag comes from the locked
`@playwright/test` version, Chromium virtual authenticator, Postgres service
reachable as `postgres`, `E2E_DATABASE_URL` → `trail_e2e`, `npm run build` then `npm run test:e2e`;
the report is uploaded on failure) → `image` (buildx multi-arch with the GHA
cache; pushes to GHCR only from `main` — pushes, schedule, manual runs — and
`v*` tags; builds without pushing on PRs). Beside them, `changes` →
`devcontainer` builds the development container's image (§3) with Buildx and
a GHA cache scope of its own, neither pushed nor loaded, for pushes and pull
requests that change `.devcontainer/`, `package-lock.json` or `ci.yml`
(`changes` diffs a pull request's merge commit with its base, a push with the
branch's previous commit, a new branch with `main`); it is not a required
check. Actions pinned by commit SHA; per-job least-privilege permissions
(`packages`, `id-token`, `attestations` write only in `image`). Dependabot
(weekly, Monday 07:00 Europe/Brussels) for npm, GitHub Actions, the
Dockerfile digests (the image's and the development container's) and the
compose files, `.devcontainer/` included (only major tags change there;
majors never auto-merge). The npm groups: `security`
(`applies-to: security-updates`, every package; GitHub Actions has one too),
`biome` and `typescript` alone, the families (`vitest`, `playwright`,
`react`, …) and the catch-all `minor-and-patch` with the pattern `*`:
Dependabot gives a dependency to the group whose pattern names it most
precisely, and a group without patterns would take every dependency.
`dependabot-auto-merge.yml` enables auto-merge, which lands on green CI once
branch protection requires the checks, for minor, patch and digest updates,
the `security` groups' included, except the `biome` and `typescript` groups,
which are merged by hand; majors wait for a person, security ones too.

## 16. Testing

- `packages/contracts/tests` — schema and helper unit tests.
- `apps/api/tests/unit` — pure logic (Overland normalisation, timestamps,
  RDP, distance, tile math, token hashing, config parsing, presets, share
  durations across DST and skipped midnights, the sharing grids — one per
  owner, fixed, within the cell around the position, area cells made of whole
  approximate cells, whole at the antimeridian, and a property test that no
  number of an owner's devices, shares and links narrows a position below one
  approximate cell — and the sharing access rules), the v1
  route registry (`defineRoute`: path conversion, validation, scopes,
  response schemas, handler types), principals, the `/docs` router (the
  bundle read at startup, revalidations), and the OpenAPI document:
  validated against the OpenAPI 3.1 schema and compared with
  `__snapshots__/openapi.json` (the guide aside); after an API change,
  `npm test -w @trail/api -- -u` rewrites the snapshot for review. The
  processing stages run on a hand-made world (`tests/support/syntheticWorld.ts`:
  a curving railway with stations and a halt, a motorway, street grids with a
  main road and bus stops, a cycleway, a footpath, a tram line in a street, a
  subway and a ferry) with journeys recorded through it (`journeys.ts`: a
  dense walk, a drive, a bus, a bike ride, a train every 3 to 5 minutes, walk
  → train → walk, a tram, a ferry, a flight, a phone on a desk); a benchmark
  holds a dense day of 21 000 points to its CPU budget, and `wayKinds.test.ts`
  puts every journey on its kinds of way (adding up to the whole and, by
  family, to the family shares). Insights' pure parts
  (`insightsCalendar.test.ts`, `insightsAggregation.test.ts`): the local hours
  of a period across both changes of the clocks, in zones half an hour off
  UTC and in one that skips midnight; moves prorated over them at local
  midnight, at the period's edges and on the night of 25 hours; periods left
  open or too long, the period before, the steps and their names; totals,
  modes, shares and deltas; a mode's hours, weekdays, kinds of way, rail
  share, halts, typical speed, top moves and speed bins; the road shares
  scaled from rounded ones; the 7 × 24 grid. `mcpServer.test.ts`
  covers the MCP server's pure parts (names made safe, times with the zone's
  offset, the nearest point, ranges and caps, the Origin rule, the
  instructions, the tool runner's refusals, failures, schema check and log
  line) and `tools/list` for every scope over the SDK's in-memory transport.
  `dataAccess.test.ts` holds the data access log's pure parts: the recorder
  on an in-memory store (one row per hour and access, canonical resources,
  the write after two seconds or at 500 rows, statements of 500, retries and
  their limit, a refused row left out alone, malformed ids, the memory
  limit, folding per actor and action and per link's visitors, the hour
  resetting the limits, no recipient credentials, cleaned names), the dedupe
  key, networks of IPv4, IPv6, mapped and zoned addresses (and a property
  test that the network always holds its address and nothing finer), the
  kinds of browser, visitor keys (stable, per owner, made of the coarse
  values only, useless without the server's key), resources from validated
  input (never a viewport or a name), and that every v1 path with an `{id}`
  names what it stands for; `defineRoute.test.ts` and `mcpServer.test.ts`
  what the route registry and the tool runner record, and when not.
- `apps/api/tests/integration` — supertest against the real app and the
  `trail_test` database (`TEST_DATABASE_URL`), including passkey ceremonies
  with a software authenticator (ES256, `none` attestation, CBOR via
  `@levischuck/tiny-cbor`). `migrationUpgrade.test.ts` builds the schema of the
  first release, records data with it, applies every later migration and
  requires every row unchanged — deployed databases are only ever migrated.
  The v1 tests run the routes with a session and, through a fake
  `ApiTokenVerifier`, with tokens (scopes, device restrictions, expired,
  revoked and address-bound tokens, rate limits), check CORS, CSRF and the
  JSON 404, that the mounted routes and the document list the same
  operations, and the `/docs` page's headers and scripts. `apiTokens.test.ts`
  drives the token store through the real app (create, validate, change,
  roll, revoke, expiry, allowlists, last use, the limit of 50 with parallel
  requests, device deletion, pruning, account deletion, the audit log, CSRF
  and session-only management); `apiV1Operations.test.ts` calls every v1
  operation of the token branch with real tokens: the same answers as the
  dashboard's routes, scopes, device restrictions and other accounts' ids.
  Processing is tested in the real app with map tiles cut from the hand-made
  world by a `FixtureWaySource` (no network): uploads to segments and the
  `segments` event, every level and its degradation, windows waiting for map
  data, old tiles fetched again, a window worked out the same in many pieces
  of map data as in one, ready times by the worker's clock, a deleted range
  repaired, the backfill across a restart, the v1 routes with sessions and
  tokens, `trail reprocess`, and a log that names tiles only at debug level.
  The MCP server is driven by the SDK's own client over Streamable HTTP
  (`tests/support/mcpClient.ts`), in both protocol eras: `mcp.test.ts` the
  transport (JSON answers, tools/list per scope, the unknown-tool answer,
  bearer only, refused and expired tokens, a session cookie refused, the
  Origin rule before the lookup, preflight, 405/415/413/400, `listen`
  let go, one rate-limit budget with `/api/v1`, the log line);
  `mcpTools.test.ts` every tool and resource on processed journeys,
  device-limited tokens, the 31-day and 500-item caps, `set_transport_mode`
  with source `mcp`, `get_people` at each sharer's precision (no exact
  position, details or distance where not granted, no addresses or ids,
  hidden and stopped shares left out), the read-only transaction and its
  timeout, and a device and a sharer named to instruct the agent.
  `insightsApi.test.ts` runs the four Insights operations on processed
  journeys (with map data, so the kinds of way are there): totals against
  the timeline, no coordinate anywhere in an answer, the period left out,
  empty and pending periods, the three-year cap, an unknown mode, scopes
  (`history:read`), a token limited to some devices, other people's devices
  and their own data, and segments written at exact times across local
  midnight and the night summer time ends.
  The migration-upgrade test also records rows in the user-data tables that
  later migrations add (`api_tokens`, `mode_overrides`, `shares`,
  `share_links`, `hidden_people` and the grid key of sharing, and
  `data_access_events` with its visitor key), each with the
  migration that adds it, and requires every column unchanged after every
  migration that follows. The sharing tests play owner, recipient and
  stranger on every people, shares and links route: stopped, ended and hidden
  shares vanish at once from reads and live events, coarse shares never carry
  the precise position (reads, events, the public endpoint), history never
  reaches before its window, pending shares bind at sign-up only with an
  invitation to their address and otherwise wait for the owner's
  confirmation (also when a share and the sign-up happen at the same moment),
  hiding a person holds for their later shares, limits, scopes
  (`locations:read` for anything that can show positions) and device-limited
  tokens, the public endpoint's 404s, headers, view counting and rate limit,
  and the access log. The data access log is driven through the real app:
  `dataAccessRecording.test.ts` channel by channel — the owner's dashboard
  reads and v1 calls with the session, a token's v1 calls, MCP tools and a
  resource by an agent's token (a device asked for by name kept as its id),
  a recipient looking with their session, their token and their agent (one
  person, no credentials of theirs), live positions over SSE, two visitors of
  a public link from IPv4 and IPv6 (and one with an unreadable address), the
  writes (modes, a deleted period and device, tokens, shares, links), what
  is never recorded (the device list, configuration, health, `tokens/verify`,
  the OpenAPI document, refusals and failures), and a scan of every row for
  coordinates, secrets and addresses; `dataAccessLog.test.ts` the list and
  the summary — order, filters, keyset pages that hold still while a row is
  counted again, `audit:read` (Read-only yes, Agent no), refused to a token
  limited to some devices, nothing for another account or an administrator,
  one actor (`actorId`: a person, a token, a link and a browser, in the
  list with its pages and in the summary, refused when it is not one), the
  series by channel adding up, current
  and remembered names, the retention, the account's deletion and the
  shutdown's last write. The migration-upgrade test fingerprints its rows and
  the visitor key.
- `apps/web/tests` — Vitest + Testing Library (jsdom). Pages render through
  `renderPage` with the API answered by `mockApi` and the map replaced by a
  stub that shows what it was handed; the People page's tests also check
  that switching views keeps that one map, that a view not shown asks for
  nothing, and that with someone else chosen alone nothing of one's own is
  offered or asked for. The page's URL (`parseMapSearch`, the updates in
  `mapSearchUpdates`, `resolveMapSelection`, `viewsFor` and `shownView`), the
  selection of a card (`selectionShowing`, `everyoneToggled`), the line about
  one's own sharing (`sharingSummary`), the old addresses (`legacyMapPath`,
  `legacyPeoplePath`, and the redirects through the app's own route table),
  Settings' tree (groups, paths, levels, administrators' rows), its search
  index and row values, the old anchors (`settingsPathFor`),
  `isSignedInPath` and the precedence of the map's defaults have unit tests
  of their own; Settings itself renders through its real routes
  (`renderSettings`, phone or wide screen) for the list, search, going
  deeper and back with focus, and every page. The charts' helpers (scales,
  nice ticks, bands, tick thinning, the heat grid's bins, summaries, tooltip
  placement) and components (named and described figures, marks with their
  values as descriptions, one tab stop and the arrow keys, tooltips by
  pointer, focus and Escape, tables, empty charts without NaN, a row's own
  tone); Insights' address (`parseInsightsSearch` and the parameters it
  changes), its words (changes against the period before, ticks, the steps'
  names, folding modes) and its four pages against a mocked API (periods and
  devices in the address and the requests, a custom range, the
  processing notice, a mode's link to the map, the mode switch, a page
  without map data); a link to one move opening its dialog on the People
  page; and the access log's pages (`accessLogHelpers.test.ts`: actor ids
  and their segments, the sentences and their plurals, the filters and the
  request they make, lines by local day across pages, folded lines, what a
  line says and the names it shows; `AccessLogPages.test.tsx`: Who viewed
  you with and without one's own activity and its switch saving the
  preference, a period in the address, a viewer's page with its lines,
  the access log's filters, Load more with the cursor, empty and error
  states, the use on a token's, link's and share's page, Insights' card).
- `tests/e2e` — Playwright against the built stack. `playwright.config.ts`
  starts `scripts/e2e-server.mjs`: it empties the `trail_e2e` database
  (`E2E_DATABASE_URL`; any database not named `trail…e2e` is refused) and runs
  the built `apps/api/dist/main.mjs` on port 4190 in production mode with the
  whole API environment set (raised rate limits). `E2E_BASE_URL` runs the same
  suite against a deployment that is already up, e.g. the Docker stack. Projects:
  desktop Chromium and an iPhone-sized Chromium (the CDP virtual authenticator
  holds the passkeys), plus WebKit for the signed-out pages where the port
  allows (WebKit refuses 4190). A setup project signs up the first account
  (the admin) for the invitation tests. Every test fails on a console error,
  an uncaught exception or a CSP violation; map styles are stubbed (the
  suite's server has satellite imagery from a host of its own, whose tiles
  the stub answers, so the CSP's map origins are checked too), other
  third-party requests refused. The Overland fixture is shifted to today.
  Scenarios: sign-up and refusal, device setup and the live upload, ingest log
  and raw points, remote settings, token rotation, History and its scrubber,
  the heatmap, sign-in by email, passkey button and autofill, invitations and
  isolation, passkeys and passkey links, sessions, export, deleting a period
  and the account, Overland's protocol, static files and headers, the API
  reference at `/docs` and the OpenAPI document, API tokens (create one in
  Settings, read the secret from the one-time screen, call
  `/api/v1/tokens/verify` with it, roll, revoke and see the old secrets
  refused; devices and an expiry date), the levels of the tracks and
  correcting a move's mode, the quick toggle, sharing between two accounts
  in two browsers (Share my location from the home page, live updates,
  hiding, stopping in Settings › Sharing) and public links (opened signed
  out, turned off, too short, unknown), the People page's map (its three
  views on one map, Back through them, the old addresses and deep links, the
  device filter across views, the map style — Auto following the system, a
  remembered choice, satellite imagery), the People page's people (three
  accounts: Me first, a card per person; someone who shares roughly and live
  only, chosen alone, shows where they are and nothing of one's own — no
  Heat, levels, timeline, visits or trips — and their history is never asked
  for; someone who shares their history shows their track, until their share
  changes; Me again brings everything back; Show everyone; a card kept live
  by an upload; sharing back and stopping from a card; a deep link to
  someone alone), Settings (the list with its values and search, on phones a
  page of its own and beside the page on wide screens, every page and the
  page of each kind of item, going deeper and back by address and through
  the history, the old anchors and addresses, the preferences the map opens
  with, the administrators' page), the navigation (a tab bar on phones, the
  current item, focus on the new page's heading, `/people` leading home with
  its parameters), Insights (a walk and a drive worked out by the server
  without map data: the overview and its numbers, another period in the
  address, a chart by keyboard — one tab stop, arrow keys, the tooltip and
  Escape —, a mode's page from the table and its link to the move on the
  map, when you travel with a mode, roads without map data, and every page
  at 320 px), the access log with what the server really recorded
  (`accessLog.spec.ts`: someone with a precise share and history reads your
  track in their browser and is under People with the sentence the summary's
  numbers make, on their page hour by hour and on the share's page; a public
  link opened twice in a fresh browser is one visitor and two views, on the
  link's page too; a token's two API calls and one MCP tool, counted apart,
  with its last actions; your own browsing out of the log until the switch
  shows it and saves the preference; the filters in the address and Load
  more; the pages at 320 px), axe (WCAG 2.0 A–AAA, 2.1/2.2 AA, best practices) on every
  view and page, keyboard use and 320 px screens. The suite's server
  has no map data (`PROCESSING_OVERPASS_URL` empty), so the mapped level
  degrades to averaged there.

## 17. Processing and transport inference

Trail works out how a device travelled from the recorded points, in four
levels of calculation, each built on the one before. Recorded data is never
changed: everything below is derived, carries the version of its level's
algorithms (`processingVersions` in `apps/api/src/processing/processingVersion.ts`:
a level's version counts the changes to it and to the levels below it, so a
change bumps its own level and every level above) and can be rebuilt with
`trail reprocess`. The stages are pure functions over plain
arrays in `apps/api/src/processing/` (`averagePoints`, `detectStops`,
`matchToWays`, `extractFeatures`, `scoreModes`, `splitMove`, `applyOverrides`,
composed by `planWindow`, `mapPiece` per piece of map data and `inferWindow`);
thin adapters read and write the database around them. Every threshold is in one typed object,
`ProcessingConfig` (`processingConfig.ts`), and `segments.features` keeps what
each move was judged on, so a change can be evaluated against the stored
segments and the corrections people made.

### 17.1 Levels

| Level | Meaning | Lives in |
|---|---|---|
| `raw` | the points as received | `locations` |
| `averaged` | outliers dropped, GPS noise smoothed | `processed_points.kept`, `lat_avg`, `lon_avg`, `speed_avg` |
| `mapped` | averaged points snapped to OpenStreetMap roads and railways, with the way's shape between consecutive points | `processed_points.lat_map`, `lon_map`, `way_id`, `way_kind`, `snap_m`, `path_map` |
| `inferred` | stops and moves; every move with a transport mode and a confidence, the person's corrections applied | `segments` |

A point that has not reached a level is served at the best one below it
(`GET /api/v1/tracks` says which in `availableLevel`): not processed yet →
raw; no map data → averaged. Without map data at all
(`PROCESSING_OVERPASS_URL` empty) the inference still runs, on averaged
points and without map evidence.

Modes: `stationary`, `walking`, `running`, `cycling`, `car`, `bus`, `tram`,
`metro`, `train`, `boat`, `plane`, `unknown` (contracts `transport.ts`).

### 17.2 Tables

- **processed_points** — PK `(device_id, recorded_at)`, foreign key to
  `locations` with `ON DELETE CASCADE`: deleting points deletes their rows.
  `kept`, `lat_avg`, `lon_avg`, `speed_avg`, `lat_map`/`lon_map` (null: not
  mapped), `way_id`, `way_kind` (null for stop points, `other` off every
  way), `snap_m`, `path_map` (jsonb `[[lon, lat], …]`: the way's shape since
  the move's previous point, both ends excluded), `version` (the mapped
  level's: the row holds the averaged and mapped levels), `processed_at`.
- **segments** — `id` (uuidv7, kept while a segment keeps its start),
  `device_id` → devices (cascade), `started_at`, `ended_at`, `kind`
  `stop|move`, `mode` (the one that counts: `mode_user`, else
  `mode_inferred`; null for stops), `mode_inferred`, `mode_user`,
  `confidence`, `review` (the inference was unsure; `needsReview` = review and
  no `mode_user`), `distance_m`, `duration_s`, `max_speed`, `point_count`,
  start, end and centroid lat/lon, `features` (jsonb), `version` (the
  inferred level's), `computed_at`. Unique `(device_id, started_at)`, index
  `(device_id, ended_at)`. Stops and moves follow each other without overlap
  and share their boundary point; a recording gap without travel lies outside
  every segment.
- **mode_overrides** — user data, part of the migration-upgrade fingerprint:
  `id`, `device_id` (cascade), `kind` `segment|toggle`, `from_at`, `to_at`
  (null: until the next stop), `mode`, `source` `ui|api|mcp`, `created_by`
  (set null), `created_at`, `revoked_at` (rows are kept).
- **processing_queue** — PK `(device_id, from_at)`: `to_at`, `reason`,
  `from_level` `averaged|mapped|inferred`, `priority` (0 new data, 1
  backfill), `attempts`, `next_at`, `enqueued_at` (the version a finished pass
  compares against), `missing_tiles` (jsonb `["z/x/y", …]`: the window waits
  for map data), `last_error`.
- Map cache: **osm_tiles** PK `(z, x, y)` with `status` `ok|failed`,
  `fetched_at`, `way_count`, `poi_count`, `bytes`, `failures`, `retry_at`;
  **osm_ways** (`id` = OSM way id, `kind`, the kept `tags`, `nodes` bigint[],
  `geometry` jsonb `[[lon, lat], …]`, bounding box, `fetched_at`);
  **osm_tile_ways** `(z, x, y, way_id)`; **osm_pois** (`id` `n…|w…|r…`,
  `kind` `station|halt|tram_stop|subway_station|bus_stop|ferry_terminal|aerodrome`,
  `lat`, `lon`, `name`, the tile it came with).
- **processing_state** — key/value: `backfill` holds the versions the history
  was backfilled for, `{ "versions": { "averaged": 1, "mapped": 1, "inferred": 2 } }`
  (`{ "version": n }`, from before the levels had versions of their own, means
  n for every level).

### 17.3 Algorithms

**Averaged** (`averagePoints`), per device in time order:

1. Points with an accuracy above `PROCESSING_MAX_ACCURACY_M` (150 m) are
   dropped, and so are spikes: a run of up to three points that the phone
   cannot have reached from the point before it nor left for the point after
   it (> 90 m/s), while those two agree with each other (≤ 90 m/s). The
   agreement test keeps a flight, whose points all imply more than 90 m/s.
2. Consecutive points within max(accuracy, 25 m) of the running centroid at
   ≤ 0.5 m/s (the reported speed, else the derived one less the accuracies)
   form a stationary cluster and collapse to its 1/accuracy²-weighted centroid.
3. A moving point becomes the 1/accuracy²-weighted mean of itself and its
   moving neighbours within ±20 s — at most three on each side, and only those
   within two accuracies (at least 10 m) of it. Noise is smoothed where it
   dominates (slow, inaccurate) and corners at speed survive; sparse points
   have no neighbours that close and stay exactly as they are.
4. `speed_avg` is the median of the reported speed and the derived speeds to
   both neighbours.

**Stops and moves** (`detectStops`): a stop is at least
`PROCESSING_STOP_MIN_S` (180 s) within 60 m of its running centroid (moving
points at its edges trimmed), the points of an iOS visit within 150 m of its
place (unless most of them disagree), or CoreMotion reporting stationary and
nothing else throughout. Stops at one place on both sides of a recording
pause, or within 80 m with at most five minutes of wandering between them,
are one stop. After a pause of five minutes or more the stop lasts until the
first point outside it when that point is within 300 m (iOS resumes outside
its geofence). Moves fill the time between stops and share their end points
with them. A gap of more than 30 minutes ends a move unless the device
travelled at 10 m/s or more meanwhile (a flight, a train through tunnels).

**Mapped** (`matchToWays`), per move (stops are not matched): a hidden Markov
model over the ways near each point, solved with Viterbi.

- Map data comes in z14 tiles: the candidate radius around every point, a
  corridor of min(1 km, 10 % of the distance) on each side of the straight
  line between points far apart (unless covering that distance took more
  than 100 m/s), and 300 m around both ends (stations). A move is mapped
  only when all its tiles are there.
- A flight — a move whose time-weighted median speed between points is over
  100 m/s (high-speed trains stay below 90) — needs no map data: its points
  stay where averaging put them, off the network.
- The map data is loaded a piece at a time (`planPieces`), so a long window
  never holds all of it: moves go together while their tiles stay within
  256; a move that needs more is cut into stretches of about 256 tiles, each
  matched with 1.5 km of the move beyond its ends and keeping only its own
  points, so the seams fall where the whole move would have matched (the
  tests compare both). The way samples of the features are taken stretch by
  stretch as well; only the stops near the move are kept to the end.
- Points enter the model 30 m apart; the ones between are placed on the
  matched line afterwards, never behind the point before them.
- Candidates: the nearest point of each way within clamp(1.5 × accuracy,
  25 m, 120 m), at most four, plus "off the network". Emission cost
  ½(d/σ)², σ = max(accuracy, 10 m); off the network 2.5.
- Transitions route along the network of the candidate's class — rail
  (`rail`, `light_rail`, `subway`), tram, street (roads and paths) or ferry —
  with a bounded Dijkstra over the cached ways' shared nodes: within
  min(25 km, 2 × chord + 300 m) and 40 way changes. Cost
  |route − chord| / max(25 m, 0.15 × chord), plus 0.3 for another way of the
  same network; no route (another class, out of reach) costs 8, leaving or
  joining the network 1.
- The result gives each point its place, its way and the way's shape since
  the previous point: the rails between two train points minutes apart, not
  a straight cut across the fields.

Map data comes through a `WaySource` (`fetchTile(tile, signal)`). The
default `OverpassWaySource` posts one query per tile to
`PROCESSING_OVERPASS_URL` (default `https://overpass-api.de/api/interpreter`;
empty switches mapping off): every `highway=*` except
proposed/construction/abandoned/razed/disused/planned, the railways
`rail|light_rail|tram|subway|narrow_gauge|funicular`, `route=ferry` (with
`out body geom`), and the stations, halts, tram stops, bus stops, ferry
terminals and aerodromes (`out body center`). It sends one request at a time
and at most one every 2 s, with a 60 s timeout, `User-Agent: Trail/<version>
(+https://github.com/JensPenneman/trail)` (the project, never the instance)
and no redirects; 429, 5xx and network errors are retried
three times with backoff (Retry-After honoured); answers over 20 MB are cut
off and refused; parsing is strict (a malformed element, mismatched nodes and
shape, or a `remark` about a runtime error refuses the whole tile). The
`TileFetcher` fetches the tiles waiting windows list, within
`PROCESSING_OVERPASS_DAILY_MB` (300) per UTC day, and makes a window ready as
soon as its tiles are all there. A failed tile is tried again after 10
minutes, four times longer each time, at most a day later. A cached tile older
than `PROCESSING_OSM_TTL_DAYS` (90) keeps serving and is fetched again when a
window needs it: the window waits for it and is worked out again once it is
fresh (a failed refresh keeps the old data). A self-hosted extract can
implement the same interface.

**Features** of a move (`moveSeries`, `extractFeatures`), from its intervals:
time-weighted median, p85 and p98 (top) speed — the points' own speeds for
intervals up to 30 s, distance along the track over time beyond that — the
average speed, the acceleration variance of dense intervals, the shares of the
distance by matched way family (rail, subway, tram, motorway, road, cycleway,
foot, ferry, none) and by way kind (`wayKinds`: every kind, a matched point
without one counting as `other`; summed by family they give the family
shares), and near tram tracks, cycleways and footways (they run beside
roads), the corridor ratio (samples every 250 m along the straight
lines between points within 200 m of a railway, and of a motorway), pauses
inside the move (≤ 1 m/s for ≥ 15 s, or one slow reading between long
intervals) near stations and halts (300 m), tram stops (60 m), metro stations
(250 m), bus stops (40 m), ferry terminals (300 m) and airports (3 km), the
stops at both ends near them, the bus and tram stops passed within 25 m, the
CoreMotion time shares, the mode of an Overland trip covering half the move,
the highest altitude and fastest climb, the duration, the distance and the
extent.

**Scores** (`scoreModes`, `ScoringThresholds`): a sum of evidence per mode
from ramps over the named thresholds, for example train = 3.2 × rail evidence
(matched share or corridor ratio from 0.4 to 0.7) × speed (p85 from 40 to
70 km/h) × max(0.35, station stops, no road overlap); bus = speed band (12–18
… 55–70 km/h) × (2.6 × bus-stop evidence (pauses at bus stops, and at most of
the stops passed) + 0.3 × road share); car = (speed + CoreMotion automotive +
road and motorway shares), damped off roads, by bus or tram stop pauses, by
rails and above 170 km/h; tram = tram share × (1.2 + 1.6 × tram-stop
evidence); cycling = CoreMotion cycling, or 11–30 km/h, more on cycleways;
walking = up to 7 km/h or CoreMotion walking; running = 8.5–16 km/h, or
CoreMotion running; boat = ferry share; plane = p85 ≥ 200–280 km/h, altitude
or climb; stationary = slow and small. Without map data a fast move gets some
train score too, so it is not called a car with certainty. An Overland trip's
mode adds 2.5. Confidence = winner / sum of all scores; below 0.4 the mode is
`unknown`, below 0.6 the move is flagged for review.

**Splitting** (`splitMove`): a 3-minute window slides along each move in
30-second steps and is scored like a move. A change of the winner's family —
on foot, bike, vehicle — that lasts at least 2 minutes or 500 m cuts the move
(walk → train → walk). Pauses never decide a change: they join the run after
them, so waiting on the platform counts towards the train. A change between
vehicles needs a transfer, on foot or at a stop, so a bus that looks like a
car between its stops stays one bus ride. Shorter runs merge into their
longer neighbour; every part is scored on its own, and neighbours that end up
with the same mode are joined again.

**Overrides** are applied last (§17.5). Everything is deterministic: ways and
stops are ordered by id, ties go to the nearer candidate and then the lower
index, and a dense day of 21 000 points takes about 150 ms of CPU with its map
data at hand (`processingBenchmark.test.ts`, bound 3 s).

### 17.4 Scheduling

- After an upload's commit its window (earliest new point − 30 min, latest +
  30 min) is queued (a window with the same start widens the queued one);
  `POST /api/locations/delete` deletes the segments touching the range at
  once and queues the range ± 30 min in its transaction, under the device's
  processing lock; deleting a device cascades. A time-zone change needs
  nothing (segments are UTC).
- One in-process worker (`ProcessingWorker`, the daily-statistics scheduler's
  pattern, reading the table) wakes 3 s after new work, every minute for
  retries and on a 15-minute pass. It takes the next ready window — new data
  oldest first, then the backfill newest day first — with every queued window
  of the device that overlaps it, grows it to whole segments at both edges (at
  most two days out; a segment reaching further back is cut at the window's
  start), and in one transaction under a per-device advisory lock reads the
  points, visits, trips and overrides, runs the pipeline with the cached map
  data of one piece at a time, replaces the window's processed points and
  segments and finishes the queue rows (only those that did not change
  meanwhile). It yields to the event loop between pieces and windows. A
  failure re-queues with backoff (30 s × 4ⁿ, at most 6 h). Moves without
  their tiles are stored unmapped and the window waits for them, as it does
  for tiles due for a refresh (`missing_tiles`, re-checked after a day at the
  latest); tiles are fetched alongside, so a missing tile never holds up other
  windows. Ready times are kept to the millisecond, the worker's clock.
- The 15-minute pass makes waiting windows whose tiles arrived ready and
  queues the gap of any device whose newest point is more than 15 minutes
  newer than its newest processed point (a window lost when the process
  stopped between an upload and its queueing).
- When a level's version (`processingVersions`) differs from the one in
  `processing_state`, the worker's start queues every day with points of
  every device (from `daily_stats`, in the owner's time zone) at low
  priority, from the lowest level that changed (averaged when the history
  was never processed; a day already queued keeps the more thorough level),
  and records the versions in the same transaction: the backfill runs once
  per change and resumes after a restart, because the queue is a table.
  After a change to the inference alone, the days are worked out again from
  the stored mapped points and the cached map data, without map matching.
- `trail reprocess [--device <id>] [--from <iso> --to <iso>] [--from-level
  averaged|mapped|inferred]` queues the range in day windows, then processes
  them itself with the map data already cached; tiles still missing are left
  to the server's fetcher.
- When a window is done, the owner's streams get `segments { deviceId, from,
  to }` (§9), and so after a correction; an open dashboard refetches.
- Shutdown stops the worker: a window in progress finishes its transaction,
  map downloads are aborted.

### 17.5 Overrides (the person wins)

- `PUT /api/v1/segments/{id}/mode { mode }` stores a `segment` override for
  the move's span and sets `mode_user` at once (the same mode again changes
  nothing). `DELETE` revokes the override that set the segment (a toggle with
  it, for every move it covered), shows the inferred mode at once and queues
  the span for the inference again. A stop has no mode (409).
- `POST /api/v1/devices/{id}/mode { mode, until? }` is the quick toggle: a
  `toggle` override from now until `until` or the next detected stop,
  whichever comes first. The same mode again changes nothing (but a new
  `until`); another mode ends the running toggle and starts a new one; `mode:
  null` ends it. `GET` on the same path answers the toggle in force and the
  current mode, which shares and links with details show too (§8.5).
- `applyOverrides` applies them in creation order, so a later one wins: a move
  inside an override's span takes its mode; one reaching beyond it is cut at
  the span's edges, the parts outside keep (and are scored for) the inferred
  mode. Leftovers shorter than 90 s join the corrected part, so an override
  still fits after recomputation moved the segment by a few seconds; an
  override covering less than 90 s of a move, and not most of it, leaves it
  alone. A toggle that began before the window gets the first stored stop
  after it, which ends it. The applied override is in `features.override`
  (`{ id, kind, source }`); `GET /api/v1/stats/modes` counts the corrected
  segments.
- The three corrections need `locations:write` and `locations:read` together
  (their answers carry the segment, with its positions, or the current mode);
  `GET /api/v1/devices/{id}/mode` needs `locations:read`.

### 17.6 API and UI

`GET /api/v1/tracks?devices&from&to&level&maxPoints` (`locations:read`, ≤ 93
days) answers `{ level, availableLevel, from, to, simplified, segments }`;
a segment is `{ id, deviceId, kind, level, mode, modeInferred, modeUser,
confidence, needsReview, startedAt, endedAt, distanceM, points }` with points
`[lon, lat, epochSeconds]` (the way's shape between mapped points carries
interpolated times). `raw`, `averaged` and `mapped` give pieces of track
(`kind: "track"`, split at gaps over ten minutes); `inferred` gives the
timeline's stops and moves, and points outside every segment as track. Each
device is simplified to `maxPoints` with one RDP tolerance over its pieces
(their ends always kept); over 200 000 points a device's points are thinned
first. `GET /api/v1/segments?devices&from&to&cursor&limit` (`locations:read`,
≤ 93 days, keyset pages of up to 1000) is the timeline, with `pending` while
points of the range wait for processing. `GET /api/v1/stats/modes?devices&from&to`
(`history:read`, local days, ≤ 400) gives distance, time and segments per day,
device and mode. `/api/v1/locations` (owned by the token pull request) stays
raw-only, and `/stats/days` is not extended.

The dashboard calls these with its session (`apps/web/src/transport/`):
History and Live get the level `SegmentedControl` (Raw · Averaged · Mapped ·
Transport; `?level=` in the URL and remembered in `localStorage`, else the
account's preference, Transport by default) with a word on what is missing; at Transport the map draws stops
and moves in the mode colours (`--mode-*` tokens, apart from the device
colours, every mark ≥ 3:1) with a dashed outline for moves to review and a
legend. A click on a segment — or "Details" in the day's timeline list next
to the visits and trips — opens its dialog: the mode with its icon, "set by
you", the confidence, average and top speed, distance and duration, "Was this
…?" for moves to review, Change mode and Reset to detected. Live's device
cards carry the quick toggle (Now: Walk · Bike · Car · Bus · Train · Tram ·
Metro · Other · Auto). `segments` events refetch the tracks at their level,
the timeline and the current mode.

### 17.7 Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PROCESSING_ENABLED` | `true` | `false`: nothing is queued or processed; the derived tables stay as they are |
| `PROCESSING_OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Overpass interpreter for map data; set but empty: no map data (mapped degrades to averaged) |
| `PROCESSING_OVERPASS_DAILY_MB` | `300` | Map download budget per UTC day |
| `PROCESSING_OSM_TTL_DAYS` | `90` | Map tiles are refreshed after this many days |
| `PROCESSING_MAX_ACCURACY_M` | `150` | Points less accurate than this are left out from the averaged level on |
| `PROCESSING_STOP_MIN_S` | `180` | A stop lasts at least this long |
