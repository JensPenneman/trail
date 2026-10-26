# Platform plan (October 2026)

The shared brief for the pull requests that turn Trail from a single-user
dashboard into a platform: a documented public API with scoped tokens, a
processing pipeline that works out how you travelled, location sharing in the
spirit of Find My, an MCP server for agents, and a map-centred navigation.

`docs/architecture.md` stays the specification. Every pull request updates the
sections it touches there; this plan is removed once the last wave has shipped.
When the two disagree, the pull request that notices fixes the plan.

---

## 0. Rules for every pull request

1. **Raw data is sacred.** `locations`, `visits`, `trips`, `device_events` and
   `ingest_rejects` are never changed by processing. Everything derived lives in
   its own tables, carries an algorithm version and can be rebuilt with the CLI.
   The migration-upgrade test (`apps/api/tests/integration/migrationUpgrade.test.ts`)
   keeps passing; extend its fingerprint for every new table that holds user data.
2. **Contracts first.** Every request and response shape is a zod schema in
   `packages/contracts` (one file per resource, `xSchema` + `type X`), with
   `.meta({ id, description, example })` so it renders in OpenAPI. The API
   validates input with `parseBody`/`parseQuery`; the web app validates output
   with `apiFetch`.
3. **Errors** keep `{ error: { code, message, fields? } }` and the existing codes;
   new codes go into `packages/contracts/src/errors.ts` (expected additions:
   `insufficient_scope`, `token_expired`, `share_expired`). Unknown and foreign
   ids answer 404, never 403.
4. **Security defaults.** Secrets are random (≥ 32 bytes), stored as SHA-256 hex,
   shown once, shape-checked before any lookup. New secret-bearing paths and
   query names go into `redactUrl` and the pino redaction. Every new public
   endpoint has a rate limit. Every mutation has authorization tests (another
   user, a wrong scope, an expired or revoked credential).
5. **Tests.** Unit tests for pure logic, an integration test for every route
   (happy path and authorization), an end-to-end test for every user-facing
   flow (`desktop` and `iphone` projects), axe stays green, no console errors.
   Run everything in the dev container (`scripts/devc.sh …`).
6. **One migration per pull request**, generated with
   `npm run db:generate -w @trail/api`. When rebasing onto a `main` that gained a
   migration, delete your migration, its journal entry and its snapshot and
   regenerate, so the chain stays linear. Applied migrations are never edited.
7. **Docs.** Update `docs/architecture.md` (the relevant section), the README
   feature list, and the user-facing documents named in your section. API
   changes regenerate the OpenAPI snapshot.
8. **Commits** follow Conventional Commits and are signed; branches are
   `feat/<area>`. Keep the branch history readable before the first push
   (`git rebase -i` is fine); after review, add commits. No mention of AI or
   assistants anywhere: not in commits, pull requests or files.
9. **Budgets.** No endpoint reads unbounded rows (keep the ≤ 93-day and
   20 000-row style caps); processing is incremental and chunked by day; the
   OpenAPI document is built once per process.
10. **Single instance** stays an assumption (in-memory bus and limiters), but a
    queue that must survive a restart goes into a table.
11. **Branch dependencies.** When your routes need something another branch is
    still building (for example the v1 route registry), start with the domain
    work (schema, services, tests), rebase once that branch has merged, then add
    the routes. Do not copy another branch's code into yours.

---

## 1. Public API v1

### 1.1 Conventions

- Base path `/api/v1`. The existing `/api/*` routes stay the dashboard's private
  API. New features are built on v1 and the dashboard calls v1 for them (with
  its session). v1 is the only documented and guaranteed surface: a breaking
  change means `/api/v2`, never a silent change.
- **Auth:** `Authorization: Bearer trlk_…` (an API token, §2) or the session
  cookie. Bearer requests skip the CSRF guard (a bearer token is not an ambient
  credential); session requests get the same CSRF guard as today. Exactly one
  principal per request. `RequestAuth` becomes a discriminated union:
  `{ kind: "session", user, sessionId }` or
  `{ kind: "token", user, tokenId, scopes, deviceIds }` (`deviceIds` null = all).
  Routes that need a session (sessions, passkeys, SSE on `/api/events`, account
  deletion) use `requireSession()`; everything else uses `requireAuth()`.
- **Mounting:** the v1 router is mounted before the generic `/api` chain (like
  `/api/overland`), so it controls its own order: per-IP limiter →
  `authenticateBearer` → session load → CSRF guard for session requests →
  `express.json` (100 kB) → routes. `/docs` is mounted before the SPA router.
- **CORS:** `Access-Control-Allow-Origin: *` on `/api/v1` and `/mcp`, no
  credentials, allowed headers `Authorization, Content-Type, Last-Event-ID`,
  preflight answered without auth. Cookies are never accepted cross-origin
  (`SameSite=Lax` and no `credentials`).
- **Rate limits:** the global per-IP limiter stays; bearer requests add a
  per-token limiter (`RATE_LIMIT_TOKEN_PER_MINUTE`, default 600) with draft-8
  headers; a failed-token per-IP limiter (30 per 10 min) sits after the lookup,
  like the ingest one.
- **Time and ids:** ISO 8601 with offset in and out (UTC out); `from`/`to`
  half-open; local days use the owner's time zone; ids are UUIDs; a device is
  addressed by id (names are not unique).
- **Pagination:** keyset `cursor` + `limit` (`{ items, nextCursor }`) for lists
  that grow without bound (locations, segments); bounded ranges elsewhere with
  the same caps as today.
- **Levels** (§3): `level=raw|averaged|mapped|inferred` on `/api/v1/tracks`,
  which serves the processed levels; `/api/v1/locations` stays raw points.
  Default `raw` on the public API; the dashboard asks for its preference. A
  response says which level it could deliver (`availableLevel`).
- Responses never include another user's secrets; the sharing projection (§4.3)
  applies whenever a device is not the caller's own.

### 1.2 Route registry and OpenAPI

- `apps/api/src/v1/defineRoute.ts` is the single source of truth:
  `defineRoute({ method, path, operationId, summary, description, tags, auth,
  request: { params?, query?, body? }, responses: { 200: schema, … } }, handler)`.
  `auth` is `{ scopes: [...] }` (any listed scope grants access unless marked
  `all`) or `"public"`. One array of routes feeds both `createV1Router(ctx)`
  (mounting, validation, scope checks) and `buildOpenApiDocument(config)`
  (zod-openapi 6, `openapi: "3.1.1"`, `servers` from `PUBLIC_URL`,
  `securitySchemes.bearer` = http/bearer, tags with descriptions, shared error
  components per status with the list of codes).
- `GET /api/v1/openapi.json` (public, built once, ETag) and `GET /docs`
  (public): Scalar's standalone bundle served from the image (no CDN), with a
  route-scoped CSP that allows `style-src 'unsafe-inline'` on that page only;
  `script-src 'self'` stays. The guide (§1.4) is `info.description`, so the
  page is complete without the repository.
- Tests: a unit test snapshots the document and validates it with an OpenAPI
  3.1 validator; an integration test asserts every mounted v1 route is in the
  document and the other way round.

### 1.3 Endpoints (initial set; owners in §7)

| Operation | Scope | Notes |
|---|---|---|
| `GET /api/v1/tokens/verify` | any token (`auth: "token"`) | `{ id, name, scopes, deviceIds, expiresAt, status }` (Cloudflare's `tokens/verify`); a session gets 400 `bad_request` |
| `GET /api/v1/me` | `profile:read` | id, displayName, timezone |
| `GET /api/v1/devices` | `devices:read` | `DevicePublic`: no tokenHint, deviceKey, pendingSettings or alerts; `lastLocation` only with `locations:read` (left out otherwise) |
| `GET /api/v1/devices/{id}` | `devices:read` | |
| `PATCH /api/v1/devices/{id}` | `devices:write` | name, alertsEnabled, pendingSettings → `{ device, settings }` (the owner's settings, which `DevicePublic` leaves out) |
| `GET /api/v1/devices/{id}/location` | `locations:read` | latest cached position, battery, inferred mode when known |
| `GET /api/v1/locations` | `locations:read` | `device`, `from`, `to`, `cursor` (opaque), `limit` ≤ 1000, oldest first; raw points only — the levels are `/api/v1/tracks` |
| `GET /api/v1/tracks` | `locations:read` | `devices`, `from`, `to` (≤ 93 days), `level`, `maxPoints` → segments with mode and confidence |
| `GET /api/v1/segments` | `locations:read` | `devices`, `from`, `to` (≤ 93 days), `cursor`, `limit` ≤ 1000 → stops and moves (§3) |
| `PUT` / `DELETE /api/v1/segments/{id}/mode` | `locations:write` + `locations:read` | override one segment (the answer is the segment) |
| `GET /api/v1/devices/{id}/mode` | `locations:read` | the quick toggle in force and the current mode |
| `POST /api/v1/devices/{id}/mode` | `locations:write` + `locations:read` | quick override from now (§3.5; the answer is the current mode) |
| `GET /api/v1/visits` | `locations:read` | as the private route: `from`, `to` (≤ 400 days, any offset), `devices`; visits are places |
| `GET /api/v1/trips` | `history:read` | as the private route: `from`, `to` (≤ 400 days, any offset), `devices`; no coordinates |
| `GET /api/v1/stats/days`, `/stats/activity` | `history:read` | as the private routes, with `devices` |
| `GET /api/v1/stats/modes` | `history:read` | distance and time per local day and mode (§3.6); no coordinates |
| `GET /api/v1/heatmap` | `locations:read` | as the private route, with `devices`; the cells are places |
| `GET /api/v1/people` | `people:read` | people sharing with the caller, projected latest location |
| `GET /api/v1/people/{userId}` | `people:read` | one person: shared devices and their locations |
| `GET` / `POST /api/v1/shares`, `PATCH` / `DELETE /api/v1/shares/{id}`, `POST …/{id}/confirm` | `shares:read` / `shares:write` (+ `locations:read` to start, change or confirm, §4.8) | outgoing shares |
| `GET /api/v1/shares/incoming`, `POST …/incoming/{id}/hide` | `shares:read` / `shares:write` | incoming shares |
| `GET` / `POST /api/v1/share-links`, `DELETE …/{id}` | `shares:read` / `shares:write` (+ `locations:read` to make one) | public links |
| `GET /api/v1/events` | `locations:read` | SSE: the `/api/events` frames plus `person` and `segments`; bearer or session (stretch goal) |

Ingest stays at `/api/overland` with device tokens. Token management is
session-only at `/api/me/tokens` (§2.5): a token never manages tokens.

### 1.4 Documentation

- `docs/api.md`, written for other developers: getting a token, scopes, curl
  examples for the main calls, pagination, levels, errors, rate-limit headers,
  CORS, the versioning promise. It becomes `info.description` at build time
  (the image excludes `docs/`, so the build copies it in).
- README: a "Public API and MCP" section that links `/docs`.

---

## 2. API tokens (Cloudflare-style)

### 2.1 Model

`api_tokens`: `id` uuidv7, `user_id` (cascade), `name` (≤ 60), `token_hash`
(unique, SHA-256 hex), `token_hint` (last 4), `scopes` text[] (non-empty),
`device_ids` uuid[] null (null = all of the user's devices; a deleted device is
removed from every array), `allowed_ips` cidr[] null, `expires_at` null,
`created_at`, `last_used_at`, `last_used_ip` inet, `revoked_at`. At most 50
active tokens per user.

- Secret: `trlk_` + base64url(32 random bytes), matched by
  `^trlk_[A-Za-z0-9_-]{43}$`, shown once at creation and after a roll.
- Lifecycle: create → use → **roll** (new secret, same row and metadata, the old
  secret stops working immediately) → **revoke** (soft; the row is kept 30 days
  for the audit trail, then pruned). Expiry is checked on every request;
  `last_used_at` and `last_used_ip` are written at most once a minute.

### 2.2 Scopes

`profile:read`, `devices:read`, `devices:write`, `locations:read`,
`locations:write`, `history:read`, `people:read`, `shares:read`, `shares:write`.

Scopes are the privacy boundary: anything with coordinates needs
`locations:read` — points, tracks, segments, visits, the heatmap and a device's
position. `devices:read` covers the devices, their names, status, last-seen
time and battery, never where they are; `DevicePublic.lastLocation` is left out
for a principal without `locations:read`. `history:read` is the history
without coordinates: trips, daily statistics and activity.

Templates in the UI: **Read-only** (all `:read`), **Agent** (read + `locations:write`),
**Full access**. `devices:write` never rotates a device token or deletes a
device: that stays session-only. The device restriction applies to devices,
locations, tracks, segments and history; `people:*` and `shares:*` are not
device-scoped.

### 2.3 Enforcement

- `authenticateBearer` runs before the session load on `/api/v1` and `/mcp`:
  shape check → hash → lookup (joined with users) → revoked, expired and
  `allowed_ips` (against `req.ip`) checks → `RequestAuth { kind: "token", … }`.
  A failure answers 401 `unauthorized` with
  `WWW-Authenticate: Bearer realm="trail", error="invalid_token"` (expired:
  `token_expired`).
- `requireScopes(...)` answers 403 `insufficient_scope` and names the missing
  scopes. `resolveDeviceIds` and `findOwnedDevice` honour the token's
  `deviceIds`.
- Redaction: `Authorization` is already redacted; the `trlk_` pattern is added
  to the generic redactor as defence in depth.
- Audit: creation, roll and revocation are logged at info with the token id,
  never the secret.

### 2.4 UI

Settings › **API tokens**: the list (name, hint, scopes as chips, devices,
expiry, last used, status), a **Create token** dialog (name; template radio and
scope checkboxes grouped Read / Write; devices: all or pick; expiry: 30 days,
90 days, 1 year, custom or never, with a warning on never; optional IP
allowlist), the one-time secret screen (copy, "I have saved it"), Roll and
Revoke with confirmation, and links to `/docs` and `docs/mcp.md`. End-to-end:
create, call `/api/v1/tokens/verify` with the secret from the test, roll,
revoke.

### 2.5 Endpoints (session only)

`GET /api/me/tokens`, `POST /api/me/tokens` (201 `{ token, secret }`),
`PATCH /api/me/tokens/:id` (name, scopes, deviceIds, allowedIps, expiresAt),
`POST /api/me/tokens/:id/roll` (200 `{ token, secret }`), `DELETE /api/me/tokens/:id`.

---

## 3. Location processing and transport inference

### 3.1 Levels

| Level | Meaning | Lives in |
|---|---|---|
| `raw` | points as received | `locations` |
| `averaged` | outliers dropped, GPS noise reduced | `processed_points.lat_avg`, `lon_avg`, `kept` |
| `mapped` | averaged points snapped to OSM roads and rails, with the way geometry between consecutive points filled in | `processed_points.lat_map`, `lon_map`, `way_id`, `way_kind`, `snap_m` |
| `inferred` | mapped points cut into **stops** and **moves**; every move labelled with a transport mode and a confidence; the user's overrides applied | `segments` |

Levels are cumulative. A level that cannot be computed yet (map data missing)
degrades to the one below, and the response says so.

### 3.2 Storage (derived, rebuildable)

- `processed_points` — PK `(device_id, recorded_at)`, FK to `locations` on
  delete cascade (deleting raw points removes the derived ones). Columns: `kept`
  bool, `lat_avg`, `lon_avg` float8, `speed_avg` real, `lat_map`, `lon_map`
  float8 null, `way_id` bigint null, `way_kind` text null, `snap_m` real null,
  `path_map` jsonb null (the way's shape since the move's previous point —
  what makes a sparse train follow the rails), `version` smallint,
  `processed_at`.
- `segments` — `id` uuidv7, `device_id`, `started_at`, `ended_at`, `kind`
  `stop|move`, `mode` (final, null for stops), `mode_inferred`, `confidence`
  real, `mode_user` null, `review` (the inference was unsure), `distance_m`,
  `duration_s`, `max_speed`, `point_count`, start, end and centroid lat/lon,
  `features` jsonb, `version`, `computed_at`. Unique `(device_id,
  started_at)`; index `(device_id, ended_at)`.
- `mode_overrides` — `id`, `device_id`, `kind` `segment|toggle` (a segment
  override holds for its span, a toggle until `to_at` or the next stop),
  `from_at`, `to_at` null (open: until the next stop), `mode`, `source`
  `ui|api|mcp`, `created_by`, `created_at`, `revoked_at`. Overrides outlive recomputation and are materialised into
  `segments.mode_user` whenever segments are rebuilt.
- `processing_queue` — `device_id`, `from_at`, `to_at`, `reason`,
  `from_level`, `priority`, `attempts`, `next_at`, `enqueued_at`,
  `missing_tiles` (a window waiting for map data), `last_error`; PK
  `(device_id, from_at)`. Survives restarts. `processing_state` records the
  version the history was backfilled for.
- Map data cache: `osm_tiles (z, x, y)` PK with `fetched_at`, `way_count`,
  `bytes`; `osm_ways` `id` PK, `kind`, `tags` jsonb (highway, railway, service,
  maxspeed, name, route, public_transport, oneway), `nodes` bigint[],
  `geometry` jsonb `[[lon, lat], …]`, bounding box columns, `fetched_at`;
  `osm_tile_ways (z, x, y, way_id)` PK; `osm_pois` `id` PK, `kind`
  (`station|halt|tram_stop|subway_station|bus_stop|ferry_terminal|aerodrome`),
  `lat`, `lon`, `name`. Tiles are z14; refreshed after `PROCESSING_OSM_TTL_DAYS`
  (90).

Contracts (`packages/contracts/src/transport.ts`):
modes `stationary, walking, running, cycling, car, bus, tram, metro, train,
boat, plane, unknown`; way kinds `motorway, trunk, primary, secondary, tertiary,
residential, service, track, cycleway, footway, path, rail, light_rail, tram,
subway, ferry, other`.

### 3.3 Algorithms

**Averaged.** Per device, in time order. Drop points with accuracy above
`PROCESSING_MAX_ACCURACY_M` (150) and spikes that imply more than 90 m/s from
both neighbours. Consecutive points within max(accuracy, 25 m) of the running
centroid at ≤ 0.5 m/s form a stationary cluster and collapse to its centroid.
Moving points get an accuracy-weighted (1/accuracy²) average over the
neighbours within ±20 s **by time**, so sparse data (a train point every few
minutes) is left as it is. `speed_avg` is the median of reported and derived
speeds.

**Mapped.** Candidate ways per point come from the z14 tiles that cover a
radius r = clamp(1.5 × accuracy, 25 m, 120 m). Emission probability is
N(0, σ = max(accuracy, 10 m)) on the perpendicular distance to the way. The
transition prefers, in order, the same way, ways sharing a node (bounded search
over the cached ways: ≤ 40 hops and ≤ 25 km), and the same family (rail stays
rail); its penalty grows with |chord − along-way distance|. Viterbi runs per
move (stops are not matched). The output is the snapped coordinate and the
intermediate vertices of the connected way chain between consecutive points —
this is what makes a sparse train track follow the rails instead of cutting
across fields. No candidate within r → `lat_map = lat_avg`, `way_kind = other`.

The map data comes through a `WaySource` interface
(`fetchTile(z, x, y): Promise<TileData>`). The default `OverpassWaySource` uses
`PROCESSING_OVERPASS_URL` (default `https://overpass-api.de/api/interpreter`;
empty disables mapping) with: one request every 2 s, concurrency 1, a 60 s
timeout, retries with backoff, `User-Agent: Trail/<version>
(+https://github.com/JensPenneman/trail)` (the project, not the instance),
a daily byte budget `PROCESSING_OVERPASS_DAILY_MB` (300), a 20 MB response cap
and strict parsing. One query per tile: every `highway=*` except
proposed/construction/abandoned, railways (`rail|light_rail|tram|subway|
narrow_gauge|funicular`), `route=ferry`, and the POIs above, with `out geom`.
A missing tile leaves the window `needs_map`; the queue retries it later and
everything else proceeds. Overpass learns which ~1.5 km squares are fetched
and when (fetches follow uploads), from the server's IP address, but not the
tracks or who the user is; tile keys, like coordinates, are logged at debug
level only. `PROCESSING_OVERPASS_URL=` (empty) switches it off; a
self-hosted extract behind the same interface is a possible later step.

**Inferred.**

1. **Stops:** at least `PROCESSING_STOP_MIN_S` (180) seconds within a 60 m
   radius, an iOS visit, or `motion` stationary for the whole span. A stop
   closes the current move.
2. **Features per move:** speed statistics (median, p85, max, from consecutive
   pairs ≤ 10 min apart; for sparser pairs the along-track distance over
   time), acceleration variance, way-kind shares (rail, tram, subway, motorway,
   road, cycleway, foot, ferry, none), the **corridor ratio** for sparse data
   (sample the chord between consecutive points every 250 m; the share of
   samples within 200 m of a rail way), stops near stations or halts, stops
   near bus stops, the CoreMotion histogram (`motion`), the Overland manual
   trip mode if one was running, altitude climb rate, duration and distance.
3. **Scores** per mode from transparent rules in one configuration object with
   named thresholds. Examples: train ← rail share or corridor ratio ≥ 0.6 and
   p85 ≥ 60 km/h and (station stops or no road overlap); tram / metro ← tram or
   subway share ≥ 0.5; car ← road or motorway share and motion automotive and
   no rail; bus ← road and p85 ≤ 60 km/h and ≥ 2 stops at bus stops and motion
   automotive; cycling ← motion cycling, or 10–32 km/h on cycleways; walking ←
   ≤ 7 km/h or motion walking; running ← 7–16 km/h and motion running; boat ←
   ferry share; plane ← p85 ≥ 250 km/h or a steep climb. Confidence = winning
   score / sum of scores; `unknown` when the winner is below 0.4.
4. **Splitting:** a move is cut where a 3-minute sliding window changes its
   winner for at least 2 minutes or 500 m (walk → train → walk); segments
   shorter than that merge into a neighbour.
5. **Overrides** are applied last (§3.5). Segments with confidence below 0.6
   are flagged `needsReview` for the UI.

Everything is deterministic, and `features` is kept so thresholds (and later a
model trained on the overrides) can be evaluated offline.

### 3.4 Scheduling

- After each ingest commit the device's window (earliest new point − 30 min,
  latest + 30 min) is merged into `processing_queue`; `deleteLocationRange`
  enqueues the deleted range; a device deletion cascades; a time-zone change
  needs nothing (segments are UTC).
- One in-process worker (the `dailyStatsScheduler` pattern, reading the table)
  takes the oldest ready row, extends the window to whole stops and moves at
  both ends, runs averaged → mapped → inferred for it, upserts, deletes the row.
  A failure re-queues with backoff; a tile fetch failure leaves `needs_map`
  rows that a 15-minute pass picks up. A per-device advisory lock; timings in
  the log.
- `trail reprocess [--device <id>] [--from <iso> --to <iso>] [--from-level
  averaged|mapped|inferred]`. Bumping the `PROCESSING_VERSION` constant makes a
  boot-time job enqueue every device's history in day chunks, newest first, at
  low priority.
- SSE: a `segments` event `{ deviceId, from, to }` when a window finishes, so
  an open dashboard refetches that day's tracks and timeline.

### 3.5 Overrides (the user wins)

- Segment override: `PUT /api/v1/segments/{id}/mode { mode }` creates a
  `mode_overrides` row for the segment's span; `DELETE` revokes it. The UI
  shows `modeUser` with a "set by you" mark; the inferred value stays visible.
- Quick toggle: `POST /api/v1/devices/{id}/mode { mode, until? }` opens an
  override from now until `until` or the next detected stop, whichever comes
  first; a part of the current move shorter than 90 s before it joins in, and
  the segment dialog corrects a whole move. Idempotent; `mode: null` ends
  the open override. In the UI it is a one-tap chip row on the device card and
  in the segment popover; for agents it is an MCP tool (§5.2).
- Overrides are also reported in `features.override` and counted in stats.

### 3.6 API and UI

`GET /api/v1/tracks?level=inferred` returns `{ level, availableLevel,
segments: [{ id, deviceId, kind, mode, modeInferred, confidence, needsReview,
startedAt, endedAt, distanceM, points: [[lon, lat, epochSeconds], …] }] }`.
`GET /api/v1/segments` returns the timeline: stops with centroid and duration,
moves with mode, distance, duration and average speed. Per-mode figures have
their own endpoint, `GET /api/v1/stats/modes` (distance, time and segments per
local day, device and mode); `/api/v1/stats/days` stays as it is, and
`/api/v1/locations` stays raw.

UI (inside History and Live at first; §6 moves it): a level `SegmentedControl`
(Raw · Averaged · Mapped · Transport) kept in the URL and localStorage; mode
colours and a legend (new tokens in `tokens.css`, distinct from the device
palette); hit-testing a segment on the map opens a popover (mode, confidence,
speed, distance, duration, Change mode, Reset); a timeline list for the day;
quick-toggle chips on the device card; segments flagged for review get a
dashed outline and a "Confirm?" affordance.

### 3.7 Configuration

`PROCESSING_ENABLED` (true), `PROCESSING_OVERPASS_URL`,
`PROCESSING_OVERPASS_DAILY_MB`, `PROCESSING_OSM_TTL_DAYS`,
`PROCESSING_MAX_ACCURACY_M`, `PROCESSING_STOP_MIN_S`. Documented in
`.env.example`, passed through in `deploy/compose.yaml`, explained in
`docs/operations.md`.

---

## 4. Sharing (People)

### 4.1 Concepts (what is taken from Find My)

- Sharing is **one-way and explicit**: I share my location with a person, they
  see me under People, they may share back. Either side can stop at any time;
  the recipient can also hide a person.
- Duration: one hour · until the end of my day · a week · indefinitely.
- A person is shown with name, the shared device(s), how fresh the location is,
  what they are doing (inferred mode and speed), battery, the distance from me,
  and actions: show on the map, open in Maps (Apple Maps and Google Maps
  links), share back, stop or hide.
- Beyond Find My: **precision** (precise / approximate ≈ 500 m / area ≈ 5 km),
  optional **history** (live only by default, or the last N days), and
  **public links** for people without an account.

### 4.2 Model

- `shares` — `id`, `owner_user_id`, `recipient_email` (lower-cased),
  `recipient_user_id` null (bound when the address has an account at
  creation, at a sign-up with an invitation to that address, or when the owner
  confirms who signed up, §4.8), `device_ids` uuid[] null, `precision`
  `precise|approximate|area`, `history_days` int null (null = live only),
  `include_details` bool (battery and mode; default true), `expires_at` null,
  `created_at`, `revoked_at`, `hidden_at` (set by the recipient),
  `last_viewed_at`. Partial unique `(owner_user_id, recipient_email)` where
  `revoked_at` is null; at most 50 active per owner.
- `share_links` — `id`, `owner_user_id`, `token_hash` unique, `label` (shown to
  visitors; defaults to “Shared location”, never the owner's name),
  `device_ids` null, `precision`, `history_days` null, `include_details`
  (default false), `expires_at` not null (default 24 h, at least 1 h, at most
  30 days), `created_at`,
  `revoked_at`, `view_count`, `last_viewed_at`. Secret `trls_` + 32 bytes; URL
  `${PUBLIC_URL}/s#<secret>` (the secret is the fragment, §4.8).
- `hidden_people` — `user_id`, `hidden_user_id`, `hidden_at`; PK of both: a
  person the user hid, so every share from them stays hidden (§4.8).

### 4.3 Access rules

- `resolveAccessibleDevices(viewer, requestedDeviceIds?)` →
  `[{ deviceId, ownerId, precision, from, includeDetails }]`: the viewer's own
  devices (precise, unbounded) plus the devices of active incoming shares (not
  revoked, expired or hidden; `from` = now − `history_days`, or now − the live
  window for live-only shares — `STALE_AFTER_HOURS`, see §4.8). Every read of
  shared data goes through it; mutations keep `findOwnedDevice`.
- Projection: coordinates of a non-precise device are snapped to a grid
  (approximate 0.005°, area 0.05°) with one deterministic offset per owner, so
  repeated reads cannot be averaged back to the real position and several
  shares, links or devices cannot be intersected (§4.8); the reported
  accuracy is the grid size; speed and course are dropped for `area`. Battery
  and mode appear only with `include_details`.
- A recipient never sees device tokens or keys, pending settings, alerts,
  ingest logs, raw exports or deletion. `DevicePublic` for another person's
  device carries name, `lastRecordedAt`, the projected position, mode and
  battery where allowed.

### 4.4 Live updates

`afterIngest` publishes `person` events (projected) to every recipient with an
active share for that device (owner → recipients lookup cached for 60 s), and a
`share` event to the recipient when a share is created or revoked and to the
owner when it is hidden or someone signed up with its address. People and Map pages update from these;
the public page polls.

### 4.5 Public links

- `/s` is a public SPA route (no session) that reads the secret from the
  fragment (`/s#<secret>`): a minimal page with the label, a map centred on the
  latest position(s), freshness, mode and battery where included, "Updated
  every 15 s", the expiry, and no navigation. It calls `GET /api/public/share`
  with the secret in `X-Share-Secret` (per-IP 60/min; 404 for unknown, expired
  or revoked; `Cache-Control: no-store`), which bumps `view_count` at most once
  a minute per link.
- No URL carries the secret; the header is redacted from logs; the page sends
  `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`.

### 4.6 UI

- **People** page (new primary item): "People who share with me" (cards as in
  §4.1) and "You share with" (status, devices, precision, expiry, stop). A
  **Share my location** dialog: email (suggesting people who share with me),
  devices, precision, history, duration; it says "They will see you once they
  sign up and you confirm" when the address has no account; admins get a
  one-click invite to that address. "You share with" asks "<name> (<address>)
  joined Trail — confirm?" with Confirm and Cancel when someone signed up.
- Settings › **Sharing**: public links (create with label, devices, precision,
  history and expiry; copy, QR, revoke; views and last viewed) and the outgoing
  shares.
- Map: the person selector (§6) shows a person's devices in their own colours;
  a person card focuses the map.
- No e-mail notifications yet: the `share` event plus a notice on the People
  page is enough.

### 4.7 Endpoints

See §1.3, plus `GET /api/public/share` (`X-Share-Secret`). Pending shares are bound in
`finishSignUp` only for an invitation to their address; otherwise the owner
confirms with `POST /api/v1/shares/{id}/confirm` (§4.8).

### 4.8 Decisions (feat/sharing)

The sharing pull request settled these; `docs/architecture.md` §8.5 is the
specification.

1. **History requires precise.** `history_days` only with `precision =
   precise` (400 otherwise, also for a change that would leave it on a coarse
   share; a check constraint backs it). Approximate and area shares are live
   only. Find My shares no history at all; precise history is Trail's opt-in
   extension. Shares allow 1–365 days (≤ 93 per track call), links 1–7.
2. **Where shared data is readable:** only through the people routes, the live
   events and the public link endpoint. The general v1 reads (locations,
   tracks, visits, trips, stats, heatmap, devices) stay own-devices-only.
   `resolveAccessibleDevices(viewer, requested?)` is the single source of truth
   for what a viewer may see of other people; the MCP and Map branches use it
   with `toSharedDevice`.
3. **Live window = `STALE_AFTER_HOURS`** (12 h), not `LIVE_WINDOW_MINUTES`:
   Overland pauses while a phone stands still, so a 15-minute window would hide
   everyone who sits still. A live-only share shows the newest position of the
   last 12 hours; nothing older.
4. **Projection:** rows of 0.005° latitude; bands of ten rows, each divided
   into a whole number of columns (a multiple of ten) about as wide in metres
   as the rows are high; an area cell is a block of ten by ten approximate
   cells, so it is always a union of them, and whole columns leave no cut
   cell at the antimeridian. One offset per owner — an HMAC-SHA256 of the
   owner's id under a 32-byte key the server generates once and keeps in
   `server_secrets` (`share-grid`) — serves every device, share and link of
   the owner and both precisions: no number of them, nor a share made again,
   narrows a position below one approximate cell (a property test holds it;
   offsets per share or device could be intersected). Accuracy
   = the cell size (or the fix's own, when worse); altitude and course are
   dropped for both coarse precisions, the speed too for area. Distances start
   from the viewer's own newest position and end at the projected one; they
   need `locations:read` for tokens (they are location data of the viewer).
5. **Durations:** `hour`, `endOfDay` (the next local midnight in the owner's
   time zone, found by bisection on the local date), `week` (7 × 24 h),
   `indefinitely`; a change's `duration` counts from now. Links: expiry
   required, 24 h by default, at least an hour, at most 30 days; without a
   label they read “Shared location”, never the owner's name.
6. **Limits and lifecycle:** 50 current shares (pending and joined included)
   and 20 working links per owner (409); the links list shows the working
   ones, then expired ones, at most 50; an ended share is stopped automatically
   when a new one goes to the same address; stopped and ended rows are pruned
   after 30 days; a deleted device leaves the owner's shares and links (never
   widening one to every device).
7. **Tokens limited to devices** (refines §2.2): they read people and shares
   like any token, but share only the devices they are limited to, named by
   id, and change or confirm only shares that show nothing but those devices,
   before and after the change (403); stopping is always allowed.
8. **Visibility for the owner:** outgoing shares show `pending`, `joined`
   (someone signed up with the address and waits for confirmation), `active`
   or `hidden` (the recipient hid them) and `last_viewed_at` (stamped at most
   once a minute when the recipient reads people). Accepted: starting a share
   tells the owner whether the address has an account, and its name — on a
   server whose accounts come from the allow-list and invitations there is
   little to learn from it.
9. **Public endpoint:** the secret never appears in a URL a server or proxy
   sees — the link is `${PUBLIC_URL}/s#<secret>` (a fragment) and the page
   calls `GET /api/public/share` with `X-Share-Secret`; 404 `not_found` for a
   missing, malformed or unknown secret, 404 `share_expired` (the new error
   code) for an expired or turned-off link, so the page can say which; devices
   carry a per-link HMAC key instead of their ids; tracks of history links are
   cached 30 s per link; its per-IP limit is `RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE`
   (60).
10. **Inferred mode:** `activity.mode` is the owner's current mode from
    processing — the rule of `GET /api/v1/devices/{id}/mode`: the quick toggle
    in force, else the latest stop or move while it is recent — read by
    `loadCurrentModes` in one query over the shared devices, and only with
    details; the web cards read it through `describeActivity`, which works
    with or without it.
11. **Scopes:** anything that can yield coordinates needs `locations:read`.
    Starting or changing a share, confirming one and making a link take
    `shares:write` and `locations:read` (a share to an address the token
    controls, or a precise link read back through the public endpoint, would
    otherwise show positions the token may not read); stopping a share or a
    link and hiding or showing a person take `shares:write` alone.
    `resolveAccessibleDevices` returns the caller's own devices to a token
    only with `locations:read` (and shared ones only with `people:read`), so
    every caller — the MCP server too — inherits the rule.
12. **Pending shares and sign-up:** Trail does not verify addresses, so
    whoever first signs up with an address must not inherit what was shared
    with it. A pending share binds at sign-up only when the sign-up used an
    invitation to that very address (an administrator vouched for it); after
    any other sign-up (the allow-list, an open invitation) the owner sees
    "<name> (<address>) joined Trail — confirm?" and confirms
    (`POST /api/v1/shares/{id}/confirm`) or cancels. Nothing is visible to the
    new account before that; both sides get the usual `share` events
    (`claimed` to the owner, `created` to the recipient on confirmation).
    Sign-up and starting a share take the same advisory lock, so they never
    miss each other.
13. **Hiding is per person:** the recipient hides the owner, not a share
    (`hidden_people`); a new share from someone hidden starts hidden and sends
    no `created` notice until they are shown again.

---

## 5. MCP server

### 5.1 Transport and auth

- `POST /mcp`: MCP Streamable HTTP, **stateless** (one server per request,
  answers as single JSON bodies), built with the official TypeScript SDK v2
  (`@modelcontextprotocol/server`; `toNodeHandler` of `@modelcontextprotocol/node`
  adapts it to Express 5). `GET`, `DELETE` and other methods answer 405.
  Mounted before `compress` and the generic `/api` chain: CORS headers →
  per-IP limiter → Origin check → preflight → bearer → per-token limiter →
  POST with JSON → body limit 1 MB → SDK.
- Both protocol eras: 2026-07-28 (per-request envelope) through the SDK's
  `createMcpHandler`, 2025-era clients (`initialize`) through a stateless
  leg with JSON responses, routed by the SDK's `isLegacyRequest`.
- Auth: `Authorization: Bearer trlk_…` (§2) only — the session cookie is never
  read on `/mcp`; scopes gate tools. 401 carries
  `WWW-Authenticate: Bearer realm="trail"`, with `error="invalid_token"` for a
  refused token (code `token_expired` for an expired one). No OAuth yet;
  documented as the follow-up (protected-resource metadata plus an
  authorization server on top of the token system).
- Origin (the transport's DNS-rebinding rule): no `Origin` passes; an `Origin`
  must be one of the instance's origins or listed in `MCP_ALLOWED_ORIGINS`,
  else 403, before the token lookup.
- The per-token limiter is shared with `/api/v1`: one budget per token.
- Server info: name `trail`, the build version, and an `instructions` string
  about units, time zones (the account's, with its offset), limits and
  privacy, which never holds anything a user typed.

### 5.2 Tools

Every tool returns `structuredContent` and a short text; coordinates are WGS84;
times are ISO with the owner's offset. A token sees only the tools whose
scopes it holds (all of them); calling another answers like an unknown tool.

| Tool | Scopes | Purpose |
|---|---|---|
| `list_devices` | `devices:read` | devices with status, last seen, battery (no positions); the current mode only with `locations:read` too |
| `get_current_location({ device? })` | `locations:read` | latest position, accuracy, age, speed, mode, battery; `device` by id or exact name; default = the device with the newest position |
| `get_location_at({ at, device?, toleranceMinutes? })` | `locations:read` | the nearest point around a time (default tolerance 30 min, at most 24 h) |
| `get_timeline({ from, to, device? })` | `locations:read` | stops and moves with mode, distance, duration, speed — the appointment agent's main tool |
| `get_day_summary({ date, device? })` | `history:read` | distance and time per mode, first and last movement, stops — no coordinates |
| `get_visits({ from, to, device? })` | `locations:read` | as the API (visits are places) |
| `get_trips({ from, to, device? })` | `history:read` | as the API |
| `set_transport_mode({ mode, device?, until? })` | `locations:read`, `locations:write` | the quick override (§3.5), source `mcp`; its answer is the mode now (location data) |
| `get_people` | `people:read` | people sharing with the owner and their projected location, through `loadPeople` only; no addresses or ids |

Resources: `trail://devices` (`devices:read`) and
`trail://devices/{id}/location` (`locations:read`). No prompts.
Limits: at most 31 days per call (local days, so a month across the night the
clocks go back fits) and 500 items per result; a capped result tells the
caller how to narrow the request. Reads run in a read-only transaction with a
10 s statement timeout.

### 5.3 Docs

`docs/mcp.md`: what it is, create a token with the Agent template, connect from
Claude Code (`claude mcp add --transport http trail https://trail.jenspenneman.com/mcp
--header "Authorization: Bearer …"`) and from other clients (Streamable HTTP
with a bearer header), the tool reference, privacy notes and the threat
model, limits, troubleshooting. Linked from README, `docs/api.md` and
Settings › API tokens. The integration suite drives the server with the SDK's
own client in both eras.

### 5.4 Decisions (feat/mcp)

- **SDK v2, without `@modelcontextprotocol/express`.** The v2 server works
  with Express 5 through `toNodeHandler`; the Express package only adds an
  app factory and middleware (an Origin check by hostname, an OAuth bearer
  verifier) that Trail replaces with stricter ones of its own (exact origins,
  `authenticateBearer` with the failed-token limiter).
- **JSON for both eras.** The SDK's default 2025 fallback answers over SSE;
  Trail routes those requests to its own stateless leg with
  `enableJsonResponse`.
- **`get_day_summary` needs `history:read` only**: it carries no coordinates
  (only times, counts and distances), like the trips. **`set_transport_mode`
  needs `locations:read` too**, as `POST /api/v1/devices/{id}/mode` does: its
  answer is the device's mode now.
- **`list_devices` shows the current mode only with `locations:read`**, as
  `GET /api/v1/devices/{id}/mode` does: the mode tells when a device moves.
  Without the scope the field is left out, as `DevicePublic.lastLocation` is.
- **CORS** also allows `Mcp-Method` and `Mcp-Name` (required by 2026-07-28)
  and lets GET and DELETE through the preflight, so a browser-based client
  sees the 405 rather than a network error.

---

## 6. Navigation and the Map page

### 6.1 Routes

Signed-in: `/` **Map**, `/people`, `/devices`, `/devices/:id`, `/settings`
with sections as sub-routes (`/settings/profile|passkeys|tokens|sharing|data|
people|about`; the bare `/settings` goes to profile; existing anchors keep
working). Public: `/login`, `/invite/:t`, `/link/:t`, `/s` (`#<secret>`). Redirects:
`/history?…` → `/?view=history&…`, `/explore` → `/?view=heat`.
`isSignedInPath` changes with the routes.

### 6.2 Map page

- One page, three **views** (a SegmentedControl in the head): **Live** (latest
  positions of my devices and the selected people, today's tracks, device and
  person cards), **History** (today's HistoryPage controls: day or period,
  calendar, scrubber, timeline with segments, visits and trips), **Heat**
  (today's Explore). URL:
  `/?view=live|history|heat&people=me,<userId>,…&devices=…&date|from,to&level=&style=`.
- **Person selector** before the device filter: Me and everyone sharing with
  me, plus "Everyone" when there are two or more. Other people's devices get
  colours from a second palette ring; the device filter groups devices by
  person.
- **Map style** control: Auto (system) · Light · Dark · Satellite — Satellite
  only when `MAP_STYLE_SATELLITE` is configured (`/api/config.mapStyles` gains
  an optional `satellite`). Remembered in localStorage.
- The **level** control (§3.6) and the transport legend sit in the map head;
  segment popovers and the quick toggle as in §3.6.
- Phones: a four-item tab bar (Map, People, Devices, Settings); the map head
  collapses into a sheet.
- Accessibility and tests as today (axe, console guard, keyboard); end-to-end
  covers view switching, person and device selection, deep links and the
  redirects.

---

## 7. Delivery

Every branch is a pull request from this repository, so it gets a Launchway
preview on a host name of its own.

| Wave | Branch | Owns | Depends on |
|---|---|---|---|
| 0 | `chore/devcontainer` | the Docker dev container and `scripts/devc.sh` | — |
| 0 | `docs/platform-plan` | this document | — |
| 1a | `feat/api-v1-foundation` | §1.1–§1.2: `RequestAuth` kinds, the v1 router and registry, OpenAPI document, `/docs`, CORS, `GET /api/v1/me`, `GET /api/v1/devices`; no tokens yet | 0 |
| 1b | `feat/api-tokens` | §2 and the rest of §1.3 that is not owned below; `docs/api.md`; migration `api_tokens` | 1a |
| 1b | `feat/processing` | §3; migration `processing`; the v1 routes for levels, segments and overrides | 0 (routes after 1a) |
| 1b | `feat/sharing` | §4; migration `sharing`; the v1 people and shares routes, the public page | 0 (routes after 1a) |
| 2 | `feat/mcp` | §5 | wave 1 |
| 2 | `feat/map-navigation` | §6 | wave 1 |

Merge order inside wave 1b: tokens → processing → sharing, each rebased onto
`main`, its migration regenerated, CI green. Review happens on the pull
request; the reviewer may push fixes to the branch. Housekeeping that rides
along with the review: README still says "three presets" (there are four), the
`ingest_rejects` comment still mentions a 30-day retention, SECURITY.md and
docs/overland.md still mention the tunnel and `latest` auto-updates.

Release: after wave 2 has merged, release-please proposes 0.3.0;
`scripts/release.sh` publishes it and Launchway deploys the published release.
