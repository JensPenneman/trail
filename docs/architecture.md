# Trail — architecture

Trail is a self-hosted location history for phones. A tracking app —
[Overland](https://github.com/aaronpk/Overland-iOS) on iPhones, OwnTracks or
Traccar Client on iPhones and Android phones, OsmAnd or GPSLogger on Android —
posts the points to the API (§6); people sign in with passkeys and see where
their devices are, where they have been, and proof that data keeps arriving.

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
│   ├── api/            Express 5 API + ingest of the tracking apps + CLI (Node LTS, TypeScript)
│   └── web/            React 19 SPA (Vite 8), served by the API in production
├── packages/
│   └── contracts/      zod schemas + types = the HTTP contract (imported by both)
├── deploy/             production compose stack, env example, Windows docs/scripts
├── docs/               this file, the public API guide (api.md), operations and user docs
├── scripts/            repo tooling (dev, build, hooks, db init)
├── tests/e2e/          Playwright end-to-end suite (whole stack)
├── .devcontainer/      development container (scripts/devc.sh, §3), where the node's checks run (§15)
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
  `bundler` everywhere (the API is bundled by tsdown, the web by Vite). Vite
  and Vitest config files import what they share with `.ts`
  (`allowImportingTsExtensions`): Vite's native config loader, Node, needs it.
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
and neither Playwright nor Chrome for Testing publishes checksums). The
Launchway node builds this image for every check it runs (§15), so a change
that breaks it fails the checks of its commit.

### Production (Launchway)

```
Phones (tracking apps) ─┐
Browser ────────────────┴─▶ Launchway edge (HTTPS, 10.210.0.2 on its proxy network) ─▶ app :8080 ──▶ db (postgres:18-alpine)
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

### Processing roles

One image, two roles, chosen by `PROCESSING_ROLE`:

| Role | Entry | Runs |
|---|---|---|
| `api` | `apps/api/dist/main.mjs` (the image's `CMD`) | HTTP, ingest, the SSE streams and the jobs of §10; it queues processing and runs no pass, no map download, no backfill |
| `worker` | `trail worker` (`dist/cli.mjs worker`; `apps/api/src/worker.ts` in development, `npm run dev:worker -w @trail/api`); the server's entry in this role does the same | The processing worker of §17.4 — passes, map tiles, the backfill at the start, the 15-minute pass — and its heartbeat; no HTTP server |
| `all` (default) | `main.mjs` | Both in one process: a single container, `npm run dev`, the tests and the end-to-end suite's server, any install that never set the variable |

Postgres is the only coordination, so a worker needs no address of the API's
and the API none of the worker's:

- **The queue is the table** `processing_queue` (§17.2). The API writes it, the
  worker reads it: every two seconds while it has nothing to do (an upload in
  another process cannot wake it), every minute for retries, every 15 minutes
  for the map pass. In role `all` an upload wakes the worker of its process
  3 s later, as before.
- **Per-device advisory locks** (`deviceLock.ts`) are the cluster's: a pass in
  the worker and a deletion or a corrected mode in the API exclude each other
  across processes.
- **`segments` events cross with `NOTIFY`**: the pass ends with
  `pg_notify('trail_processing', …)` inside its transaction, and the API's
  listener republishes the message on its bus (§9) — in role `all` too, so
  there is one path.
- **Heartbeats**: each worker writes its row of `processing_workers` at the
  start, every 15 s and at its stop; the API reads them (§17.2) and the hourly
  prune removes rows unseen for an hour.

Both entries wait for the database and migrate under the same advisory lock:
whichever starts first migrates, the other finds nothing to do, and neither
needs the other to be up. On SIGTERM the worker takes no new window and lets
the one in progress commit (§11). One worker works the queue out at a time:
two would take the same windows and work each out twice, as the queue has no
claims yet. `deploy/compose.yaml` fixes `app` at `PROCESSING_ROLE: all` (not
taken from `.env`).

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
| `INGEST_BASE_URL` | `PUBLIC_URL` | Base URL shown to phones; endpoints `<base>/api/overland`, `<base>/api/owntracks`, `<base>/api/osmand` (§6). An `https:` base makes the endpoints refuse uploads over plain HTTP |
| `SIGNUP_ALLOWLIST` | empty | Emails (or `*@domain`) that may create an account without an invite |
| `TRUST_PROXY` | `false` (nobody) | Express `trust proxy`: the proxies whose `X-Forwarded-For`/`-Proto` decide client address and HTTPS; `deploy/compose.yaml` defaults to Launchway's edge, `10.210.0.2` (§12). Required with an `https:` address for the phones: Trail will not start without a trusted proxy then (§6) |
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
| `RATE_LIMIT_INGEST_PER_MINUTE` | `300` | Accepted Overland uploads (batches), per device token |
| `RATE_LIMIT_INGEST_SINGLE_PER_MINUTE` | `1200` | Accepted uploads of the one-point-per-request endpoints (OwnTracks, the OsmAnd format), per device token (§6) |
| `RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES` | `30` | Uploads with an unknown token, per IP, all ingest endpoints together |
| `RATE_LIMIT_TOKEN_PER_MINUTE` | `600` | `/api/v1` and `/mcp` requests with a valid API token, per token, both together (§8.3, §8.6) |
| `RATE_LIMIT_TOKEN_FAILED_PER_10_MINUTES` | `30` | `/api/v1` and `/mcp` requests with an invalid API token, per IP |
| `RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE` | `60` | The public share endpoint (`/api/public/share`), per IP (§8.5) |
| `PROCESSING_ROLE` | `all` | What this process runs (§3): `api` serves and queues processing, `worker` processes and serves no HTTP (`trail worker`), `all` both |
| `PROCESSING_ENABLED` | `true` | Location processing (§17); `false` queues and processes nothing |
| `PROCESSING_OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Map data for the mapped level; set but empty: none (§17.3) |
| `PROCESSING_OVERPASS_DAILY_MB` | `300` | Map download budget per UTC day |
| `PROCESSING_OSM_TTL_DAYS` | `90` | Map tiles are refreshed after this many days |
| `PROCESSING_MAX_ACCURACY_M` | `150` | Less accurate points are dropped from the averaged level on |
| `PROCESSING_STOP_MIN_S` | `180` | The shortest stop |
| `PROCESSING_PASS_MAX_POINTS` | `60000` | A processing pass reads at most this many points (1 000 or more); bigger work is split first (§17.4) |
| `PROCESSING_PASS_MAX_SPAN_HOURS` | `36` | The points a pass takes on span at most this long |
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

**devices** — `id`, `user_id` → users (cascade), `name`, `source` (the app:
`overland | owntracks | traccar | osmand | gpslogger`, checked; contracts
`deviceApp.ts`, §6), `device_key` (Overland's "Device ID", OwnTracks' user
name and device ID; unique per user),
`token_hash` (unique), `token_hint` (last 4 chars), `alerts_enabled` (bool,
default true), `created_at`, `updated_at`, `last_seen_at` (last accepted
upload), latest-position cache `last_recorded_at`, `last_lat`, `last_lon`,
`last_accuracy`, `last_speed`, `last_altitude`, `last_course`, `last_motion`
(text[]), battery cache `battery_level`, `battery_state`,
`battery_recorded_at`, `live_trip` (jsonb: `{mode, startedAt, distanceM}` or
null), `points_total` (bigint counter), `pending_settings` (text preset or
null; Overland only), `settings_applied_at`, `stale_alerted_at`.

**locations** — the points. PK `(device_id, recorded_at)` = natural dedupe
(Overland, OwnTracks and Traccar Client send whole seconds, OsmAnd and
GPSLogger milliseconds, kept as they came; at most one point per instant:
re-sent uploads collide and are skipped with `ON CONFLICT DO NOTHING`).
Columns: `device_id` → devices (cascade), `recorded_at`, `received_at`
(default now()), `lat`, `lon` (double precision), `altitude`, `speed`,
`course`, `horizontal_accuracy`, `vertical_accuracy`, `speed_accuracy`,
`course_accuracy` (real, nullable), `motion` (text[]), `battery_level` (real),
`battery_state` (text), `wifi` (text, the network's name), `extra` (jsonb:
everything the app sent without a column, under its own name — Overland's
tracking stats and `unique_id`, OwnTracks' `t`, `tid`, `conn` …, the OsmAnd
format's other parameters; never a credential). Extra index: BRIN on
`received_at` (activity chart).

**visits** — PK `(device_id, recorded_at)`; `arrived_at`, `departed_at`,
`lat`, `lon`, `horizontal_accuracy`, `extra`.

**trips** — PK `(device_id, started_at)`; `ended_at`, `mode`, `distance_m`,
`duration_s`, `steps`, `stopped_automatically`, `start_location` (jsonb),
`end_location` (jsonb), `extra`.

**device_events** — what the apps report besides points: Overland's
app/tracking log actions ("Include tracking stats"), OwnTracks' region
transitions (`region_enter:<region>`, `region_leave:<region>`) and last will
(`lwt`), the OsmAnd format's `heartbeat` and `alarm`: PK `(device_id,
recorded_at, action)`; `lat`, `lon` (nullable — events may lack geometry),
`extra`.

**ingest_log** — one row per accepted upload: `id` (bigint identity),
`device_id` → devices (cascade), `received_at`, `source` (the device's app at
the time, checked like `devices.source`; rows from before it are Overland's),
`records`, `locations`, `duplicates`, `visits`, `trips`, `events`, `rejected`,
`duration_ms`, `user_agent`. Index `(device_id, received_at DESC)`. Retention
90 days. The one-point-per-request apps make one row per point.

**ingest_rejects** — dead letter for invalid records (never silently drop
data): `id`, `device_id` → devices (cascade), `received_at`, `reason`,
`record` (jsonb). Kept forever, like every other recorded row: it is raw phone
data that a later fix may still recover.

**heat_cells** — pre-aggregated all-time density for the heatmap: PK
`(device_id, z, x, y)`; `count` (int), `first_at`, `last_at`. `z` ∈ {6, 9, 12,
15, 18, 20} (slippy-map tile coordinates; level 20 is about 24 m at 51° N, as
fine as GPS accuracy is worth); the heatmap answers at every level from 6 to
20, the ones between summed on read from the next finer stored one (§8.2).
Maintained in the same statement that
inserts locations (a CTE over `INSERT … RETURNING`, SQL tile math, upsert
`count = count + excluded.count`), only for points with horizontal accuracy
≤ 200 m or unknown. Rebuilt per device after deletions (`recompute`), and at
every start a device's levels that miss points — one a release added, or one
an older release left behind after a rollback — are rebuilt (§8.2, §10).

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
the workers' heartbeats (`processing_workers`); and `mode_overrides`, the
transport modes people set — user data, kept when everything else is
rebuilt.

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

## 6. Ingest

Phones post to three endpoints, one per protocol; a device's app
(`devices.source`, §5) decides which one takes its token. Every endpoint is
mounted before cookies, CSRF checks and the dashboard's body parser, speaks
its clients' dialect and never reads a session. The guide for the people who
set the phones up is [docs/trackers.md](trackers.md) (Overland's own:
[docs/overland.md](overland.md)).

| Endpoint | Apps | Token | Body | Answer to an accepted upload |
|---|---|---|---|---|
| `POST /api/overland` (§6.4), `GET` the account probe | Overland (iOS) | `Authorization: Bearer`, `?token=`, `?access_token=` | Overland's JSON batch, ≤ 5 MB | `{"result":"ok"}`, with `set` once a preset waits (§6.3) |
| `POST /api/owntracks` (§6.5) | OwnTracks (iOS, Android) in HTTP mode | HTTP Basic password (any user name; Android), `Authorization: Bearer` (the iPhone's *HTTP Headers*) | one JSON message, ≤ 256 kB | `200 []` |
| `GET`/`POST /api/osmand` (§6.6) | Traccar Client, OsmAnd, GPSLogger (and other clients of the format) | `Authorization: Bearer`, HTTP Basic password, `?token=`/`?access_token=`, the device identifier `id`/`deviceid`, JSON `device_id` | query or form (≤ 100 parameters), or Traccar Client 9's JSON; ≤ 64 kB | `200`, empty |

**Tokens.** One per device: `trl_` + 32 random bytes base64url, stored as
SHA-256 in `devices.token_hash`. Whatever carries it, a value without that
shape is no token and costs no lookup. A token at another app's endpoint is
refused with `403 {"error":"This device is set up for <App> in Trail. …"}`
(`requireApp`): the app decides how an upload reads — the OsmAnd format's
speed unit is the app's — so it is never guessed per request, and the holder
learns nothing they could not try. Unknown token → `401 {"error":"Invalid
access token"}` with a `WWW-Authenticate` challenge per scheme the endpoint
takes (`Bearer realm="trail"`; `Basic realm="trail"` too where Basic is read).
Tokens never reach a log, a stored record or an answer (§12).

**HTTPS, one rule for every credential** (`refuseCredentialsOverHttp`), set by
the address the phones were given — `INGEST_BASE_URL`, else `PUBLIC_URL`
(`ingestHttpsOnly`). An `https:` address: an upload over plain HTTP is refused
with `403 {"error":"Uploads need HTTPS: use https://…"}` before anything is read
or looked up, whatever would carry its token — a bearer token, a Basic
password, `?token=`, a form's `id`, a JSON `device_id`. HTTPS is `req.secure`,
the rule of the `__Host-` session cookie: as Trail serves plain HTTP, a
trusted proxy's `X-Forwarded-Proto: https` (`TRUST_PROXY`, §12). So Trail
refuses to start with an `https:` address and no proxy trusted (`false`, `0`,
none listed) — every upload would be refused while the dashboard seemed to
work — and the first refused upload that an untrusted hop says came over
HTTPS logs a warning that names `TRUST_PROXY`. An `http:`
address — a home network while Trail is set up (README, docs/overland.md) —
takes every credential over HTTP, Basic included: the phones were told to use
it, and refusing one scheme there would protect nothing while breaking the
phones that use it (OwnTracks for iOS drops a message it gets a 4xx for).

**Rate limits** (§12): uploads with an unknown token count per IP in one
budget for all three endpoints (`RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES`,
consulted after the lookup, valid tokens skipped); accepted uploads per
device token per minute, `RATE_LIMIT_INGEST_PER_MINUTE` (300) for Overland's
batches and `RATE_LIMIT_INGEST_SINGLE_PER_MINUTE` (1200, 20 a second) for the
one-point-per-request endpoints. In motion those send a point every few
seconds at most (OwnTracks' move mode, Traccar Client at 30 m), but a phone
back online sends its backlog as fast as it can — OwnTracks one after the
other, Traccar Client in order, GPSLogger in parallel jobs that drop a point
after three failed tries — so their budget is four times Overland's. Over the
limit the answer has a `Retry-After`: `429`, except on `/api/owntracks`,
which answers `503`, because OwnTracks for iOS drops a message it gets a 4xx
for and keeps one it gets a 5xx for.

**Acknowledged, always.** Every app keeps what it could not send and retries
it — Overland its batch until `{"result":"ok"}`, OwnTracks for Android a
message for weeks ahead of everything queued after it, Traccar Client its
queue in order — so an upload with a valid token is acknowledged whatever its
content: what cannot be stored goes to `ingest_rejects` (§6.1). The only other
answers are the refusals above, `413` for a body over the limit, `415` for a
compressed body (no app compresses an upload, and none is decompressed: a
body of a few bytes could otherwise cost the server a megabyte of work before
any token is checked), `405` for another method, `503` while the database is
down (`{"error":"Server temporarily unavailable"}`: the phone keeps its data)
and `500`. Errors use
`{"error":"…"}` on every endpoint (`sendIngestError`); Overland shows it on the
phone, the other apps only look at the status.

The routers (`overland/`, `owntracks/`, `osmand/` in `apps/api/src`) turn
what arrived into a `PreparedBatch` of normalised records
(`ingest/normalisedRecords.ts`: points, visits, trips, events, rejects, the
newest battery reading); `ingest/` stores it the same way for every app
(`ingestUpload`, §6.2).

### 6.1 Validation policy

- An individual invalid record (bad geometry, lat/lon out of range, exactly
  0,0, unparseable timestamp, timestamp before 1990 or > now + 24 h, an event
  action over 100 characters, a time without a zone) → stored in
  `ingest_rejects` with a reason; the upload is still acknowledged so the
  phone's queue never gets stuck on one bad record. A rejected record larger
  than 16 kB is kept as a 2 000-character preview.
- Nothing a phone sent keeps a credential where Trail stores it — a column
  (a Wi-Fi name, a motion activity, an event's action), `extra` or the dead
  letter (`withoutSecrets`): keys that hold one (`password`, `token`,
  `accessToken` and the like, however spelled) are left out, and token-shaped
  text is replaced — found in the text as it will be stored, so that a NUL
  cannot hide a token; a text without one reaches the normalisers unchanged.
  OwnTracks' message and Overland's upload pass it as a whole before anything
  reads them; the OsmAnd format's parameters, whose text Trail keeps in
  `extra` only, lose `id`, `deviceid`, `token` and `access_token` too. A preview of a body that is
  no JSON is redacted whole, after JSON's `\uXXXX` escapes are decoded (as
  `JSON.parse` would have), and only then cut.
- A body the endpoint cannot read at all — OwnTracks text that is no JSON, a
  message without `_type`, the OsmAnd format with more than 100 parameters —
  is one rejected record, acknowledged likewise.
- Every stored value is one Postgres accepts — a value it refuses would fail
  the whole upload, and the phone resends an unacknowledged upload. Text
  (columns, `extra`, trip locations, the dead letter; keys too) loses NUL
  characters and has lone UTF-16 surrogates replaced by U+FFFD; readings for
  `real` columns outside float4's normal range become null, trip steps beyond
  `integer` too; JSON nested deeper than 16 levels is cut off.
- Should Postgres still refuse a value (SQLSTATE class 22, 23502, 23514,
  54000), the upload is stored again in a new transaction, record by record,
  each in its own savepoint: a refused record goes to `ingest_rejects` with
  its SQLSTATE, a refused device update is retried without the newest
  readings, and the upload is acknowledged.
- Log events keep an unusable geometry in `extra` instead of being rejected;
  visit dates before 1990 or more than a year ahead (iOS `distantPast` /
  `distantFuture`) become null.
- Readings an app marks as unknown become null: negative numbers (iOS), an
  accuracy of 0 (Android apps send 0 when the platform gave none), and
  whatever an app leaves out (OwnTracks for Android omits every reading that
  is 0).

### 6.2 Processing (one transaction)

0. Lock the device row (`SELECT … FOR UPDATE`): concurrent uploads of one
   phone never interleave their cache updates.
1. Insert locations (`ON CONFLICT DO NOTHING RETURNING`) + upsert heat cells;
   insert visits / trips / events (`ON CONFLICT DO NOTHING`); insert rejects.
2. Update the device: `last_seen_at = now()`, `points_total += inserted`,
   latest position from the newest record if newer than the cached one; if
   Overland's `current` is present and newer, use it for the cached position
   (not stored as a point — it arrives later in a batch), battery from the
   newest record, `live_trip` from Overland's `trip` (null when absent, always
   for the other apps).
3. Insert the `ingest_log` row, with the device's app as its `source`.
4. Answer as the protocol expects (§6) — for Overland `{"result":"ok"}` plus
   `set` when a preset is pending (§6.3), which is then cleared; no other app
   takes presets, so their uploads leave a pending preset alone.
   `duplicates` = valid location records − inserted points (repeats within
   one upload count too).
5. After commit and the response: publish SSE events (`ingest`, `device`;
   `person` to the people the device is shared with, §8.5), schedule
   daily-stats recomputation for touched days, queue the new points' window
   for processing (§17), and if `stale_alerted_at` was set send the "sending
   data again" alert (the stamp is cleared in step 2).

### 6.3 Remote settings presets

Overland only: `devices.pending_settings` (one of `balanced | balanced-plus |
high-resolution | battery-saver`, contracts `remoteSettings.ts`) is sent once
as `set` in the next ok-response, then cleared and `settings_applied_at`
stamped. Queuing one for a device of another app is `409 conflict` (dashboard
and `PATCH /api/v1/devices/{id}`); moving a device to another app clears a
pending one. Mapping (Overland value vocabularies from its README; never
`send_interval: "off"` or `tracking_mode: "off"`):

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

### 6.4 Overland

`POST /api/overland` — the "Receiver Endpoint" configured in Overland
(`overland/overlandRouter.ts`). Verified against Overland's source:

- Body `{ "locations": Feature[], "current"?: Feature, "trip"?: {...} }`,
  `Content-Type: application/json`, up to ~600 kB (1000-point batches).
  JSON limit on this route: 5 MB.
- The app deletes its queued batch only if the response is JSON
  `{"result":"ok"}`. Anything else → it retries the whole batch later. A
  response `{"error":"…"}` is shown to the user as a notification.
- Optional `set` object in the ok-response pushes settings to the app (§6.3).
- Timestamps: current app sends `YYYY-MM-DDTHH:MM:SSZ`; old versions sent
  offsets without a colon (`2015-10-01T08:00:00-0700`). Accept `Z`, `±HH:MM`,
  `±HHMM`, optional fractions (`parseIsoTimestamp`). Reject anything else, and
  anything before 1990 (a reset clock or iOS's `distantPast`; year 0000 is not
  even a Postgres date).
- Invalid-value sentinels are negative numbers: `speed`, `course`,
  `*_accuracy`, `battery_level` < 0 → null; `vertical_accuracy` < 0 → altitude
  null too. Coordinates truncated to 7 decimals by the app.
- `GET /api/overland` with a valid token → `{"name": "<device name>"}` (Overland
  account-info probe; also a handy connectivity test). Other methods →
  `405 {"error":"Method not allowed"}`.
- The token is checked before the body is parsed, so an unauthenticated
  request never costs a 5 MB JSON parse.
- Top level not an object with a `locations` array (or > 5000 items) →
  `400 {"error":"Expected Overland JSON with a \"locations\" array. In Overland set Logging Mode to “All Data”."}`
  (Overland's OwnTracks logging mode sends a single object — tell the user to
  switch).

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

### 6.5 OwnTracks

`POST /api/owntracks` (`owntracks/owntracksRouter.ts`) — OwnTracks in HTTP
mode, verified against the booklet (owntracks.org/booklet, *HTTP* and *JSON*)
and the apps' sources (Android 2.5.9 and 2.6 betas, iOS 27.1.2): one JSON
message per request with `_type`, `Content-Type: application/json`, the token
as HTTP Basic password (Android sends Basic only when user name and password
are both set; iOS when *Authentication* is on) or, from iOS's custom *HTTP
Headers*, as a bearer token. The header is checked before the body is read
(raw, never decompressed, ≤ 256 kB: a message is a few hundred bytes, a point
of interest's photo, which the apps scale to 192 px, under 150 kB in base64).
`X-Limit-U`/`X-Limit-D` and the query are ignored. Other methods → `405`
(`Allow: POST`).

Every accepted request is answered `200 []` (`Content-Type:
application/json`): the apps parse the answer as a list of messages
(friends' locations, cards, commands) and Trail sends none. Each request is
one record of the ingest log (`records` 1; an empty body, which OwnTracks
posts when a friend is removed, 0).

| `_type` | Stored as |
|---|---|
| `location` | a point. `lat`, `lon` (required, checked like every position); `tst` (required, UNIX seconds, iOS a double) → `recorded_at`; `acc` → horizontal and `vac` → vertical accuracy (0 → null); `alt` → altitude, but null when it is exactly 0 without a `vac` (iOS sends `alt` with no `vac` when the altitude is invalid; Android never sends 0); `vel` (km/h, whole numbers) → speed in m/s; `cog` → course; `batt` (%) → `battery_level` 0..1; `bs` 0 unknown, 1 unplugged, 2 charging, 3 full → `battery_state`; `SSID` (Android) or `ssid` (iOS) → `wifi`; iOS's `motionactivities` (CoreMotion's words, as Overland's) → `motion`. Everything else — `t` (trigger), `tid`, `topic`, `conn`, `BSSID`/`bssid`, `m` (monitoring mode), `inregions`, `inrids`, `created_at`, `p` (pressure, kPa), `_id`, `source`, `poi`, `tag`, `image` … — goes to `extra` under its own name. |
| `transition` | a device event at `tst`: `region_enter` or `region_leave`, then `:` and the region's `rid` (else its `desc`), so two regions in one second keep both; its position when usable, the message in `extra` |
| `lwt` | a device event `lwt` at `tst` |
| `waypoint`, `waypoints`, `status`, `cmd`, `card`, `beacon`, `steps`, `request`, `clear` | acknowledged, counted, not stored |
| `dump`, `configuration` | acknowledged and never stored: they hold the password, the device token |
| `encrypted` | `ingest_rejects` ("encrypted message: turn off encryption in OwnTracks"): the key stays on the phone |
| anything else, no `_type`, no JSON | `ingest_rejects` |

Duplicates: a point is keyed by device and time, as Overland's; a message
sent again is stored once. OwnTracks for Android retries a message that got no
2xx up to 100 000 times (backing off to two minutes), ahead of everything
queued after it; OwnTracks for iOS drops a message that gets a 4xx (with an
alert) and keeps one that gets a 5xx — hence `503` over the rate limit (§6).

The setup links (contracts `owntracksSetup.ts`) are `owntracks:///config?inline=`
and a configuration message in base64, percent-encoded (Android decodes the
query with `URLDecoder`, which reads `+` as a space): `mode` 3 (HTTP), `url`,
`username` (the device key), `deviceId`, `tid` (the name's initials),
`extendedData`, the token as each app sends it — Android `auth` on with the
token as `password` (it sends Basic only, and only with both set), iOS `auth`
off and `httpHeaders` `Authorization: Bearer <token>` (the lines of its *HTTP
Headers* setting go with every request) — and the tracking per profile,
because the apps read the same keys differently:

| Profile | Tracking |
|---|---|
| `ios` (the default) | `monitoring` 2, move: GPS on, a point every `locatorDisplacement` 30 m and at least every `locatorInterval` 60 s — what transport modes need, at a high battery cost, which the setup screen states |
| `iosSignificant` | `monitoring` 1, significant changes: iOS's own fixes every few hundred metres or minutes, little battery; the move values stay set for the app's mode button |
| `android` | `monitoring` 1 with `locatorPriority` `"HighAccuracy"`, `locatorInterval` 15 s, `locatorDisplacement` 25 m, `moveModeLocatorInterval` 15 s and `pegLocatorFastestIntervalToInterval`: a point every 15 to 30 s while moving |

The locator priority goes by name: Android reads a number as a position in its
own list (0 would be High Accuracy, 3 No Power), which its documentation
numbers the other way round. Both apps import a link only once *Allow external
configuration* is on (iOS; Android from 2.6).

### 6.6 The OsmAnd format

`GET`/`POST /api/osmand` (`osmand/osmandRouter.ts`) — the protocol that
Traccar's server calls OsmAnd's (traccar.org/osmand, its
`OsmAndProtocolDecoder`), verified against the clients' sources: Traccar
Client 10 (traccar-client-sdk 1.1, `HttpUploader`) posts a form; the old
Traccar Client for Android (7.x) posted the same as a query without a body;
OsmAnd for Android (`LiveSender`) and GPSLogger (`CustomUrlManager`) fill in
the URL templates Trail gives them; Traccar Client 9 posted the JSON of
Transistorsoft's background-geolocation plugin. `HEAD` and other methods →
`405` (`Allow: GET, POST`): a `GET` of this format stores what it carries.

Traccar Client sends its device identifier — the token — in the form, so the
body is read before the token is looked up: raw, ≤ 64 kB, never decompressed
(`415`). Before the lookup it is parsed only as far as the token needs
(`readOsmandRequest`): the parameters, the query's and then the form's, the
first value of each name, at most 100 parts in all — read part by part, so
whatever follows the hundredth is never looked at, however long the body; a
JSON body is only searched for a token-shaped `"device_id"` in one pass, and
parsed once the device is known (`osmandRequestOf`). The token is the first
token-shaped value of: `Authorization: Bearer`, the HTTP Basic password,
`token`, `access_token`, `id`, `deviceid`, and a JSON body's `device_id`. A
request without a known token thus costs a bounded read, never a parse of
everything a body can hold. Every accepted request is answered `200` with an
empty body, all these clients look at. One request is one record (a JSON
body: one per location).

| Parameter | Stored as |
|---|---|
| `lat`, `lon` (or `location=lat,lon`) | the position; neither → a `heartbeat` event (Traccar Client's heartbeat without a fix) that still updates the battery |
| `timestamp` | UNIX seconds (Traccar Client), milliseconds (OsmAnd's `{2}`) or ISO 8601 with a zone (GPSLogger's `%TIME`): numbers below 1e11 are seconds, above milliseconds, which cannot be confused from 1990 to the year 5138. Required; a time without a zone (Traccar's `yyyy-MM-dd HH:mm:ss`) is rejected, never guessed |
| `speed` | m/s from the unit of the device's app: Traccar Client sends knots (× 0.514444), OsmAnd and GPSLogger m/s |
| `bearing` or `heading` | course |
| `altitude` | altitude |
| `accuracy` | horizontal accuracy (0 → null: the old Android client sent 0 for every GPS fix); for OsmAnd also `hdop`, which is OsmAnd's accuracy in metres (`{3}`) |
| `batt` (or OsmAnd's `batproc`) | battery level from percent |
| `charge` | `true`/`1` charging, `false`/`0` unplugged |
| `valid` | `false`/`0` → rejected: the app itself marks the fix invalid |
| `alarm` | kept with the point, and an `alarm` event (Traccar Client's *Send SOS* sends `alarm=sos`) |
| `id`, `deviceid`, `token`, `access_token` | the credential: never stored |
| anything else (`hdop` of other apps, `sat`, `cell`, `wifi` — an access point, not a network's name —, `driverUniqueId`, `mock` …) | `extra`, as text |

Traccar Client 9's JSON (`Content-Type: application/json`):
`{ device_id, location: {…} }`, one location per request — Traccar Client 9
leaves the plugin's `batchSync` off (checked in 9.0.0, 9.3.0, 9.5.0 and
9.7.20); an array, which the plugin sends with it on, is read too, up to 1000
entries. Each location has
`timestamp` (ISO 8601), `coords` (`latitude`, `longitude`, `accuracy`, `speed`
in m/s, `heading`, `altitude`, optional `altitude_accuracy`,
`speed_accuracy`, `heading_accuracy`; negative values unknown), `battery`
(`level` 0..1, `is_charging`) and `activity.type` → motion (`still`
stationary, `on_foot`/`walking` walking, `running`, `on_bicycle` cycling,
`in_vehicle` automotive); the rest (`is_moving`, `odometer`, `event`,
`extras` …) goes to `extra`, but not `_`, Traccar Client's copy of the
position as query text with the token in it. A location without `coords` is a
`heartbeat` event. Its units are the plugin's, whatever the app.

The apps' setup (contracts `traccarSetup.ts`, `osmandSetup.ts`,
`gpsloggerSetup.ts`): Traccar Client's link `org.traccar.client://setup?url=…&id=<token>&accuracy=highest&distance=30&interval=30&angle=30&buffer=true&stop_detection=true`,
which the app applies after asking (and its own QR scanner reads); OsmAnd's
web address `…/api/osmand?token=<token>&lat={0}&lon={1}&timestamp={2}&accuracy={3}&altitude={4}&speed={5}&bearing={6}&batt={11}`
(never `{12}`/`{13}`, OsmAnd Cloud's own device id and access token); GPSLogger's URL
`…/api/osmand?lat=%LAT&lon=%LON&timestamp=%TIME&accuracy=%ACC&altitude=%ALT&speed=%SPD&bearing=%DIR&batt=%BATT&charge=%ISCHARGING`
with the header `Authorization: Bearer <token>`, so its token stays out of the URL.

### 6.7 Not yet: importing a history

Trail records what phones send from now on. Importing what was recorded
before — a Google Timeline export (Takeout's `Records.json` or the newer
on-device `Timeline.json`), a GPX or GeoJSON file of another tracker, another
Trail's export — is a planned follow-up: an upload in the dashboard that
reads such a file into a device's `locations` (and visits) through the same
normalisers, dead letter and deduplication, with the source in `extra`. It
will be a signed-in request with the dashboard's CSRF checks, read by a
streaming parser under size caps (the file's bytes, its records, the time it
may take), never through the ingest endpoints: those are made for phones —
a device token, small bodies read before the lookup — not for a file of years
that someone chose on a computer.

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
| `POST /api/overland`, `GET /api/overland` | device token | §6, §6.4 |
| `POST /api/owntracks` | device token | §6, §6.5 |
| `GET /api/osmand`, `POST /api/osmand` | device token | §6, §6.6 |
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
| `GET/POST /api/devices` | cookie | `deviceListResponse`, `createDeviceRequest` (name, app as `source`, optional device key) → `deviceWithCredentialsResponse` (201; the credentials of that app) |
| `GET/PATCH/DELETE /api/devices/:id` | cookie (owner) | `deviceResponse`, `updateDeviceRequest`; delete removes all its data |
| `POST /api/devices/:id/token` | cookie (owner) | rotate, optionally to another app (`rotateDeviceTokenRequest` `{ source? }`; the history stays, a pending preset goes) → `deviceWithCredentialsResponse` |
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

The cells are the slippy-map tiles of level `cellZoom` = `round(zoom) + 5`,
kept within 6–20 (`chooseCellZoom`). MapLibre draws the tile of level z 512 px
wide at map zoom z, so a cell is 16 px wide on the map at a whole zoom (11 to
23 px between two), down to the streets: 16 px at map zoom 15, 32 px at 16;
past map zoom 15 the cells stay at level 20 (about 24 m at 51° N) and grow on
screen. A stored level is read as it is; any other is summed on read from
the coarsest stored level that is finer (`storedCellZoom`, s = 1 or 2 levels
finer, at most 4 × 4 stored cells to a cell):
`SELECT x >> s, y >> s, sum(count) … GROUP BY 1, 2`. The viewport is
widened to whole cells (`heatCellWindow`), so a cell at its edge counts every
point it holds, as it does in the middle. The answer is the cell centres
summed across the requested devices (the antimeridian handled when
`west > east`), at most 20 000 cells (highest counts first,
`truncated: true`). The query is a range scan of the primary key
`(device_id, z, x, y)` and a hash aggregate: measured on the production data
(1.2 M points; 6 350 cells at level 18, 28 035 at level 20) every viewport of
the dashboard answers in under 10 ms, and in at most about 30 ms on cells
fifteen times denser — no further index is needed.

Every upload adds its points to the six stored levels in its one statement
(§6.2). Level 20 costs a batch of 1 000 points of a drive 30 to 60 ms (an
upload's median 87–92 ms with five levels, 120–151 ms with six, in the
development container under load); in production, before it, uploads took
28 ms at the median and the largest ones (about 900 points) 76 ms, 135 ms at
most — far from the 10 s an upload in flight gets at shutdown.

Every point adds one to every stored level, so a device's levels hold the
same total unless one was not kept: a level a release adds (level 20) misses
the points uploaded before it, and after a rollback to a release without it,
that release's uploads skip it and its rebuilds (a deleted period, its
`trail recompute`) drop it. So at every start `fillHeatLevels` reads the
total of each device's levels (one pass over the cells: milliseconds for
1.2 M points) and rebuilds from the device's points every level below the
highest of them (`levelsToRebuild`): uploads and rebuilds write every level
in one statement under the device's lock, so no level ever holds more points
than the device has, and a level short of cells for any other reason is
rebuilt too — that level alone. It goes a device at a time, each in a
transaction under the device's row lock — the lock an upload takes first, so
an upload of that device waits rather than being counted twice (1–4 s for
1.2 M points). A stop cancels the statement in progress, a wait for that
lock included (that of its own transaction, found by backend and start), or
throws between two statements, and the transaction rolls back; the next
start finds what is left. `trail recompute` rebuilds every
level under the same lock, then the daily statistics without it.

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
9. `express.json` (100 kB; `application/json` and `application/*+json`; a
   compressed body 415).
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
  and queues presets (Overland's only, 409 for another app), never its
  credentials, its app or its deletion, which stay with
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
8. `express.json` (1 MB, `application/json`, a compressed body 415) and
   `singleMessage` (a JSON array is 400: the SDK's 2025 transport would take
   a batch of 100 calls for one count of the rate limits), then the SDK, which
   gets the parsed body and the principal (in `AuthInfo.extra` as an
   `McpCall`, with the token's id as `token`, never the secret).
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
| `list_devices` | `devices:read` | `loadDeviceSummaries`, with each device's `app`; `loadDeviceMode` only for a token with `locations:read` too (the mode tells when a device moves, as `GET /api/v1/devices/{id}/mode`); no position, no segment id |
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
mode. A corrected mode is the API's own doing and goes on the bus at once. A
pass, in whichever process it ran (§3), ends with
`pg_notify('trail_processing', '{"t":"segments","u":<user>,"d":<device>,"from":…,"to":…}')`
in its transaction, so the message (about 160 bytes) leaves with the commit
and never after a rollback; the API's listener (`events/processingListener.ts`,
a connection of its own outside the pool) republishes it on the bus, and
leaves alone any message it does not know. A lost connection is opened again
after 1 s, then twice as long after each failure up to 30 s, and a check
every 30 s (10 s to answer) finds one that died silently. Listening again, it
publishes a `segments` event for every device whose segments were worked out
(`computed_at`) since ten minutes before the connection last answered — a
pass's segments carry the start of its transaction, which may lie that far
before its commit — so a dashboard that stayed open still refetches what it
missed.

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

All of them run in the API's process except the processing worker, which
runs in the worker (§3) — or in the API's process too, in role `all`.

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
  a log, not recorded data), and the heartbeats of workers unseen for an hour.
  Recorded data — locations, visits, trips, events, rejects — is never
  pruned.
- every 2 s while accesses wait — the data access log's write (§8.8), in one
  statement per 500 rows; a failed write is tried again with the next.
- debounced (10 s) — daily-stats recomputation per touched (device, day), in
  the owner's time zone at run time; a failed pass is retried with the next.
  Changing the time zone (`PATCH /api/me`) rebuilds every day of the user's
  devices in the background.
- once, 5 s after the start — the heat levels of every device whose totals
  disagree are rebuilt from its points (`fillHeatLevels`, §8.2). A shutdown
  does not wait for it: it is cancelled and rolls back.
- the processing worker (§17.4), in the worker's process (role `worker`) or
  the API's (`all`) — 3 s after new work in its own process, every 2 s while
  idle in a worker process, every minute for retries and every 15 minutes for
  windows waiting on map data and lost windows; the boot-time backfill when a
  level's algorithms changed version; map tiles fetched alongside, within the
  daily budget; its heartbeat every 15 s.
Jobs must never crash the process; failures are logged. Runs never overlap.

## 11. CLI

`apps/api/src/cli.ts` (bundled to `dist/cli.mjs`; `/usr/local/bin/trail` in
the image, so `docker compose exec app trail <command>`):

- `migrate` — apply migrations (also done at boot)
- `passkey-link <email> [--origin <url>]` — one-time URL to add a passkey (recovery)
- `invite [--email <email>] [--days <n>]` — invite URL
- `users` — list accounts
- `recompute [--device <id>]` — rebuild heat cells (every stored level) + daily stats
- `reprocess [--device <id>] [--from <iso> --to <iso>] [--from-level averaged|mapped|inferred]`
  — work out the processed levels again (§17.4)
- `prune` — run the retention cleanup now
- `worker` — the processing worker in the foreground (§3), the worker
  container's command. A service rather than a command: its own pool of five
  connections, the server's logging (stdout, `LOG_LEVEL`), a heartbeat, until
  SIGTERM or SIGINT; then it takes no new window, lets the one in progress
  commit, writes its last heartbeat and exits 0. A window not committed within
  80 s is left to the database, which rolls it back as the process exits (1).
  Exit 1 also on an invalid configuration, in role `api` (a process that must
  not process) and when it cannot start.
- `help` / `--help`

Every command applies pending migrations first (same advisory lock as the
server). Output on stdout, logs on stderr (`worker`: logs on stdout). Exit
codes: 0 success, 1 failure (including invalid configuration), 2 wrong usage
(unknown command or option, invalid value).

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
  probe); ingest ~300/min/token for Overland's batches, ~1200/min/token for
  the one-point-per-request endpoints, and ~30 failed tokens/10 min/IP across
  all three (§6); API tokens
  ~600/min/token and ~30 failed tokens/10 min/IP; the data of public share
  pages ~60/min/IP; everything else, `/docs` included, ~600/min/IP
  (`/api/health*` and `/api/config` excluded). `429
  rate_limited` (ingest: `{"error"}`, and `503` on `/api/owntracks`, whose iOS
  app drops a message on a 4xx), IETF `RateLimit` headers.
  Configurable (§4). The failed-token limits are consulted after the token
  lookup and only for requests without a valid token: a scanner sharing the
  phones' or a client's address (NAT, proxy) never locks out a valid token.
  The per-token budget is one for `/api/v1` and `/mcp` together.
- Database statements time out after 120 s (10 s for the MCP server's reads);
  deleting a device or an account and rebuilding derived data lift that limit
  for their own transaction.
- Body limits: 100 kB default, 1 MB on `/mcp`, 5 MB on `/api/overland`,
  256 kB on `/api/owntracks`, 64 kB (and 100 parameters) on `/api/osmand`. No
  request body is decompressed anywhere — the dashboard, `/api/v1`, `/mcp` and
  the ingest endpoints answer a compressed one with `415` before reading it:
  no client of Trail compresses a request, and a body of a few bytes would
  otherwise cost up to its limit in work, before authentication where the
  parser runs first. A request to `/api/osmand` is parsed only as far as its
  token needs before the lookup (§6.6).
- Device tokens (§6): the ingest endpoints read them from the
  `Authorization` header (Bearer, HTTP Basic's password), and where a client
  can send nothing else from the query (`token`, `access_token`; Traccar
  Client's device identifier `id`/`deviceid`) or the body (Traccar Client 10's
  form, Traccar Client 9's `device_id`). One rule decides plain HTTP for all of
  them (`refuseCredentialsOverHttp`): once the phones are given an `https:`
  address, an upload over plain HTTP — `req.secure` false, so also behind a
  proxy Trail does not trust — is refused with 403 before anything is read or
  looked up; with an `http:` address every credential is taken. Every
  candidate is shape-checked before the lookup. A token in a URL is the price
  of clients that cannot send headers (OsmAnd, the old Traccar Client for
  Android): Trail's own logs redact it (below), a proxy in front of Trail may
  log it, and docs/trackers.md says so; Traccar Client shows its identifier —
  the token — on its main screen. What a phone sends is stored without
  credentials, in columns, `extra` and the dead letter alike (§6.1,
  `withoutSecrets`), OwnTracks' configuration dumps (which hold the
  password) are never stored, and no ingest answer carries data: Overland's
  `ok` (and `set`), OwnTracks' `[]`, the OsmAnd format's empty `200`. A token
  works at its own app's endpoint only (403 elsewhere).
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
  case-insensitive): device tokens in `token`/`access_token`, every value of
  an upload in the OsmAnd format (`/api/osmand?…`: Traccar Client's `id` and
  the coordinates), the one-time tokens of `/link/…`, `/invite/…` and
  `/api/auth/link/…`, and any device token, API token or share link secret
  (`trl_…`, `trlk_…`, `trls_…`) a client puts into a URL after all —
  public links keep theirs in the fragment and a header (§8.5). Request bodies
  are never logged, not even in an error: the `body` a body parser keeps in
  its error is dropped with the other fields below. Database errors are
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
`/usr/local/bin/trail` (also the worker's entry, `trail worker`, §3); `USER 1000:1000` (`node`); `EXPOSE 8080`;
`HEALTHCHECK` on `/api/health/live` (busybox `wget`); OCI labels
(`org.opencontainers.image.source` links the GHCR package to the repo);
build args `APP_VERSION`, `GIT_SHA`, `BUILD_TIME` → env (CI sets the
package.json or tag version, the 7-character commit that matches the
`sha-<short>` tag, and an ISO UTC time; empty means unset).

### 13.2 Images and releases

GitHub Actions (`ci.yml`, job `image`): on every push to a branch of this
repository, without waiting for the checks (§15), build and push
`ghcr.io/jenspenneman/trail` tags `sha-<short>` and the branch name, plus
`latest` on `main`; a `v*` tag adds `<version>` and `<major>.<minor>`, never
`latest`. Pull request runs only build, so a fork never publishes; Dependabot
branches only build too (read-only token). BuildKit provenance (`mode=max`)
and SBOM attestations, plus a signed GitHub build provenance attestation when
the repository is public (GitHub offers those on private repositories only
with Enterprise Cloud). Base-image patches arrive as Dependabot digest updates
of the Dockerfile, auto-merged once the required checks pass; the weekly
scheduled run (Monday 03:00 UTC) rebuilds and republishes `main`.

Releases: release-please (`release-please-config.json`, `release-type: node`,
`"draft": true`) keeps a release pull request open; `scripts/release.sh`
cherry-picks its commit onto `main` signed, pushes a signed tag `vX.Y.Z` and
creates the GitHub release as a draft. CI on the tag publishes the images and,
once the node's checks of the tag's commit have passed, the draft (jobs
`release-gate` and `release`, §15); a release pull request merged on GitHub
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

Navigation (`PrimaryNav`, one landmark): **People · Insights · Settings**,
in the header on wide screens and as a tab bar along the bottom edge on
phones (the same element, restyled); the current item carries
`aria-current="page"` on every address below it. Settings leads to
`/settings`: the list of Settings on phones, its first page beside the list
on wide screens. The devices live in Settings (Settings › Devices, below), so
Settings is the current item on their pages too.

| Route | Page |
|---|---|
| `/login`, `/invite/:token`, `/link/:token` | sign-in and sign-up (public) |
| `/s` | a public link; its secret is the fragment, `/s#trls_…` (public) |
| `/` | **People**, the home page: the map with Live, History and Heat, and the people list (signed in) |
| `/insights`, `/insights/transport/:mode`, `/insights/time`, `/insights/roads` | Insights: the overview, a transport mode's page, when you travel, roads |
| `/settings` | Settings: on phones the list with search; on wide screens the first page (Profile) beside the list. An anchor of the single page of 0.2 (`/settings#tokens`, `#browsers`, …) opens its page (`settingsPathFor`) |
| `/settings/profile`, `…/devices`, `…/passkeys`, `…/browsers`, `…/sharing`, `…/links`, `…/privacy/viewers`, `…/privacy/access-log`, `…/data`, `…/tokens`, `…/mcp`, `…/preferences`, `…/notifications`, `…/about`, `…/accounts` | a page of Settings each; `…/accounts` for administrators only, everyone else lands on `/settings`; `/settings/devices?add=1` opens Add device |
| `/settings/devices/:deviceId`, `…/passkeys/:id`, `…/sharing/:shareId`, `…/links/:id`, `…/tokens/:id`, `…/privacy/viewers/:actor` | the page of one device, passkey, share, public link, API token or viewer — an actor of the access log, its actor id (§8.8) as base64url |
| `/settings/devices/:deviceId/uploads`, `…/points`, `…/tracking`, `…/setup` | a device's uploads, raw points, tracking settings (Overland's presets; for another app the page says that only Overland takes them) and setup: the pages of its parts, a level below its own |
| `/settings/people` | Accounts' address of 0.3: redirects (replacing the entry) to `/settings/accounts` |
| `/history?…`, `/explore?…` | redirect (replacing the entry) to `/?view=history&…` and `/?view=heat&…`, every parameter kept (`legacyMapPath`) |
| `/people?…` | redirect (replacing the entry) to `/?…`, every parameter kept (`legacyPeoplePath`): People had an address of its own before it took in the map |
| `/devices?…`, `/devices/:id?…` | redirect (replacing the entry) to `/settings/devices?…` and `/settings/devices/:id?…`, the query and the anchor kept (`legacyDevicesPath`, rendered rather than in a loader, whose request has no anchor): Devices had a tab of its own before it moved into Settings, and links, bookmarks and the guides keep working |
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
  when the page opened on it. A camera move of a view (a visit, trip or
  move shown) belongs to its view and period: another view or another day —
  from the controls, a person's card or Back — drops it, so neither the view
  shown again nor a return to its day makes it again.

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
  - **Live** — where everyone shown is now: every shown device's latest
    position (accuracy circle, pulsing when live) and today's tracks, the
    people chosen as their initials; the head says whom it shows ("Where you
    and Ana are now · Tue 27 Oct"). While Me is on the map, one's day so far
    sits right under the Me card (a region "Your day so far"): today's
    timeline of stops and moves (`DayTimeline`, the one History has), whose
    Details open the move's dialog and move the camera to it. That the phones
    keep sending — status, uploads, activity — is Settings › Devices'.
  - **History** — pick a day (prev/next, calendar with days that have data
    from `/api/stats/days`) or a range ≤ 93 days; tracks per device at a
    level (Raw · Averaged · Mapped · Transport, §17.6), stops and moves in
    their modes' colours with a legend; time scrubber showing the position at
    a moment; distance, points, first/last; the timeline of stops and moves,
    with a dialog to correct a mode; visits and trips of the day. Other
    people's tracks as their shares allow (below).
  - **Heat** — all-time heatmap (`/api/heatmap` for the view once the map
    has stood still for 300 ms, its box rounded outward to a thousandth of a
    degree and its zoom to a whole level, so that small moves hit the
    cache), totals and the busiest places in view. The cells are drawn as
    squares (`heatFeatures`: each the tile of its level, with a gap of the
    map 1.5 px wide between neighbours at the zoom they arrive at, and at
    most 20 px wide, centred in its tile — past map zoom 15 the cells of
    level 20 grow on screen, their squares do not, so the busiest places
    never blank whole blocks of the map) in the
    classes of `heatScale`, taken from the cells in view: from the smallest
    count to the busiest 3 % of the cells, the classes start at round
    numbers — 1, 2, 5, 10 … over a short range, 1, 3, 10, 30 … over a longer
    one (its highest five when it has one or two too many, so that the
    rarest counts share the first class), whole decades over longer ones —
    six classes at most; panning moves the counts but rarely the round
    numbers. The classes take the steps of one ramp (`heatRamp`), spread
    over all six when there are fewer: pink to purple at even steps of OKLCH
    lightness, darker for more on a light map and brighter for more on a
    dark or satellite one, in hues the basemaps hardly use (their parks,
    water and roads are green, blue, yellow and orange). The squares are
    opaque, so each is exactly its colour in the key and the ramp's numbers
    are what the map shows: against the ground of OpenFreeMap's styles the
    lightest step of the light ramp has 2.24:1 (#f8f4f0) and the darkest of
    the dark one 3.28:1 (#0c0c0c); neighbouring steps are 0.08 or more
    apart in lightness and 8.9–10.0 (light) and 8.4–10.1 (dark) in ΔE
    (OKLab × 100), at least 7.0 and 6.6 for protanopia and 8.9 and 7.9 for
    deuteranopia. The squares lie over every area, road, building and
    boundary of the basemap, which would otherwise cut them apart, and under
    every name (`heatLayerPlacement`): below the first of the symbols after
    the style's last other layer, with the names a style draws earlier
    moved over the squares (OpenFreeMap's dark style draws its water names
    under its buildings and its road names under its boundaries), once
    Trail's lines are in under the style's first symbol. The key
    (`HeatLegend`) is that scale: "Points recorded in each square", a
    swatch and the counts of every class, "Rarely" and "Often" at its ends
    as a visual cue only; it follows the view, as the squares do. Nothing in
    the heatmap moves (no transitions, so nothing for reduced motion to
    stop). Heatmaps cover one's own devices only, so Heat offers no people
    and says so when some are chosen with Me.

  The head holds the controls the views share, in this order: **people**
  (Me and everyone who shares with me, plus Everyone — a checkbox for all,
  "mixed" while some are chosen — once two or more share; somebody always
  stays chosen), the **map style** (Auto, which follows the system's light
  or dark setting, Light, Dark, and Satellite when the server has imagery;
  remembered in localStorage `trail.mapStyle`, else the account's
  preference, a dark or satellite map drawing Trail's lines and dots in their
  dark-background steps whatever the page's scheme), the tracks' **level**
  with the mode legend (Live and History, with Me), and last, folded under
  **Advanced** (a disclosure, open when the address sets a filter), the
  **device filter** (grouped by person; someone else's devices in their
  colour from `personPalette`): which devices draw is seldom what one looks
  for. The style and the level resolve in the same order: the address
  (`?style=`, `?level=`) › the choice last made on this browser › the
  account's preference (Settings › Preferences) › Auto and Transport. On
  phones and small tablets they fold into one "Map options" button with a
  one-line summary (whom, the level, the style; devices only while some are
  left out, "1 of 2 devices"), so the map stays near the top; beside a
  full-height map (≥ 64rem) the panel scrolls by itself under a sticky title
  and view switch.

  **The people list** — Find My for Trail (§8.5): people, not their
  devices. A card reads in two lines (`PersonSummary`): the avatar and the
  name (an ellipsis rather than a line more), with a battery glyph where the
  share includes it — the gauge, red when low, "Battery 58%" by name — and
  the distance on the right; then how fresh — "Live" while the position is
  within the live window (its time on hover and in Details), else "40 min
  ago" — and what they are doing, broken only between its parts. A coarse
  share always says how coarse ("Cycling · within about 5 km") and marks
  its distance "≈" (read "about"): it is to the centre of a cell, as the map
  draws a circle rather than a spot. Measured at 375–430 px wide, a card
  takes two lines; a coarse share that moves, Me's longest lines and most
  cards at 320 px take a third. "On the map" while the map shows them;
  then **Show on map** and **Details**, a
  disclosure closed at first (a button with `aria-expanded` and
  `aria-controls`; its content follows it in the reading and tab order and is
  only rendered while open, so a closed one asks for nothing), which holds
  everything else. The **Me** card: your initials in the accent ring; what
  you are doing now (`describeMe`) from the device that reported last
  (`latestOwnDevice`: the newest position, else the latest upload) — the
  stop or move of its current mode (§17.5: "At the same place since 08:12",
  "Cycling · 18 km/h"), else its Overland trip or motion as for anyone
  (`describeActivity`), without a speed once the position is older than the
  live window, "No recent location" past the stale window (a share without
  history shows no more); the quick toggle (§17.6) for that device, which
  its description names ("Until you stop for 10 minutes or more or travel
  another way, for iPhone 16: the device that reported last. Your other
  devices are not changed." —
  another
  device is set on its own page); with no device yet "Connect your first
  phone" (Add a device: `/settings/devices?add=1`), and while no device has
  uploaded "Waiting for the first upload" with the way to its setup (the
  device's Setup page). Its Details: each device by name, linked to its
  page in Settings › Devices, with when it last reported a position ("Waiting
  for the first upload" before it did), battery, that position with its
  accuracy, movement ("Last reported movement" once it is not live) and trip,
  and the way to Settings › Devices. Then "Sharing with you": a card per person (`PersonCard`),
  each as their initials in their colour (`personPalette`, a second ring
  beside the device colours, assigned in the order they started sharing),
  the line about them from the device that reported last (`primaryDevice`;
  what they are doing as `describeActivity` has it, which takes the inferred
  mode when the share includes one, or how coarse the position is when
  nothing else is known: "Within about 500 m"). Their Details: each shared
  device (updated, doing, battery, accuracy, trip, distance — "Not shared"
  where the share leaves battery and activity out, "—" where it includes
  them but nothing recent is known),
  what they share (precision, where they've been, battery and activity,
  until, since), Apple Maps and Google Maps links, Share back — or, when you
  share with them, "You share with <name>" and Stop (`StopShareDialog`) —
  and Hide. While someone is on the map in Live or History their card says
  **where they've been** (`WhereTheyveBeen`, a part under its heading, not
  a landmark: every card on the map has one): the day — Today in Live,
  History's day, or History's period — with Previous and Next day (in Live
  a day back is History's, one step of the history, `showHistoryDay`; the
  day stepped to is announced, and History with it). Previous day goes no
  further back than the first day of the history they share, since every
  look counts in their access log; both stay focusable at their end
  (`aria-disabled`, inert), so the keyboard's focus is never dropped. Their
  track for it is a line from the answer of the track request the view
  makes anyway, of the device that recorded the most — devices are never
  added up (a phone and an iPad on one ride, or a car's tracker) — with how
  many recorded when more did ("14.9 km · 06:30 – 07:15 · 2 devices
  recorded", read "14.9 km, from 06:30 to 07:15"), "Nothing recorded on Mon
  26 Oct", "Shares the last 7 days only" where the server moved the start
  up, "Shares no device right now"; a share without history says "Shares
  live location only" and is asked for nothing. People you hid are listed under
  Hidden, to be shown again. A notice says who started sharing while the
  page was open. Last, one's own side: **Share my location**
  (`ShareDialog`): address (with the people who share with you as
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
  is precise with history; everyone else's card says "Shares live location
  only" instead of a request, so no 404 ever reaches the console. Those
  queries are keyed by the share's id and history, so a share that changes
  (a `share` event refetches the people) is never asked for what it allowed
  before, and they are not cached once off screen (`gcTime` 0); `person`
  events refetch them.
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
  id, or the query the page takes: Add device is `/settings/devices?add=1`),
  the pages of its items (`/settings/tokens/:tokenId`), whether search finds
  the items by name (`searchable`: the devices) and the pages of the parts of
  an item (`/settings/devices/:deviceId/uploads`, each with its title and
  line). A part of an item gets a page a level deeper when it is a table, a
  list loaded on its own or a choice (a device's uploads, raw points, presets
  and setup); otherwise it stays a section of the item's page, `#anchor` and
  all (a token's scopes and use, a share's terms and its use). The routes (`settingsRoutes.tsx`, a chunk per page),
  `isSignedInPath`, the old anchors (`settingsPathFor`, own keys only), the
  search index and the devices' addresses (`devicePaths.ts`, every link to a
  device's pages) are built from it. `useSettingsTree` adds what the person
  sees: the administrators' group for administrators only, the value on the
  right of a row from the lists the pages load anyway (one cache) — the
  display name; the number of devices, passkeys, browsers, people shared
  with, working links ("3 active") and active tokens; how many people, links
  and tokens looked in the last 30 days (the summary Who viewed you and
  Insights' card load too); whether alerts are on; the version — and to
  search one's devices, by name, app and device ID ("Account › Devices",
  leading to the device's page).

  The frame (`SettingsShell`): on phones (below 64rem) the list — the search
  field, then the groups as inset cards of rows — is the page at `/settings`,
  and every other page has the screen to itself under a bar with the way back
  and the page's title, which starts large and moves into the bar once it
  scrolls under it; going deeper — the root, a page, an item's page, a part
  of an item (`settingsPlaceOf`, levels 0 to 3) — slides the new page in from
  the right, coming back from the left, with no motion under
  `prefers-reduced-motion`.
  On wide screens the list stands beside the page (as in the Mac's System
  Settings), marks the row of the page on screen (`aria-current`), scrolls by
  itself and keeps its search while pages change; `/settings` opens the first
  page there. The components: `SettingsGroup` (a titled card of rows, of
  label/value facts or of a form, with small print below; a list is named by
  its title; also an ordered list, the uploads newest first, and a group of
  cards, a device each), `SettingsRow` (an icon tile, the label, a second
  line and the value, then a chevron — or a switch, a choice, an action, an
  arrow for a page outside Settings: the API reference outside the app, a
  device's History in it (`away`, a link that keeps no way back into
  Settings); a row's link is named by its label and described by the rest; `useSettingsLink` gives it, and a device's card,
  where it was opened from and the focus on the way back), `SettingsPage` (a
  region named by its h1, the bar, the title and description; for the part
  of an item the way back is the item's page, by the item's name) and
  `SettingsSearch`. Every page has the document title "<page> · Settings"
  ("<item> · <page> · Settings" one level deeper, "<part> · <item> · <page> ·
  Settings" for the part of an item) and takes focus when it opens; coming back up, focus returns to the row of the
  page that was left, and an address with `#part` focuses that part's
  heading. The way back goes back in the history when the page was opened
  from the one above it (a row puts its address in the location's state),
  so Back and Forward keep making sense; opened from a bookmark it goes to
  the page above. Search folds case, accents and punctuation, finds rows by
  label and keywords (every word of the query, anywhere; the best label
  matches first) and shows each with where it is ("Privacy & data › Your
  data"); Enter opens the first.

  The pages: **Profile** (name, time zone); **Devices** (below);
  **Passkeys** (the list, adding
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
- **Devices**, in Settings (`/settings/devices`, `pages/devices/`: the row
  after Profile in the Account group, with the number of devices) — the proof
  that data still comes in, which People leaves out: under the title how many
  devices are live and the latest upload of any ("1 of 2 devices live · last
  upload 2 min ago", ticking); **Add device**, an action row; then **Your
  devices**, a card per device (`DeviceCard`, in a group of cards, its name an
  h3: the head — colour, name, status, a chevron — leads to the device's page
  as a row of Settings does, carrying where it was opened from, and takes the
  focus again on the way back, unless the device is going away): status badge
  (`deviceStatus()`: Live, Idle, Silent, No data yet, with what each means),
  its app, Device ID and points in total, last upload ("2 min ago", ticking;
  "Waiting for the first upload" with the app to open and "Setup details",
  the device's Setup page), the Overland trip
  in progress, battery, movement ("Last seen …" once it is not live), points
  today, the distance today (from the day's sums, `/api/stats/days`, not
  from its whole track; asked for every 10 s while uploads come in, until a
  minute after the last, since the server sums a day up 10 s after the first
  upload of a run and again for the ones after that pass), the last position
  with its accuracy and time, and the 48 h activity sparkline (points per
  hour and a tick per hour with uploads, its numbers in a table); then
  **Uploads** (an ordered group, `#uploads`), the feed of every upload of
  every device, newest first (the ingest logs merged with those the event
  stream announces while the page is open, marked New); "How it works". The
  "Add device" flow (`?add=1`, a dialog): name and the
  app on the phone (Overland · OwnTracks · Traccar Client · OsmAnd · GPSLogger,
  each with its platforms and a line on what Trail gets from it; the device
  key only for Overland and OwnTracks), then what that app needs
  (`CredentialsView`, one component per app in `devices/setup/`): Overland's
  QR of `overland://setup` and "Open in Overland"; OwnTracks' configuration
  link per platform (an iPhone · Android switch, on an iPhone Move ·
  Significant changes with what each costs in battery, "Allow external
  configuration" first) with URL, user name, device ID, tracker ID and the
  token — the iPhone's *HTTP Headers* line, Android's password; Traccar Client's `org.traccar.client://` link with server URL and device
  identifier (and a word that it is the token); OsmAnd's web address and
  GPSLogger's URL, header and method to copy — every value with a copy button,
  the settings Trail recommends for that app (`recommendedSettings.ts`, the
  numbers from the same contracts as the links), then "Waiting for the first
  upload…" with what to check in that app, which turns into a success state
  via SSE, and "Open device page".

  **A device's page** (`/settings/devices/:deviceId`, `pages/device/`), in
  the groups of the iPhone's Settings: under its name its colour, status and
  last upload; **Overview** (facts: last upload and position, movement,
  altitude, battery, trip, points, the app, Device ID, token, added);
  **Activity** (the same sparkline); **Travelling now** (the quick toggle for
  this device: the Me card's sets the device that reported last); **Alerts**
  (its switch, as Notifications has it); **What it sent**: Uploads, Raw points
  (its total on the right) and History (its tracks in the People page's
  History, with the arrow of a row that leaves Settings); **The phone**: Tracking settings (Overland only; "Queued" while a
  preset waits) and Setup; then Rename; Issue new
  token — optionally to another app, which keeps the history — re-showing the
  setup; and Delete device (type the name to confirm), which goes back in the
  history to the list when the page was opened from it, so Back never leads to
  the gone device, and otherwise leaves the list in its place; focus goes to
  the list's title. A level deeper, a page each (`DevicePartPage`: its title
  and line from the tree, the way back named after the device, the document
  title "<part> · <device> · Devices · Settings"): **Uploads** (the ingest
  log, the latest 10 or all 50), **Raw points** (paginated, and "New points
  arrived" once the device uploaded after the list was loaded), **Tracking
  settings** (Overland's presets, queued for its next upload and delivered
  once; another app's address says that only Overland takes them) and
  **Setup** (for OwnTracks the phone it runs on and how an iPhone tracks; the
  connection without the token; the settings Trail recommends). A device that
  does not exist — deleted, here or in another tab, or someone else's — has a
  page that says so at each of its addresses.
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

Two places: the Launchway node runs the checks, and GitHub keeps what has to
stay there — building and publishing the image, publishing releases,
release-please, Dependabot and CodeQL (default setup, no workflow file).

**Checks on the Launchway node** (Launchway's
[ADR 0020](https://github.com/JensPenneman/launchway/blob/main/docs/adr/0020-checks-run-app-test-commands-on-the-node.md);
configured in Launchway under Trail → Settings → Checks, not in this
repository). For every push to `main` and every pull request into `main`
whose head is a branch of this repository, Dependabot's included, the node
runs each check in the development container (`.devcontainer/compose.yaml`:
`dev` and its `db`, §3) as a Compose project of its own, from a fresh copy of
the commit and empty module volumes, so every command starts with
`npm ci --no-audit --no-fund`:

| Commit status | Command after `npm ci` | Timeout |
|---|---|---|
| `launchway/quality` | `npm run check` (Biome, typecheck, knip, unit tests) | 25 min |
| `launchway/integration` | `npm run test:integration` (`TEST_DATABASE_URL` → `trail_test`) | 20 min |
| `launchway/e2e` | `npm run build && npm run test:e2e` (`E2E_DATABASE_URL` → `trail_e2e`, one worker) | 60 min |

Pull requests from forks get none: their code would run on the node. Every
run builds the development container's image (cached on the node), so a
change that breaks it fails all three. The containers get `CI=true`
(Playwright's `forbidOnly` and one retry) and Launchway's `LAUNCHWAY_*`
variables but none of the app's; each service is capped in memory, CPUs and
processes, and Vitest sizes its workers by the CPU quota (§16). The node runs
one check at a time, oldest first; a newer commit of a branch supersedes the
queued checks of older ones, and a push and a pull request of the same commit
run once. The GitHub App `launchway-for-jenspenneman-com` reports every run as
the commit status `launchway/<name>`: `pending` while it waits or runs,
`success` for exit code 0, `failure` for another exit code or the timeout,
`error` when there is no verdict on the code (the image build, the Compose
policy, the node offline, superseded, a full queue), with the time or the
reason as description and the run in Launchway as target URL. Its log stays
in Launchway for 30 days; nothing else outlives the run (no Playwright report
or traces).

**GitHub Actions** (`.github/workflows/ci.yml`: pushes to every branch, `v*`
tags, pull requests, Monday 03:00 UTC, manual runs):

- `image`: Buildx for `linux/amd64` and `linux/arm64` (the build stages on
  the runner's platform, no QEMU) with the GHA cache, BuildKit provenance
  (`mode=max`) and SBOM, and a signed GitHub attestation while the repository
  is public (§13.2). It pushes for pushes, tags, the schedule and manual runs
  and only builds for pull requests and Dependabot's branches. It does not
  wait for the checks: a preview has its image within minutes, also when its
  checks fail.
- `release-gate` (`v*` tags, beside `image`): lists the statuses of the
  tag's commit every 60 s for up to 300 minutes, since the release commit's
  checks queue behind those of other commits (the release pull request's,
  which release-please updates on every push to `main`, among them), and
  succeeds once the newest `launchway/quality`, `launchway/integration` and
  `launchway/e2e` statuses of the Launchway app (creator
  `launchway-for-jenspenneman-com[bot]`; the same names from anyone else count
  for nothing) are all `success`. A `failure` or an `error` stops it at once,
  since the node never runs a check again by itself, and so does the 300th
  minute. It reads the statuses' descriptions and links without control
  characters or line breaks and gives a verdict only on exactly one line per
  check; its token may only read statuses.
- `release` (`v*` tags, after `image` and `release-gate`): publishes the
  draft, or creates and publishes the release of a tag pushed by hand. When
  the gate fails, the release stays a draft, which Launchway does not deploy,
  though the version's images exist already. The tag's commit is the head of
  `main` (`scripts/release.sh` pushes both at once), so its checks are those
  of that push.

GitHub Actions cancels its superseded runs of pull requests and other
branches; its runs on `main` and tags always finish. Actions pinned by commit
SHA; per-job least-privilege permissions (`packages`, `id-token`,
`attestations` write only in `image`; `statuses: read` only in
`release-gate`; `contents: write` only in `release`, which runs for a
minute).
The weekly run only rebuilds the image: no tests run on a schedule.

**Map data** (`.github/workflows/mapdata.yml`; first version, from task 0 of
`docs/design/self-hosted-maps.md`): on dispatch with a `region` input (one
job per region of `scripts/mapdata/regions.json`, one build per region at a
time), and on Monaco for pull requests that change it or `scripts/mapdata/`,
it runs `scripts/mapdata/build.sh` on `ubuntu-24.04` with Ubuntu's
osmium-tool and Planetiler 0.10.2 (its jar pinned by SHA-256) on the runner
image's Temurin 21. The script fetches Planetiler's sources into a monthly
Actions cache (Natural Earth and the lake centrelines pinned by SHA-256, the
daily water polygons recorded only) and keeps the files of each region as
artefacts of the run for 14 days; a job may take 4 hours. Read-only token;
nothing is published yet: the GHCR push of the design's task 2 comes in a
job of its own that never runs for pull requests.

**Branch rules of `main`.** The ruleset "main protection" requires a pull
request (merge commits only) and, up to date with `main`, the status checks
`launchway/quality`, `launchway/integration` and `launchway/e2e` with the
Launchway GitHub App as their source, and `image` from GitHub Actions, besides
CodeQL's results; "main signatures" requires signed commits. A pull request
from a fork never gets the node's statuses: a maintainer reviews it, pushes
its branch to this repository and merges the pull request from there.

**Dependabot** (weekly, Monday 07:00 Europe/Brussels) for npm, GitHub Actions,
the Dockerfile digests (the image's and the development container's) and the
compose files, `.devcontainer/` included (only major tags change there;
majors never auto-merge). The npm groups: `security`
(`applies-to: security-updates`, every package; GitHub Actions has one too),
`biome` and `typescript` alone, the families (`vitest`, `playwright`,
`react`, …) and the catch-all `minor-and-patch` with the pattern `*`:
Dependabot gives a dependency to the group whose pattern names it most
precisely, and a group without patterns would take every dependency.
`dependabot-auto-merge.yml` only enables auto-merge (`gh pr merge --auto`):
GitHub then waits for the required checks of the branch rules, the node's
commit statuses included, before it merges. It does so for minor, patch and
digest updates, the `security` groups' included, except the `biome` and
`typescript` groups, which are merged by hand; majors wait for a person,
security ones too.

## 16. Testing

- `packages/contracts/tests` — schema and helper unit tests.
- `apps/api/tests/unit` — pure logic (Overland normalisation; OwnTracks' and
  the OsmAnd format's on messages built from the apps' sources
  (`tests/support/trackerSamples.ts` names the source of each), every field
  and unit — km/h, knots, m/s, percent, seconds against milliseconds, ISO
  with and without a zone — heartbeats, alarms, region events, ignored and
  rejected messages; the tokens of every scheme; the scrub of credentials and
  the redaction of URLs and error bodies; the setup links, decoded as the apps
  decode them; timestamps,
  RDP, distance, tile math and the heatmap's levels, whole-cell windows and
  the levels a device's totals call for rebuilding (those below the highest,
  level 18 included),
  token hashing, config parsing, the processing channel's messages, presets, share
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
  `@levischuck/tiny-cbor`). `owntracksIngest.test.ts` and
  `osmandIngest.test.ts` upload every app's real format (OwnTracks for Android
  and iOS, Traccar Client 10, 9 and the old Android client, OsmAnd, GPSLogger):
  the points, the device's position and battery, the ingest log with its
  `source`, heat cells, events, the dead letter while the upload is still
  acknowledged, resends stored once, 401 for missing and unknown tokens,
  Basic over plain HTTP refused, a token at another app's endpoint, body and
  parameter limits, the per-device limits (503 for OwnTracks, 429 for the
  OsmAnd format), one failed-token budget for every endpoint, and that no
  token or coordinate reaches the log or the database. `migrationUpgrade.test.ts` builds the schema of the
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
  `history.test.ts` holds the heatmap at every zoom from 0 to 18 (levels 6
  to 20) against the finest stored cells summed, several devices summed, a
  whole cell at the edge of the view, the antimeridian and the cap of 20 000
  cells; `heatLevels.test.ts` the start-up fill: nothing to do while the
  levels agree, level 20 built for the points from before it (an upload
  after the upgrade counted once), what an older release left behind after
  a rollback (its uploads, its rebuild) repaired, a stop after one device
  with the rest done at the next start, a stop while it waits for a
  device's lock (back at once, nothing kept), an upload that waits for the
  device's rebuild and counts once, and the levels that agree left alone.
  Processing is tested in the real app with map tiles cut from the hand-made
  world by a `FixtureWaySource` (no network): uploads to segments and the
  `segments` event, every level and its degradation, windows waiting for map
  data, old tiles fetched again, a window worked out the same in many pieces
  of map data as in one, ready times by the worker's clock, a deleted range
  repaired, the backfill across a restart, the v1 routes with sessions and
  tokens, `trail reprocess`, and a log that names tiles only at debug level.
  `processingTopology.test.ts` holds an API in role `api` and a worker
  (`createWorkerContext()`: the worker's side without the HTTP app) on one
  database: the API queues and works nothing out, the worker's pass reaches the
  API's stream through `NOTIFY`, the listener comes back after its backend is
  terminated and announces what it missed, and heartbeats are written, read
  and pruned. `workerProcess.test.ts` runs the entries as processes: `trail
  worker` lets a pass held in the middle of its transaction commit after
  SIGTERM, then exits 0; the server's entry serves no HTTP in role `worker` and
  starts no worker in role `api`.
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
  offered or asked for; the cards are people's (the Me card says what one is
  doing and holds the quick toggle, no device counts, no uploads), each with
  its Details disclosure (closed at first, `aria-expanded`, its content in
  the tab order once open) and, on the map, where they have been (Today in
  Live, a day back into History, a period, nothing recorded, the start of
  the history they share as the furthest step, Next day keeping its focus,
  each step announced, two devices said rather than added up); a coarse
  share's card says how coarse with an "≈" distance (`PersonCard.test`);
  a camera move of History is not made again after another view or day.
  `describeMe`, `latestOwnDevice`,
  `describeActivity` with and without a live position and
  `summarizePersonTrack` have unit tests, and so does the disclosure on its
  own. The page's URL (`parseMapSearch`, the updates in
  `mapSearchUpdates`, `resolveMapSelection`, `viewsFor` and `shownView`), the
  selection of a card (`selectionShowing`, `everyoneToggled`), the line about
  one's own sharing (`sharingSummary`), the old addresses (`legacyMapPath`,
  `legacyPeoplePath`, `legacyDevicesPath`, and the redirects through the
  app's own route table — the Devices page's rendered, its query and anchor
  kept and its entry replaced), Settings' tree (groups, paths, levels down to
  the parts of an item, administrators' rows, the devices' addresses), its
  search index (one's devices by name, app and device ID) and row values, the
  old anchors (`settingsPathFor`),
  `isSignedInPath`, the precedence of the map's defaults, the heatmap's
  scale, classes and squares (`heatHelpers.test.ts`) and where its layer
  goes in OpenFreeMap's two styles, their layers as served
  (`heatLayers.test.ts`: over every shape, under every name, Trail's lines
  where they were) have unit tests of their own; Settings itself renders through its real routes
  (`renderSettings`, phone or wide screen) for the list, search, going
  deeper and back with focus, and every page — Settings › Devices among them:
  its cards, each the way to its device and back with the focus on it, a
  device's page and the pages of its parts (a level deeper and back, the
  sidebar's row marked), a tracking page for an app that takes no presets, a
  device that does not exist, and deleting one opened from the list (back in
  the history, focus on the list's title) or by its address (the list in its
  place, nothing asked for the gone device). The charts' helpers (scales,
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
  Scenarios: sign-up and refusal, device setup and the live upload (in
  Settings › Devices: status, points, battery, trip, activity and the upload
  feed; on People the Me card), setting up OwnTracks (its links for both platforms
  and both ways an iPhone tracks decoded, the first uploads with Android's
  Basic and the iPhone's bearer header over the suite's http:// address, the
  device page and its setup), a device's page and the pages of its parts a
  level deeper (its uploads and raw points, remote settings, its setup, back
  with the focus on the row), token rotation, renaming, deleting (from the
  list: back in the history, Back not to the gone device), History and its
  scrubber,
  the heatmap (its squares on the map, found by their colours in a
  screenshot of the canvas, its key and the busiest places), sign-in by email,
  passkey button and autofill, invitations and
  isolation, passkeys and passkey links, sessions, export, deleting a period
  and the account, Overland's protocol, static files and headers, the API
  reference at `/docs` and the OpenAPI document, API tokens (create one in
  Settings, read the secret from the one-time screen, call
  `/api/v1/tokens/verify` with it, roll, revoke and see the old secrets
  refused; devices and an expiry date), the levels of the tracks and
  correcting a move's mode, the quick toggle (on the Me card, and the same
  device's on its page), sharing between two accounts
  in two browsers (Share my location from the home page, live updates,
  hiding, stopping in Settings › Sharing) and public links (opened signed
  out, turned off, too short, unknown), the People page's map (its three
  views on one map, Back through them, the old addresses and deep links, the
  device filter under Advanced across views, the map style — Auto following
  the system, a remembered choice, satellite imagery), the People page's
  people (three accounts: Me first as a person with one's day so far, a card
  per person
  with its devices and terms in Details; someone who shares roughly and live
  only, chosen alone, shows where they are and nothing of one's own — no
  Heat, levels, timeline, visits or trips — their card says "Shares live
  location only" and their history is never asked for; someone who shares
  their history shows their track and, on their card, where they have been
  today, a day back in History and forward again, until their share
  changes; Me again brings everything back; Show everyone; a card kept live
  by an upload; sharing back and stopping from a card's Details; a deep link
  to someone alone), Settings (the list with its values and search, on phones
  a page of its own and beside the page on wide screens, every page and the
  page of each kind of item — a device's and its four parts too —, a device
  found by its name, going deeper and back by address and through the
  history, the old anchors and addresses, the preferences the map opens
  with, the administrators' page), the navigation (People · Insights ·
  Settings, a tab bar on phones, the current item — Settings on the devices'
  pages —, focus on the new page's heading, `/people` leading home with its
  parameters, `/devices?add=1` and a device's old address leading into
  Settings in place of the old entry), Insights (a walk and a drive worked out by the server
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

The unit projects (the web app's, the API's `unit` and the contracts') hold
on a slow, CPU-limited machine as on this one: Launchway runs the checks in
containers limited to a few of a node's CPUs and 3 GiB, where the first
`quality` run let 17 jsdom page tests run past Vitest's 5 s. Vitest gives
`vitest run` a worker per CPU but one and counts the CPUs with
`os.availableParallelism()`, which sees a cgroup v2 quota but never a v1 one
(libuv looks for v1's files at a path that does not exist), so it started 11
workers for the node's 12 threads. `unitTestOptions()` in `vitest.shared.ts`
at the root reads the quota where a container sees its own cgroup —
`/sys/fs/cgroup/cpu.max` (`400000 100000` is 4 CPUs, `max 100000` none),
else `cpu.cfs_quota_us` over `cpu.cfs_period_us` of the v1 cpu controller, in
whole CPUs, at least one — and, below Node's count, sizes the pool from it by
the same rule (4 CPUs, 3 workers); without a quota Vitest's default stays.
Vitest's own `VITEST_MAX_WORKERS` overrides either, the integration project's
one file at a time included, so it is for unit runs only. A unit test may take
20 s and a hook 30 s, and Testing Library's `findBy…` and `waitFor` wait 15 s
(`apps/web/tests/setup.ts`), so a slow machine fails on a hang only; the
integration project keeps 30 s and 60 s. The web project follows Vitest's hint
for jsdom set up once per file (50 times, over a third of the tracked time):
`pool: 'vmThreads'` still gives every file a JSDOM and a module graph of its
own, in a VM context, but loads jsdom once per worker. On a busy M2 Pro
`npm run test -w @trail/web` takes 4.7 s instead of 8.4 s, and 7.0 s instead of
17.0 s with 3 workers as in such a check (medians of 5). `isolate: false` is
slower than that with the default pool and 14–21 % faster with 3 workers, but
it fails LoginPage and PeoplePageSelection tests in a shuffled file order, so
isolation stays. A vm worker starts afresh past 512 MiB of heap
(`vmMemoryLimit`; under 400 MB with this suite), which keeps three of them well
inside 3 GiB (1.9 GiB at the peak, 1.3 GiB with forks). `vitestShared.test.ts`
in the API's unit project covers reading the quota.

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
  inferred level's), `computed_at`. Unique `(device_id, started_at)`, indexes
  `(device_id, ended_at)` and `(computed_at)` (the listener's catch-up, §9).
  Stops and moves follow each other without overlap
  and share their boundary point — except after a stop that lasted beyond its
  last point (until a visit's departure, through a pause or a still gap), whose
  next move starts at the point after it; a recording gap the phone lay still
  through is a stop, one with travel lies outside every segment. A stop's
  `features` hold `spreadM`, how far apart its points lie, and `lastPointT`,
  when the last point of its own was recorded (§17.3).
- **mode_overrides** — user data, part of the migration-upgrade fingerprint:
  `id`, `device_id` (cascade), `kind` `segment|toggle`, `from_at`, `to_at`
  (null: until the first stop of ten minutes or more, or move of another kind
  of travel), `mode`, `source`
  `ui|api|mcp`, `created_by`
  (set null), `created_at`, `revoked_at` (rows are kept).
- **processing_queue** — PK `(device_id, from_at)`: `to_at`, `reason`
  (`ingest`, `delete`, `override`, `reprocess`, `catch-up`, `backfill`,
  `map`, `split`), `from_level` `averaged|mapped|inferred`, `priority` (0 new
  data from the phones, 1 repair — the rest but the backfill —, 2 the
  backfill; rows that 0.5 queued at 1 were its backfill and run as repair),
  `attempts`, `next_at`, `enqueued_at` (the version a finished pass compares
  against), `missing_tiles` (jsonb `["z/x/y", …]`: the window waits for map
  data), `last_error`.
- Map cache: **osm_tiles** PK `(z, x, y)` with `status` `ok|failed`,
  `fetched_at`, `way_count`, `poi_count`, `bytes`, `failures`, `retry_at`;
  **osm_ways** (`id` = OSM way id, `kind`, the kept `tags`, `nodes` bigint[],
  `geometry` jsonb `[[lon, lat], …]`, bounding box, `fetched_at`);
  **osm_tile_ways** `(z, x, y, way_id)`; **osm_pois** (`id` `n…|w…|r…`,
  `kind` `station|halt|tram_stop|subway_station|bus_stop|ferry_terminal|aerodrome`,
  `lat`, `lon`, `name`, the tile it came with).
- **processing_state** — key/value: `backfill` holds the versions the history
  was backfilled for, `{ "versions": { "averaged": 1, "mapped": 1, "inferred": 3 } }`
  (`{ "version": n }`, from before the levels had versions of their own, means
  n for every level).
- **processing_workers** — one row per worker process (§3), its heartbeat:
  `id` (host, process id, start time and a random tag), `started_at`,
  `last_seen_at` (the database's clock, refreshed every 15 s and at the stop),
  `version` (the release), `job_id` (the job it runs; null until jobs have ids),
  `passes` and `points` (since its start). No user data; rows unseen for an
  hour are pruned (§10).

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

**Stops and moves** (`detectStops`). A stop ends when the phone leaves, and
none holds travel. A stop is:

- a **dwell**: at least `PROCESSING_STOP_MIN_S` (180 s) within 60 m of its
  running centroid, moving points (over 0.5 m/s) at its edges trimmed. A real
  walk in it — 30 s or more faster than 0.6 m/s by the phone's own speed
  reading, averaged over 30 s (where the phone gave none, the averaged speed
  with CoreMotion on foot) — makes it two dwells when both last 180 s without
  it: the walk from the bike shed to the platform is a move — unless an iOS
  visit takes in both places: a visit's stop is not split at a walk, which
  stays inside it, drawn as the stop's path. A limit: without a visit, a fix
  wandering 30 m or more at a point every few seconds to a minute still
  breaks a stay into dwells with moves between them.
- an **iOS visit**. iOS reports a visit twice, on arrival (no departure yet)
  and on departure (the same arrival); both rows are kept as recorded, and
  `loadVisits` merges them per arrival before anything else — a report with a
  departure supersedes the arrival alone, the latest report wins among
  several — so a window after the departure never sees the arrival alone as
  a visit still open. The stop is the points near the visit's place (within
  max(150 m, accuracy), at most 300 m, so GPS drifting indoors stays one stay)
  from the arrival on, for as long as the phone stays. A short excursion does
  not end it — away for at most five minutes from its first point to its
  last, never two minutes on end farther than 300 m (a fix 350 m off now and
  then is no departure), and, while the departure is not known, without a
  recording gap of more than five minutes that could hide where the phone
  went — so with a point every five minutes one fix off between two at the
  place is no departure, and under a visit whose departure is known (iOS
  vouches for the stay until then) neither with a point every ten — nor
  does a recording pause the phone spent there. A visit whose departure is known
  gives a stop for every time the phone was there before it (and lasts until
  the departure when nothing was recorded after its last point: iOS pauses the
  updates of a phone lying still); one whose departure is not known — still
  open, or never reported — only the stay from its arrival on, which ends when
  the phone leaves, never at the end of the window, and at the latest at the
  next visit's arrival (a visit over before the window is not read at all).
  Its moving ends are trimmed, as a dwell's, and it must last 180 s with at
  least half of its points near the place (iOS reports a visit now and then
  mid-journey). A limit: a visit whose departure has not come yet, with no
  later visit, takes in a second place within its radius — next door, 120 m
  on — until iOS reports the departure, which ends the stay there.
- **CoreMotion** reporting stationary and nothing else throughout, within
  300 m of its centroid and at one place: a recording pause after which the
  phone is more than 300 m away ends it (it was carried there).
- a **still gap**: a recording gap of more than 30 minutes whose two ends lie
  within 300 m of each other — the phone lay there all along, so the gap is a
  stop of the point before it, lasting until the point after it, and the day
  stays covered. That point is where the phone woke up: 150 m on and riding,
  it starts the move.

Overlapping stops are one, and so are adjacent ones unless the phone jumped
more than 300 m between them. Stops at one place on both sides of a recording
pause (300 m), or within 80 m with at most five minutes of wandering seen
between them (from the first point away to the last; one fix however far it
jumped, more of them within 300 m — without speed readings, a ride to a shop
400 m away is no wander — and without a recording gap of more than five
minutes — one fix within 300 m between two at the place hides nothing) and
no real walk (as
above, or CoreMotion on foot for half a minute or more by the readings
themselves; one "walking" reading as the fix jumps is none), are one stop —
unless joined they would hold travel. A limit, and the way on: one fix far
off between two points minutes apart joins them however far it lies, so a
four-minute drive 1.2 km away with a point every three minutes and one fix
there disappears into the stop; a single far fix should be tolerated only
where the round trip it implies would be implausible (faster than 10 m/s).
No stop holds
travel: where two
minutes or more of its points lie farther than 300 m from its centroid, it is
cut there, the parts that still last 180 s stay stops, and so do the stays
found within the cut-out stretch on their own (a dwell 400 m away that a
visit's wide radius took in). After a pause of five minutes or more the stop
lasts until the first point outside it when that point is within 300 m (iOS
resumes outside its geofence); a point recorded alone after a stop's end —
the window's last, or a gap with travel after it — is the stop's when it lies
within 300 m, though not one of its own (it only says when the phone had
left). The checks keep a window linear: centroids come from prefix
sums, and a stop or a join whose bounding box lies within 300 m of its
centroid cannot hold travel, so its points are not looked at again. Moves fill the
time between stops and share their end points with them, except after a stop
that lasted beyond its last point (a visit's departure, a pause, a still
gap): the move starts at the point after it, where the phone resumed, and
the map bridges the way between with a connector (§17.6). A gap of more than
30 minutes ends a move unless the device travelled at 10 m/s or more
meanwhile (a flight, a train through tunnels); a gap with travel (its ends
more than 300 m apart) belongs to no segment. A stop keeps how far apart its
points lie, `features.spreadM` — the distance between the point farthest from
the centroid and the point farthest from that one, among its own points the
phone was still at (0.5 m/s or slower, unless it was at none: a fix jumping
off for a moment, or the point it resumed at riding, does not count) — and
when the last of its own was recorded, `features.lastPointT`.

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
  30 min) is queued as new data (a window with the same start widens the
  queued one), ready no sooner than 30 s after the device's last pass began
  and not before a window of the device that already waits for its turn
  (`livePassIntervalMs`); `POST /api/locations/delete` deletes the segments
  touching the range at once and queues the range ± 30 min, and all of the
  deleted segments' time (a long stop reaching far beyond the range leaves no
  hole), in its transaction, under the device's processing lock; deleting a
  device cascades. A time-zone change needs nothing (segments are UTC). The
  work has three priorities: new data from the phones (0); repair (1) — a
  deletion, a corrected mode, the catch-up, `trail reprocess`, the older part
  of an upload's window too big for one pass; the backfill (2).
- One worker (`ProcessingWorker`, the daily-statistics scheduler's pattern,
  reading the table), in the worker process or in the API's in role `all`
  (§3), wakes 3 s after new work queued in its own process, every 2 s while
  idle in a worker process, every minute for retries, when a window that
  waits for its device's pass interval comes due, and on a 15-minute pass.
  It takes the next ready window — new data
  oldest first, then repair and the backfill newest first, and after a pass
  of new data the backfill (else repair) gets the next turn, so a phone
  uploading every few minutes never starves them — with every ready window
  of the device that overlaps it (not one waiting for map tiles or a retry:
  it would be worked out again with every upload, before its tiles are
  there; and the backfill only with the backfill, so an upload's pass stays
  the size of the upload and a backfill day waits its turn).
- **Bounded passes.** A pass reads at most `PROCESSING_PASS_MAX_POINTS`
  (60 000) raw points, and the points it takes on span at most
  `PROCESSING_PASS_MAX_SPAN_HOURS` (36). Rows that hold more are split first,
  in the pass's own transaction (`splitJob`): their points are counted on the
  primary key, and the split falls at the end of the longest recording gap of
  more than 30 minutes — the night the phone slept through — among those that
  leave a newest part within the budget (the older of equal ones), else at
  the budget's point boundary, the newest 60 000 points or 36 hours. The pass
  goes on with the newest part; the older part is queued with the rows'
  reason and level — an upload's as repair (`split`), so a backlog of history
  never holds up the fresh points of other devices — and is split again when
  it is taken. The parts share the point at the split, so their segments
  meet. One upload's window over twelve days of a phone recording every
  second (575 000 points, 0.5.0) is so worked out in about ten passes of a
  few seconds, the newest first.
- The window then grows to whole segments at both edges, within the budget:
  the growth is taken while the window holds at most the budget's points —
  forward first (the segment the window's end runs into), then back, nearest
  first (the segment under the start, then the one before a gap, else the
  point before it) — each whole or not at all, so that a window is not cut
  again at another place with every upload. A segment that does not fit stays
  as it is, cut at the queued range's first or last point; a stale multi-day
  stop at an edge costs a pass at most the budget, never two days of it.
  Growth goes at most two days out of the range the rows were queued with: a
  segment reaching further back is cut at the first point within them, and
  the part of one reaching beyond its end stays as a segment from the
  window's last point, so no time drops out of the timeline. Cuts fall on
  points, so the parts meet the window; each part counts
  what it holds of its own — its points, distance, ends and middle, a stop's
  spread and last point — and keeps its mode until a window over it works it
  out again, and a part left by another version of the inference is queued
  for that at once, at low priority from the inferred level: a stale
  multi-day stop is replaced piece by piece even beyond the range `trail
  reprocess` was given. When no segment meets the window's start and a
  recording gap of more than 30 minutes lies before its first point — the
  night the phone slept through — it reaches back to the segment before the
  gap (or, with none yet, the point before it), so that the gap is worked out
  with both its ends whether the next morning came in an upload of its own or
  the backfill works a local day at a time; a shorter hole is no such gap. The
  point a window shares with a
  segment that began before it keeps its stored levels (that segment was
  worked out with it). Then, in one transaction under a per-device advisory
  lock, it reads the points, visits, trips and overrides, runs the pipeline
  with the cached map data of one piece at a time, replaces the window's
  processed points and
  segments and finishes the queue rows (only those that did not change
  meanwhile). It yields to the event loop between pieces and windows. A
  failure re-queues with backoff (30 s × 4ⁿ, at most 6 h). Moves without
  their tiles are stored unmapped and the window waits for them, as it does
  for tiles due for a refresh (`missing_tiles`, re-checked after a day at the
  latest) — with the bounds it was queued with, never the ones the pass grew
  it to: stored grown, each pass would grow it again from there, and a
  window queued for an upload crept back across days of history (0.5.0);
  tiles are fetched alongside, so a missing tile never holds up other
  windows. Ready times are kept to the millisecond, the worker's clock.
- **The pass interval.** When a pass of new data ends, a window of the device
  still queued — an upload came while it ran — waits until 30 s after the
  pass ended, and the uploads after it with it: a phone uploading every few
  seconds costs a pass per half minute, not one per upload. A flush (the
  tests, the CLI) does not wait for the interval.
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
  the stored mapped points and the cached map data, without map matching: a
  move whose points all have a stored mapping keeps it, and a move with a
  point that was part of a stop before (stops are not matched: no way kind)
  is matched with the cached map data, or waits for its tiles. So a change
  that turns points of stops into moves (inferred version 3: stops that end
  when the phone leaves) needs the inferred level alone.
- `trail reprocess [--device <id>] [--from <iso> --to <iso>] [--from-level
  averaged|mapped|inferred]` queues the range in day windows, then processes
  them itself with the map data already cached; tiles still missing are left
  to the server's fetcher.
- When a window is done, the owner's streams get `segments { deviceId, from,
  to }` through the processing channel (§9), whichever process worked it out
  (`trail reprocess` included), and from the API itself after a correction;
  an open dashboard refetches.
- Shutdown stops the worker: a window in progress finishes its transaction
  (`trail worker` waits up to 80 s for it, §11), map downloads are aborted.

### 17.5 Overrides (the person wins)

- `PUT /api/v1/segments/{id}/mode { mode }` stores a `segment` override for
  the move's span and sets `mode_user` at once (the same mode again changes
  nothing). `DELETE` revokes the override that set the segment (a toggle with
  it, for every move it covered), shows the inferred mode at once and queues
  the span for the inference again. A stop has no mode (409).
- `POST /api/v1/devices/{id}/mode { mode, until? }` is the quick toggle: a
  `toggle` override from now until `until`, the first detected stop of ten
  minutes or more (`toggleEndingStopS`: changing trains or waiting at the
  lights does not end it), or — after a stop that followed it — a move the
  inference reads as another kind of travel than the toggle's: on foot, by
  bike or by vehicle, the families `splitMove` cuts between (cycling home
  from the station ends a train toggle; a move without a kind, `stationary`
  or `unknown`, does not), whichever comes first. The first move a toggle
  reaches is its own, all its parts, whatever the inference reads in them: a
  ride read as a car for a stretch, or all the way, takes the toggle's bike,
  and so does the walk to the platform a train toggle was set at the
  entrance for. The toggle in force is the latest one with nothing that ends
  it since it began (`endsToggleSql`: the move's kind counts only with a stop
  of the device between the toggle and it). The same mode again changes nothing (but a new
  `until`); another mode ends the running toggle and starts a new one; `mode:
  null` ends it. `GET` on the same path answers the toggle in force and the
  current mode, which shares and links with details show too (§8.5).
- `applyOverrides` applies them in creation order, so a later one wins: a move
  inside an override's span takes its mode; one reaching beyond it is cut at
  the span's edges, the parts outside keep (and are scored for) the inferred
  mode. Leftovers shorter than 90 s join the corrected part, so an override
  still fits after recomputation moved the segment by a few seconds; an
  override covering less than 90 s of a move, and not most of it, leaves it
  alone. A toggle that began before the window gets the first stored stop of
  ten minutes or more, or move of another kind of travel after a stop, after
  it, which ends it, and whether any stop of the device came between it and
  the window — a window that starts at the ride home after a short wait (an
  upload half an hour into the ride) does not take that ride for the
  toggle's own. The applied override is in
  `features.override`
  (`{ id, kind, source }`); `GET /api/v1/stats/modes` counts the corrected
  segments.
- The three corrections need `locations:write` and `locations:read` together
  (their answers carry the segment, with its positions, or the current mode);
  `GET /api/v1/devices/{id}/mode` needs `locations:read`.

### 17.6 API and UI

`GET /api/v1/tracks?devices&from&to&level&maxPoints` (`locations:read`, ≤ 93
days) answers `{ level, availableLevel, from, to, simplified, segments }`;
a segment is `{ id, deviceId, kind, level, mode, modeInferred, modeUser,
confidence, needsReview, startedAt, endedAt, distanceM, centroid, spreadM,
points }` with points `[lon, lat, epochSeconds]` (the way's shape between
mapped points carries interpolated times). `raw`, `averaged` and `mapped`
give pieces of track (`kind: "track"`, split at gaps over ten minutes;
`centroid` and `spreadM` null); `inferred` gives the timeline's stops and
moves — a stop with its place (`centroid`), its spread (`spreadM`, as in the
timeline) and its own points, where the device went within it, served and
simplified like a move's — and points outside every segment as track.
Consecutive segments share their boundary point, unless a stop lasted beyond
its last point: the point the phone resumed at is the next move's only. Each
device is simplified to `maxPoints` with one RDP tolerance over its pieces
(their ends always kept); over 200 000 points a device's points are thinned
first, keeping the segments' ends. `GET
/api/v1/segments?devices&from&to&cursor&limit` (`locations:read`,
≤ 93 days, keyset pages of up to 1000) is the timeline (a stop with
`spreadM`, how far apart its points lie — derived from positions, so behind
the same scope), with `pending` while points of the range wait for processing. `GET /api/v1/stats/modes?devices&from&to`
(`history:read`, local days, ≤ 400) gives distance, time and segments per day,
device and mode. `/api/v1/locations` (owned by the token pull request) stays
raw-only, and `/stats/days` is not extended.

The dashboard calls these with its session (`apps/web/src/transport/`):
History and Live get the level `SegmentedControl` (Raw · Averaged · Mapped ·
Transport; `?level=` in the URL and remembered in `localStorage`, else the
account's preference, Transport by default) with a word on what is missing; at Transport the map draws stops
and moves in the mode colours (`--mode-*` tokens, apart from the device
colours, every mark ≥ 3:1) with a dashed outline for moves to review and a
legend. Nobody vanishes from the map: a stop is a dot at its place and, when
its `spreadM` is over 25 m (the walk within a station), its path dotted in
the stop colour; where a stop or move of a device starts after the last point
of the one before it — a recording gap, or the way a stop's phone went before
it resumed — more than 25 m away, a thin dashed connector bridges them
(points not processed yet are no part of the timeline and get none); the
legend names both when they are drawn. The day's
timeline shows a quiet "No data · 42 min" row between two segments of a
device more than a minute apart. A click on a segment — or "Details" in the
day's timeline list next to the visits and trips — opens its dialog: the mode
with its icon, "set by you", the confidence, average and top speed, distance
and duration, "Was this …?" for moves to review, Change mode and Reset to
detected; a stop's says how long it lasted, where, and, when it spread
(`spreadM` of the timeline's segment over 25 m), how far one moved within it.
Nothing changes at the other levels. The quick toggle (Now: Walk · Bike ·
Car · Bus · Train · Tram · Metro · Other · Auto) is on the Me card of People,
for the device that reported last — one's other devices keep the mode the
inference finds for them — and on each device's page for that device.
`segments` events refetch the tracks at their level, the timeline and the
current mode.

### 17.7 Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PROCESSING_ROLE` | `all` | `api`: this process queues and processes nothing; `worker`: it processes and serves no HTTP; `all`: both (§3) |
| `PROCESSING_ENABLED` | `true` | `false`: nothing is queued or processed; the derived tables stay as they are |
| `PROCESSING_OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Overpass interpreter for map data; set but empty: no map data (mapped degrades to averaged) |
| `PROCESSING_OVERPASS_DAILY_MB` | `300` | Map download budget per UTC day |
| `PROCESSING_OSM_TTL_DAYS` | `90` | Map tiles are refreshed after this many days |
| `PROCESSING_MAX_ACCURACY_M` | `150` | Points less accurate than this are left out from the averaged level on |
| `PROCESSING_STOP_MIN_S` | `180` | A stop lasts at least this long |
| `PROCESSING_PASS_MAX_POINTS` | `60000` | A pass reads at most this many raw points (at least 1 000): a bigger job is split first, and growth to whole segments stops at it (§17.4). A very large value restores unbounded passes |
| `PROCESSING_PASS_MAX_SPAN_HOURS` | `36` | The points a pass takes on span at most this long (1 hour or more); its growth adds at most two days at each end |
