# Trail — architecture

Trail is a self-hosted location history for the iOS app
[Overland](https://github.com/aaronpk/Overland-iOS). Phones post GPS batches to
the API; people sign in with passkeys and see where their devices are, where
they have been, and proof that data keeps arriving.

- One person owns many devices; many people can share one server.
- Everything runs as Docker containers on a home server (a Windows laptop with
  Docker Desktop), updated automatically from GitHub via GHCR + Watchtower.
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
├── docs/               this file, operations docs
├── scripts/            repo tooling (dev, build, hooks, db init)
├── tests/e2e/          Playwright end-to-end suite (whole stack)
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
  pre-push: unit tests), **Conventional Commits**.
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

### Production (Windows laptop, Docker Desktop / WSL2)

```
iPhone (Overland) ─┐
Browser ───────────┼─▶ Cloudflare Tunnel (cloudflared)  ─┐
                   └─▶ or: router :443 → Caddy (Let's Encrypt) ─┼─▶ app :8080 ──▶ db (postgres:18-alpine)
LAN (before the domain is live): http://<laptop-ip>:8080 ─┘            │
                                                             backup ──┘ (pg_dump → host folder)
watchtower: polls GHCR every 5 min, recreates app/cloudflared/caddy/db with new images
```

`deploy/compose.yaml` services: `app` (GHCR image), `db`, `backup`,
`watchtower`, and exposure profiles `tunnel` (cloudflared) and `direct`
(Caddy + Cloudflare DDNS). See §13.

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
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Express `trust proxy` (reverse proxy / tunnel on the Docker network) |
| `SESSION_TTL_DAYS` | `30` | Sliding session lifetime |
| `LIVE_WINDOW_MINUTES` | `15` | "live" status window |
| `STALE_AFTER_HOURS` | `12` | "stale" status + silent-device alert threshold |
| `ALERT_NTFY_URL` | empty | ntfy topic URL for silent/recovered device alerts; empty = off |
| `ALERT_NTFY_TOKEN` | empty | Optional ntfy access token |
| `DEFAULT_TIMEZONE` | `Europe/Brussels` | Time zone of new accounts |
| `MAP_STYLE_LIGHT` | `https://tiles.openfreemap.org/styles/liberty` | MapLibre style URL |
| `MAP_STYLE_DARK` | `https://tiles.openfreemap.org/styles/dark` | MapLibre style URL |
| `MAP_CONNECT_SRC` | `https://tiles.openfreemap.org` | Extra CSP `connect-src`/`img-src` origins for the map (comma-separated) |
| `WEB_DIST_DIR` | `../web/dist` relative to the API bundle | Built SPA to serve; missing dir = API only |
| `LOG_LEVEL` | `info` | pino level |
| `APP_VERSION`, `GIT_SHA`, `BUILD_TIME` | from package.json / `dev` / null | Baked into the image by the Dockerfile |

Development safety: when `NODE_ENV !== "production"` the API refuses to start
(or migrate) against a database whose name does not start with `trail`.

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
`record` (jsonb). Retention 30 days.

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
  `±HHMM`, optional fractions. Reject anything else.
- Invalid-value sentinels are negative numbers: `speed`, `course`,
  `*_accuracy`, `battery_level` < 0 → null; `vertical_accuracy` < 0 → altitude
  null too. Coordinates truncated to 7 decimals by the app.
- `GET /api/overland` with a valid token → `{"name": "<device name>"}` (Overland
  account-info probe; also a handy connectivity test).

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
  0,0, unparseable timestamp, timestamp > now + 24 h) → stored in
  `ingest_rejects` with a reason; the batch is still acknowledged so the
  phone's queue never gets stuck on one bad record.
- Database unavailable → `503 {"error":"Server temporarily unavailable"}` so
  the phone keeps the data and retries.

### 6.2 Processing (one transaction)

1. Insert locations (`ON CONFLICT DO NOTHING RETURNING`) + upsert heat cells;
   insert visits / trips / events (`ON CONFLICT DO NOTHING`); insert rejects.
2. Update the device: `last_seen_at = now()`, `points_total += inserted`,
   latest position from the newest record if newer than the cached one; if
   `current` is present and newer, use it for the cached position (not stored
   as a point — it arrives later in a batch), battery from the newest record,
   `live_trip` from the payload's `trip` (null when absent).
3. Insert the `ingest_log` row.
4. Respond `{"result":"ok"}` (plus `set` when a preset is pending, §6.3).
5. After commit: publish SSE events (`ingest`, `device`), schedule
   daily-stats recomputation for touched days, and if `stale_alerted_at` was
   set send the "sending data again" alert and clear it.

### 6.3 Remote settings presets

`devices.pending_settings` (one of `balanced | high-resolution |
battery-saver`, contracts `remoteSettings.ts`) is sent once as `set` in the
next ok-response, then cleared and `settings_applied_at` stamped. Mapping
(Overland value vocabularies from its README; never `send_interval: "off"` or
`tracking_mode: "off"`):

- **balanced** — `send_interval "5m"`; main: `tracking_mode "standard"`,
  `visit_tracking true`, `desired_accuracy "100m"`, `activity_type "other"`,
  `pause_automatically true`, `resume_with_geofence "200m"`,
  `logging_mode "all"`, `batch_size 200`, `min_distance "10m"`,
  `min_time "5s"`.
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
    `attestationType: "none"`, default algorithms incl. Ed25519/ES256/RS256);
  - otherwise → `403 signup_not_allowed`.
- **Usernameless** `POST /api/auth/passkey` → discoverable request options
  (empty allowCredentials) for conditional UI (autofill) and "Use a passkey".
- **Finish** `POST /api/auth/finish {ceremonyId, response}` → verifies with
  `expectedOrigin` = ceremony origin, `expectedRPID` = ceremony RP ID,
  `requireUserVerification: true`; registration creates user (+ admin if
  first) + passkey in one transaction and consumes the invite; authentication
  checks the credential belongs to the user (targeted) or resolves the user
  from the credential (discoverable), updates `counter`/`last_used_at`. Then
  creates a session and sets the cookie. A credential the server does not know
  (deleted passkey) → `401 unknown_credential`, so the client can call the
  WebAuthn Signal API (`signalUnknownCredential`) and the password manager
  forgets it.
- **Ceremonies** expire after 5 min, are single use, bound to origin + RP ID.
- **Sessions.** Token = 32 random bytes base64url in cookie
  `__Host-trail_session` (`Secure; HttpOnly; SameSite=Lax; Path=/`) on HTTPS,
  or `trail_session` (no `Secure`) on plain-HTTP localhost. DB keeps only the
  SHA-256. Sliding expiry `SESSION_TTL_DAYS`; `last_seen_at` updated at most
  every 5 min. Logout deletes the row.
- **CSRF.** Cookie-authenticated unsafe methods require an allowed `Origin`
  header (and `Sec-Fetch-Site` `same-origin` when present) and a JSON body
  where there is one. The ingest route is exempt (bearer token, no cookies).
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
no-store` unless stated.

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

Ownership: every device-scoped query is filtered by the session user's
devices; a foreign or unknown id is `404 not_found` (never 403, no probing).

### 8.1 Tracks, distance, simplification

- Points in `[from, to)` with `horizontal_accuracy <= maxAccuracy` (or null),
  ordered by `recorded_at`, split into segments with `trackSegments()`
  (contracts: gap > 600 s), simplified with Ramer–Douglas–Peucker on a local
  equirectangular projection (metres), binary-searching one tolerance so the
  whole track fits `maxPoints`; segment end points are always kept.
- `distanceM`: haversine over the unsimplified filtered points with jitter
  suppression — accumulate from an anchor point, count a step only when it
  exceeds `max(15 m, (acc_anchor + acc_point) / 2)`, and skip glitches implying
  more than 350 m/s. `daily_stats.distance_m` uses the same function (with
  `maxAccuracy` 100 m).

### 8.2 Heatmap

Pick `cellZoom` = the largest level in {6, 9, 12, 15, 18} that is
`≤ round(zoom) + 5` (minimum 6); return cell centres in the bbox (handle the
antimeridian when `west > east`) summed across the requested devices, at most
20 000 cells (highest counts first, `truncated: true`).

## 9. Live updates (SSE)

`GET /api/events` — `text/event-stream`, `Cache-Control: no-store`,
`X-Accel-Buffering: no`, never compressed, `: ping` every 20 s (proxies drop
idle streams after ~100 s). In-process event bus keyed by user id (the app is a
single instance). At most 10 streams per user. The web app replaces device
cache entries from `device` events and appends `ingest.points` to today's
track.

## 10. Background jobs (in-process, single instance)

- every 5 min — silent-device check: alerts-enabled devices whose
  `last_seen_at` is older than `STALE_AFTER_HOURS` and not yet alerted → ntfy
  message ("<device> has sent nothing for 12 h — last upload …"), stamp
  `stale_alerted_at`. Recovery alert when data resumes (§6.2).
- hourly — delete expired sessions, ceremonies, links, invites (used/expired
  > 30 days); prune `ingest_log` (> 90 d) and `ingest_rejects` (> 30 d).
- debounced — daily-stats recomputation per touched (device, day).
Jobs must never crash the process; failures are logged.

## 11. CLI

`apps/api/src/cli.ts` (bundled to `dist/cli.mjs`; `/usr/local/bin/trail` in
the image, so `docker compose exec app trail <command>`):

- `migrate` — apply migrations (also done at boot)
- `passkey-link <email> [--origin <url>]` — one-time URL to add a passkey (recovery)
- `invite [--email <email>] [--days <n>]` — invite URL
- `users` — list accounts
- `recompute [--device <id>]` — rebuild heat cells + daily stats
- `prune` — run the retention cleanup now

## 12. Security

- helmet: CSP `default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data: blob: <map origins>; connect-src 'self' <map origins>;
  worker-src 'self' blob:; child-src 'self' blob:; font-src 'self';
  manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self';
  frame-ancestors 'none'` (+ `upgrade-insecure-requests` on HTTPS). No inline
  scripts or styles in HTML; CSSOM style changes (React `style`, MapLibre) are
  allowed by CSP. HSTS (2 years, includeSubDomains) on HTTPS only.
  `Referrer-Policy: same-origin`, `Permissions-Policy` denying everything
  except `publickey-credentials-get/create=(self)`, COOP `same-origin`, CORP
  `same-origin`, `Origin-Agent-Cluster: ?1`, `X-Content-Type-Options: nosniff`.
- `trust proxy` from `TRUST_PROXY`; client IP from `X-Forwarded-For` of trusted
  hops (Cloudflare adds `CF-Connecting-IP`, Caddy `X-Forwarded-For`).
- Rate limits: auth routes ~20/min/IP; ingest ~300/min/token and ~30 failed
  tokens/10 min/IP; everything else ~600/min/IP. `429 rate_limited`.
- Body limits: 100 kB default, 5 MB on the ingest route.
- pino-http redacts `authorization`, `cookie`, `set-cookie` and token query
  params; coordinates are never logged above `debug`.
- Tokens (device, session, invite, link) are stored hashed only.
- The container runs as the unprivileged `node` user on a read-only root
  filesystem (`tmpfs /tmp`), `no-new-privileges`, all capabilities dropped.
- Postgres is not published outside the Docker network in production.

## 13. Deployment

### 13.1 Image

`Dockerfile` (repo root), multi-stage; build stages run on `$BUILDPLATFORM`
(pure JS, no native modules) so the multi-arch image (`linux/amd64`,
`linux/arm64`) needs no emulation. Runtime: `node:lts-alpine` (digest-pinned,
Dependabot keeps it current), production `node_modules` of the API only,
`apps/api/dist`, `apps/api/drizzle`, `apps/web/dist`; `USER node`;
`EXPOSE 8080`; `HEALTHCHECK` on `/api/health/live`; OCI labels
(`org.opencontainers.image.source` links the GHCR package to the repo);
build args `APP_VERSION`, `GIT_SHA`, `BUILD_TIME` → env.

### 13.2 Updates

GitHub Actions: on every push to `main` (after lint/typecheck/unit/
integration/E2E pass) build and push `ghcr.io/jenspenneman/trail` tags
`latest`, `sha-<short>`, `main` with provenance + SBOM attestations; a weekly
scheduled rebuild picks up base-image patches. On the server, Watchtower
(`nickfedor/watchtower`, the maintained fork — `containrrr/watchtower` was
archived in Dec 2025 and breaks on Docker ≥ 29) polls every 5 min with
`--label-enable`, `--cleanup`, `--rolling-restart`; only containers labelled
`com.centurylinklabs.watchtower.enable=true` update. The app migrates the
database on boot. Rollback = pin `TRAIL_IMAGE_TAG=sha-<short>` in
`deploy/.env` and `docker compose up -d`.

### 13.3 Exposure (when the data flow is stable)

- `tunnel` profile (recommended, zero router config, works behind CGNAT and if
  the laptop moves): `cloudflare/cloudflared` with a remotely-managed tunnel
  token; public hostname `trail.jenspenneman.com` → `http://app:8080`. Needs
  Universal SSL enabled on the zone (currently off because the zone is
  DNS-only; Cloudflare then adds its own CAA records). TLS terminates at
  Cloudflare.
- `direct` profile (end-to-end TLS, no third party in the path): Caddy
  (`caddy:2-alpine`, Let's Encrypt via TLS-ALPN, CAA already allows
  `letsencrypt.org`) on host ports 80/443 + `favonia/cloudflare-ddns` keeping
  the DNS-only `trail` A record on the home IP. Needs a router port-forward and
  NAT loopback (or a local DNS override) at home.

Before either is live, phones on the home Wi-Fi can post to
`http://<laptop-ip>:8080/api/overland` (Overland allows plain HTTP) and the
dashboard works at `http://localhost:8080` on the laptop itself (WebAuthn
needs a secure context: HTTPS or localhost — never a bare LAN IP).

### 13.4 Backups

`backup` service (same Postgres image): `pg_dump -Fc` daily to a host folder
(`BACKUP_DIR`, e.g. a OneDrive folder for an off-site copy), keeps
`BACKUP_KEEP_DAYS` (14). Restore with `pg_restore --clean --if-exists`.

## 14. Web app

React 19 + React Router 8 + TanStack Query 5 + MapLibre GL 6 (OpenFreeMap
vector styles, light/dark from `/api/config`), `@simplewebauthn/browser`,
`uqr` for QR codes. Plain CSS with custom properties (LCH colours with sRGB
fallbacks), system font stack, no web fonts, no third-party scripts, CSP-clean.

Routes: `/login`, `/invite/:token`, `/link/:token` (public); `/` Live,
`/history`, `/explore`, `/devices`, `/devices/:id`, `/settings` (signed in);
404.

- **Live** — map with every device's latest position (accuracy circle,
  pulsing when live) and today's tracks; device cards: status badge
  (`deviceStatus()`), last upload ("2 min ago", ticking), battery, speed /
  motion, current trip, points today, 48 h activity sparkline; live feed of
  uploads from SSE. This is the "data still comes in" proof screen.
- **History** — pick a day (prev/next, calendar with days that have data from
  `/api/stats/days`) or a range ≤ 93 days; device filter; tracks per device;
  time scrubber showing the position at a moment; distance, points,
  first/last; visits and trips of the day.
- **Explore** — all-time heatmap (`/api/heatmap`, refetch on move), totals.
- **Devices** — list; "Add device" flow: name → big QR of `setupUrl` ("scan
  with the iPhone camera, Overland opens with everything filled in"), "Open in
  Overland" button (on the phone itself), manual values with copy buttons,
  recommended Overland settings, then "Waiting for the first upload…" that
  turns into a success state via SSE. Device page: status, ingest log, raw
  points (paginated), remote settings preset, rotate token (re-shows the QR),
  rename, alerts toggle, delete (type the name to confirm).
- **Settings** — profile (name, time zone), passkeys (list with provider,
  add, rename, delete), sessions (revoke), "add a passkey on another device
  or address" (link + QR), people (admins: invites, users), data (export
  GeoJSON/GPX/CSV, delete a range, delete account), about (version, commit,
  build time).
- **Login** — one email field (`autocomplete="username webauthn"`) + Continue
  (unified start), conditional UI running in the background, "Use a passkey"
  button; clear states for not invited, no passkey for this address,
  cancelled, unsupported browser.

Quality bar: responsive from 320 px (phone-first, bottom tab bar on phones,
safe-area insets), keyboard and screen-reader accessible (landmarks, focus
management on navigation, labelled controls, text alternatives for map-only
information), 44 px targets, WCAG AAA text contrast where feasible, dark mode,
`prefers-contrast: more`, `forced-colors`, `prefers-reduced-motion`. The
map chunk is lazy-loaded. PWA manifest + icons (home-screen app on iPhone).

## 15. CI/CD

`.github/workflows/ci.yml`: `quality` (biome, typecheck, knip, unit tests with
coverage) → `integration` (API tests against a Postgres service) → `e2e`
(Playwright container + Postgres service, Chromium virtual authenticator) →
`image` (buildx multi-arch; pushes to GHCR only on `main` / tags / schedule;
builds without pushing on PRs). Actions pinned by commit SHA. Dependabot
(weekly, Monday 07:00 Europe/Brussels) for npm, GitHub Actions and Docker,
minor/patch auto-merge on green CI.

## 16. Testing

- `packages/contracts/tests` — schema and helper unit tests.
- `apps/api/tests/unit` — pure logic (Overland normalisation, timestamps,
  RDP, distance, tile math, token hashing, config parsing, presets).
- `apps/api/tests/integration` — supertest against the real app and the
  `trail_test` database (`TEST_DATABASE_URL`), including passkey ceremonies
  with a software authenticator (ES256, `none` attestation, CBOR via
  `@levischuck/tiny-cbor`).
- `apps/web/tests` — Vitest + Testing Library (jsdom).
- `tests/e2e` — Playwright against the built stack (`trail_e2e`): sign up with
  a CDP virtual authenticator, add a device, post an Overland batch, see it
  live, history, sign out/in, settings; axe accessibility scan; no console or
  CSP errors.
