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
  (`"@biomejs/biome": "2.5.15"`, no caret): it treats minor releases as rule
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
lockfile, so the lockfile's integrity covers the package; Playwright then
verifies its own download per version: the Chromium build its
`browsers.json` names, of the size the server announces (it checks no hash,
and none is published). CI builds the image whenever `.devcontainer/`,
`package-lock.json` or `ci.yml` change (§15).

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
| `INGEST_BASE_URL` | `PUBLIC_URL` | Base URL shown to phones; endpoint = `<base>/api/overland` |
| `SIGNUP_ALLOWLIST` | empty | Emails (or `*@domain`) that may create an account without an invite |
| `TRUST_PROXY` | `false` (nobody) | Express `trust proxy`: the proxies whose `X-Forwarded-For`/`-Proto` decide client address and HTTPS; `deploy/compose.yaml` defaults to Launchway's edge, `10.210.0.2` (§12) |
| `SESSION_TTL_DAYS` | `30` | Sliding session lifetime |
| `LIVE_WINDOW_MINUTES` | `15` | "live" status window |
| `STALE_AFTER_HOURS` | `12` | "stale" status + silent-device alert threshold; also how old the position of a live-only share may be (§8.5) |
| `ALERT_NTFY_URL` | empty | ntfy topic URL for silent/recovered device alerts; empty = off |
| `ALERT_NTFY_TOKEN` | empty | Optional ntfy access token |
| `DEFAULT_TIMEZONE` | `Europe/Brussels` | Time zone of new accounts |
| `MAP_STYLE_LIGHT` | `https://tiles.openfreemap.org/styles/liberty` | MapLibre style URL |
| `MAP_STYLE_DARK` | `https://tiles.openfreemap.org/styles/dark` | MapLibre style URL |
| `MAP_CONNECT_SRC` | `https://tiles.openfreemap.org` | Extra CSP `connect-src`/`img-src` origins for the map (comma-separated) |
| `WEB_DIST_DIR` | `apps/web/dist` (`../../web/dist` from the bundle in `apps/api/dist`) | Built SPA to serve; missing `index.html` = API only |
| `LOG_LEVEL` | `info` | pino level |
| `APP_VERSION`, `GIT_SHA`, `BUILD_TIME` | root package.json version / `dev` / null | Baked into the image by the Dockerfile |
| `RATE_LIMIT_AUTH_PER_MINUTE` | `20` | Auth routes, per IP (§12) |
| `RATE_LIMIT_API_PER_MINUTE` | `600` | Every other `/api` request (dashboard and v1) and `/docs`, per IP |
| `RATE_LIMIT_INGEST_PER_MINUTE` | `300` | Accepted uploads, per device token |
| `RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES` | `30` | Uploads with an unknown token, per IP |
| `RATE_LIMIT_TOKEN_PER_MINUTE` | `600` | `/api/v1` requests with a valid API token, per token (§8.3) |
| `RATE_LIMIT_TOKEN_FAILED_PER_10_MINUTES` | `30` | `/api/v1` requests with an invalid API token, per IP |
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
`created_at`, `updated_at`.

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
  `__Host-trail_session` (`Secure; HttpOnly; SameSite=Lax; Path=/`) on HTTPS,
  or `trail_session` (no `Secure`) on plain-HTTP localhost. DB keeps only the
  SHA-256. Sliding expiry `SESSION_TTL_DAYS`; `last_seen_at` updated at most
  every 5 min (the cookie is re-sent then). Logout deletes the row. On HTTPS
  only the `__Host-` cookie is read, on HTTP only the plain one; an unknown or
  expired cookie is cleared.
- **CSRF.** Cookie-authenticated unsafe methods require an allowed `Origin`
  header (and `Sec-Fetch-Site` `same-origin` when present) and a JSON body
  where there is one. The ingest route is exempt (bearer token, no cookies),
  and so are `/api/v1` requests with an API token.
- **Principals.** Every request has at most one: a session (cookie) or, on
  `/api/v1` only, an API token. Routes ask for `requireAuth` (either),
  `requireSession` (sessions, passkeys, live events, device credentials,
  account deletion) or `requireAdmin` (an administrator's session); §8.3 has
  the details.
- **Passkey links** (one-time, 15 min): Settings → "Add a passkey on another
  device or address" (`POST /api/me/passkey-links {origin?}`), and the CLI
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
| `GET/PATCH/DELETE /api/me` | cookie | `sessionResponse` / `updateMeRequest` / `deleteAccountRequest` |
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
   request never reads the cookie.
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
`history:read`, `people:read`, `shares:read`, `shares:write`. A route lists the
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
coordinates: trips, daily statistics and activity.

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
`transportRoutes`, `historyRoutes`), and `apps/api/src/v1/v1Routes.ts`
aggregates the groups — one line per feature — plus the document's own route.
The spec:

| Field | Meaning |
|---|---|
| `method`, `path` | `"get" \| "post" \| "put" \| "patch" \| "delete"`; an OpenAPI path template under `/api/v1/` with `{param}`s, converted to Express's `:param` (`toExpressPath`; any other brace, colon, `*`, `?`, `(` … is refused) |
| `operationId` | unique, lowerCamelCase (`getDevice`) |
| `summary`, `description` | a few words for the sidebar; Markdown, to which the document appends who may call the route |
| `tags` | names from `v1Tags.ts` |
| `auth` | `"public"` (no session is loaded, no body accepted: the handler sees a token's principal or none); `"token"`, any API token whatever its scopes, for operations about the calling token itself (a session gets 400 `bad_request`); or `{ scopes: [...] }` (any one grants access) / `{ scopes: [...], all: true }` |
| `request` | optional zod schemas: `params` (one key per path parameter; a value that fails it answers 404 — it names nothing), `query` (values are strings: coerce in the schema; failure 400 `validation_failed` with `fields`), `body` (JSON; not JSON 415, invalid 400) |
| `responses` | the body schema of each success status (`200`, `201`, `202`, `204`); `null` for no body |
| `errors` | error statuses beyond the implied ones (401, 403 and 503 for scoped routes; 400, 401 and 503 for token routes; 404 with path parameters, 400 with a query or body, 413 and 415 with a body, 429 and 500 always), e.g. `[409]` |

The handler receives `{ ctx, auth, params, query, body, req }`, typed from the
spec — `auth` is non-null on scoped routes and a `TokenPrincipal` on token
routes, absent parts are `undefined` — and
returns `{ status, body, headers? }` with a status the spec lists; the type
checker enforces both. The body goes out through that status's schema, so
fields the schema does not name are dropped and a mismatch is a logged 500.
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
  `:read` scope, Agent = those and `locations:write`, Full access = all.
  `GET /api/v1/tokens/verify` (`auth: "token"`) lets a token describe itself.
- **Audit**: `API token created`, `changed`, `rolled` and `revoked` at info,
  with the token's and the user's id (and the scopes or the changed fields),
  never the secret.
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
through the people routes, the live events and the public link endpoint only;
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
it. Accepted: starting a share tells the owner whether the address has an
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
request counts as a view at most once a minute per link. `/s` and
`/api/public/share` send `Referrer-Policy: no-referrer` and `X-Robots-Tag:
noindex, nofollow`.

**Lifecycle.** Stopped and ended shares and links are pruned 30 days later
(§10); `hidden_people` rows stay until the person is shown again or one of the
two accounts goes. Deleting a device takes it out of the owner's shares and
links (a share of only that device then shows none; it never widens to every
device) and tells their recipients; deleting an account removes its shares in
both directions and its links and tells the other sides. Live updates: §9.

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
and is not hidden. An owner's shares come from a per-process cache
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
  shares and share links (> 30 days); prune `ingest_log` (> 90 d). Recorded
  data — locations, visits, trips, events, rejects — is never pruned.
- debounced (10 s) — daily-stats recomputation per touched (device, day), in
  the owner's time zone at run time; a failed pass is retried with the next.
  Changing the time zone (`PATCH /api/me`) rebuilds every day of the user's
  devices in the background.
- the processing worker (§17.4) — 3 s after new work, every minute for
  retries and every 15 minutes for windows waiting on map data and lost
  windows; the boot-time backfill when the algorithms' version changed; map
  tiles fetched alongside, within the daily budget.
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
  frame-ancestors 'none'` (+ `upgrade-insecure-requests` on HTTPS). No inline
  scripts or styles in HTML; CSSOM style changes (React `style`, MapLibre) are
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
  the visitor's session cookie (which is `SameSite=Lax` and never sent with a
  credential-less request either).
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
- Database statements time out after 120 s; deleting a device or an account
  and rebuilding derived data lift that limit for their own transaction.
- Body limits: 100 kB default, 5 MB on the ingest route.
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
  pending daily statistics and background work (≤ 2 s each), close the pool.
  A hung shutdown exits after 13 s, so the container's stop grace period
  should be at least 15 s.
- Tokens (device, session, invite, link, API, share link) are stored hashed
  only, and each secret is shown once. API token and share link secrets are
  shape-checked before any lookup and never logged; API token secrets are only
  ever accepted in the `Authorization` header of `/api/v1`, in the Bearer
  scheme (another scheme there is no credential at all). An API token does
  what its scopes allow, with its devices, from its addresses, until it
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
vector styles, light/dark from `/api/config`), `@simplewebauthn/browser`,
`uqr` for QR codes. Plain CSS with custom properties (LCH colours with sRGB
fallbacks), system font stack, no web fonts, no third-party scripts, CSP-clean.

Routes: `/login`, `/invite/:token`, `/link/:token`, `/s` (public; the link's
secret is the fragment, `/s#trls_…`); `/`
Live, `/history`, `/explore`, `/people`, `/devices`, `/devices/:id`, `/settings`
(signed in); 404.

- **Live** — map with every device's latest position (accuracy circle,
  pulsing when live) and today's tracks; device cards: status badge
  (`deviceStatus()`), last upload ("2 min ago", ticking), battery, speed /
  motion, current trip, points today, 48 h activity sparkline, the quick
  toggle of the transport mode (§17.6); live feed of uploads from SSE. This
  is the "data still comes in" proof screen.
- **History** — pick a day (prev/next, calendar with days that have data from
  `/api/stats/days`) or a range ≤ 93 days; device filter; tracks per device
  at a level (Raw · Averaged · Mapped · Transport, §17.6), stops and moves in
  their modes' colours with a legend; time scrubber showing the position at a
  moment; distance, points, first/last; the timeline of stops and moves, with
  a dialog to correct a mode; visits and trips of the day.
- **Explore** — all-time heatmap (`/api/heatmap`, refetch on move), totals.
- **Devices** — list; "Add device" flow: name → big QR of `setupUrl` ("scan
  with the iPhone camera, Overland opens with everything filled in"), "Open in
  Overland" button (on the phone itself), manual values with copy buttons,
  recommended Overland settings, then "Waiting for the first upload…" that
  turns into a success state via SSE. Device page: status, ingest log, raw
  points (paginated), remote settings preset, rotate token (re-shows the QR),
  rename, alerts toggle, delete (type the name to confirm).
- **People** — Find My for Trail (§8.5): a map of everyone who shares with
  you, each person as their initials in their colour (`personPalette`, a
  second ring beside the device colours, assigned in the order they started
  sharing), and a card per person (`PersonCard`): the shared devices, how
  fresh their position is, what they are doing (`describeActivity`, which
  takes the inferred mode when there is one), battery, distance; Show on map,
  Apple Maps and Google Maps links, Share back, Hide. Hidden people can be
  shown again. "You share with" (`OutgoingShareList`) lists status, devices,
  precision, history, details, expiry and the last look, with Change and Stop
  — and, when someone signed up with the address of a pending share,
  "<name> (<address>) joined Trail — confirm?" with Confirm and Cancel.
  **Share my location** (`ShareDialog`): address (with the people who share
  with you as suggestions), devices, precision with plain-language
  explanations, history (precise only), details, duration; a pending address
  gets "They will see you once they sign up and you confirm", an
  administrator a one-click invitation to that address (which skips the
  confirmation). `person` and `share` events keep it all live.
- **Settings** — profile (name, time zone), passkeys (list with provider,
  add, rename, delete), sessions (revoke), "add a passkey on another device
  or address" (link + QR), API tokens (list with hint, scope chips, devices,
  addresses, expiry, last use and status; create with a name, a template —
  Read-only, Agent, Full access — that fills in the scope checkboxes, all or
  some devices, an expiry of 30 or 90 days, a year, a date or never (with a
  warning) and an optional address allowlist; the secret shown once with a
  copy button, the dialog closing only with "I have saved it"; roll and revoke
  after a confirmation; a link to `/docs`), sharing (make public links — the
  address once, with a QR code —, their views and Turn off; the outgoing
  shares), people (admins: invites, users), data (export GeoJSON/GPX/CSV,
  delete a range, delete account), about (version, commit, build time).
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
  holds a dense day of 21 000 points to its CPU budget.
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
  The migration-upgrade test also records rows in the user-data tables that
  later migrations add (`api_tokens`, `mode_overrides`, and `shares`,
  `share_links`, `hidden_people` and the grid key of sharing), each with the
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
  and the access log.
- `apps/web/tests` — Vitest + Testing Library (jsdom).
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
  an uncaught exception or a CSP violation; map styles are stubbed, other
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
  in two browsers (live updates, hiding, stopping) and public links (opened
  signed out, turned off, too short, unknown), axe (WCAG 2.0 A–AAA, 2.1/2.2
  AA, best practices), keyboard use and 320 px screens. The suite's server
  has no map data (`PROCESSING_OVERPASS_URL` empty), so the mapped level
  degrades to averaged there.

## 17. Processing and transport inference

Trail works out how a device travelled from the recorded points, in four
levels of calculation, each built on the one before. Recorded data is never
changed: everything below is derived, carries the algorithm version
(`processingVersion`, `apps/api/src/processing/processingVersion.ts`) and can
be rebuilt with `trail reprocess`. The stages are pure functions over plain
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
  the move's previous point, both ends excluded), `version`, `processed_at`.
- **segments** — `id` (uuidv7, kept while a segment keeps its start),
  `device_id` → devices (cascade), `started_at`, `ended_at`, `kind`
  `stop|move`, `mode` (the one that counts: `mode_user`, else
  `mode_inferred`; null for stops), `mode_inferred`, `mode_user`,
  `confidence`, `review` (the inference was unsure; `needsReview` = review and
  no `mode_user`), `distance_m`, `duration_s`, `max_speed`, `point_count`,
  start, end and centroid lat/lon, `features` (jsonb), `version`,
  `computed_at`. Unique `(device_id, started_at)`, index
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
- **processing_state** — key/value: the version the history was backfilled for.

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
foot, ferry, none) and near tram tracks, cycleways and footways (they run
beside roads), the corridor ratio (samples every 250 m along the straight
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
the stops passed) + 0.3 × road share); car = (speed + CoreMotion automotive
+ road and motorway shares), damped off roads, by bus or tram stop pauses, by
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

- After an upload's commit its window (earliest new point − 30 min, latest
  + 30 min) is queued (a window with the same start widens the queued one);
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
- When `processingVersion` differs from the one in `processing_state`, the
  worker's start queues every day with points of every device (from
  `daily_stats`, in the owner's time zone) at low priority and records the
  version in the same transaction: the backfill runs once per version and
  resumes after a restart, because the queue is a table.
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
Transport; `?level=` in the URL and remembered in `localStorage`, Transport
by default) with a word on what is missing; at Transport the map draws stops
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
