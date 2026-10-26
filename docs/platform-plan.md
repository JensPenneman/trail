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
| `GET` / `POST /api/v1/shares`, `DELETE /api/v1/shares/{id}` | `shares:read` / `shares:write` | outgoing shares |
| `GET /api/v1/shares/incoming`, `POST …/incoming/{id}/hide` | `shares:read` / `shares:write` | incoming shares |
| `GET` / `POST /api/v1/share-links`, `DELETE …/{id}` | `shares:read` / `shares:write` | public links |
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
timeout, retries with backoff, `User-Agent: Trail/<version> (+<PUBLIC_URL>)`,
a daily byte budget `PROCESSING_OVERPASS_DAILY_MB` (300), a 20 MB response cap
and strict parsing. One query per tile: every `highway=*` except
proposed/construction/abandoned, railways (`rail|light_rail|tram|subway|
narrow_gauge|funicular`), `route=ferry`, and the POIs above, with `out geom`.
A missing tile leaves the window `needs_map`; the queue retries it later and
everything else proceeds. A self-hosted extract can implement the same
interface later.

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
  `recipient_user_id` null (bound when the address has an account, at creation
  or at sign-up), `device_ids` uuid[] null, `precision`
  `precise|approximate|area`, `history_days` int null (null = live only),
  `include_details` bool (battery and mode; default true), `expires_at` null,
  `created_at`, `revoked_at`, `hidden_at` (set by the recipient),
  `last_viewed_at`. Partial unique `(owner_user_id, recipient_email)` where
  `revoked_at` is null; at most 50 active per owner.
- `share_links` — `id`, `owner_user_id`, `token_hash` unique, `label` (shown to
  visitors; defaults to the owner's first name), `device_ids` null,
  `precision`, `history_days` null, `include_details` (default false),
  `expires_at` not null (default 24 h, at most 30 days), `created_at`,
  `revoked_at`, `view_count`, `last_viewed_at`. Secret `trls_` + 32 bytes; URL
  `${PUBLIC_URL}/s/<secret>`.

### 4.3 Access rules

- `resolveAccessibleDevices(viewer, requestedDeviceIds?)` →
  `[{ deviceId, ownerId, precision, from, includeDetails }]`: the viewer's own
  devices (precise, unbounded) plus the devices of active incoming shares (not
  revoked, expired or hidden; `from` = now − `history_days`, or now − the live
  window for live-only shares). Every v1 read goes through it; mutations keep
  `findOwnedDevice`.
- Projection: coordinates of a non-precise device are snapped to a grid
  (approximate 0.005°, area 0.05°) with a per-device deterministic offset, so
  repeated reads cannot be averaged back to the real position; the reported
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
owner when it is hidden or accepted. People and Map pages update from these;
the public page polls.

### 4.5 Public links

- `/s/:token` is a public SPA route (no session): a minimal page with the
  label, a map centred on the latest position(s), freshness, mode and battery
  where included, "Updated every 15 s", the expiry, and no navigation. It calls
  `GET /api/public/shares/:token` (per-IP 60/min; 404 for unknown, expired or
  revoked; `Cache-Control: no-store`), which bumps `view_count` at most once a
  minute per link.
- Tokens are redacted from logs (`/s/`, `/api/public/shares/`); the page sends
  `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`.

### 4.6 UI

- **People** page (new primary item): "People who share with me" (cards as in
  §4.1) and "You share with" (status, devices, precision, expiry, stop). A
  **Share my location** dialog: email (suggesting people who share with me),
  devices, precision, history, duration; it says "They will see you as soon as
  they sign in" when the address has no account; admins get a one-click invite.
- Settings › **Sharing**: public links (create with label, devices, precision,
  history and expiry; copy, QR, revoke; views and last viewed) and the outgoing
  shares.
- Map: the person selector (§6) shows a person's devices in their own colours;
  a person card focuses the map.
- No e-mail notifications yet: the `share` event plus a notice on the People
  page is enough.

### 4.7 Endpoints

See §1.3, plus `GET /api/public/shares/:token`. Pending shares are claimed in
`finishSignUp` by matching the address.

---

## 5. MCP server

### 5.1 Transport and auth

- `POST`, `GET` and `DELETE /mcp`: MCP Streamable HTTP, **stateless** (a new
  transport per request, JSON responses enabled), built with the official
  TypeScript SDK v2 (`@modelcontextprotocol/server` with its Express adapter;
  fall back to v1 `@modelcontextprotocol/sdk` only if the adapter does not work
  with Express 5, and say why in the pull request). Mounted before `compress`
  and the generic `/api` chain, body limit 1 MB, per-token limiter.
- Auth: `Authorization: Bearer trlk_…` (§2); scopes gate tools. 401 carries
  `WWW-Authenticate: Bearer realm="trail", error="invalid_token"`. No OAuth
  yet; documented as the follow-up (protected-resource metadata plus an
  authorization server on top of the token system).
- Server info: name `trail`, the build version, and an `instructions` string
  about units, time zones and privacy.

### 5.2 Tools

Every tool returns `structuredContent` and a short text; coordinates are WGS84;
times are ISO with the owner's offset.

| Tool | Scope | Purpose |
|---|---|---|
| `list_devices` | `devices:read` | devices with status, last seen, battery, current mode |
| `get_current_location({ device? })` | `locations:read` | latest position, accuracy, age, speed, mode, battery; `device` by id or exact name; default = the most recently seen device |
| `get_location_at({ at, device?, toleranceMinutes? })` | `locations:read` | the nearest point around a time (default tolerance 30 min) |
| `get_timeline({ from, to, device? })` | `locations:read` | stops and moves with mode, distance, duration, speed — the appointment agent's main tool |
| `get_day_summary({ date, device? })` | `locations:read`, `history:read` | distance and time per mode, first and last movement, stops |
| `get_visits({ from, to })` | `locations:read` | as the API (visits are places) |
| `get_trips({ from, to })` | `history:read` | as the API |
| `set_transport_mode({ mode, device?, until? })` | `locations:write` | the quick override (§3.5) |
| `get_people` | `people:read` | people sharing with the owner and their projected location |

Resources: `trail://devices` and `trail://devices/{id}/location`. No prompts.
Limits: at most 31 days per call and 500 items per result; a capped result
tells the caller how to narrow the request.

### 5.3 Docs

`docs/mcp.md`: what it is, create a token with the Agent template, connect from
Claude Code (`claude mcp add --transport http trail https://trail.jenspenneman.com/mcp
--header "Authorization: Bearer …"`) and from other clients (Streamable HTTP
with a bearer header), the tool reference, privacy notes. Linked from README
and Settings › API tokens. An MCP smoke test in the integration suite uses the
SDK's client to call `tools/list` and one tool against the test server.

---

## 6. Navigation and the Map page

### 6.1 Routes

Signed-in: `/` **Map**, `/people`, `/devices`, `/devices/:id`, `/settings`
with sections as sub-routes (`/settings/profile|passkeys|tokens|sharing|data|
people|about`; the bare `/settings` goes to profile; existing anchors keep
working). Public: `/login`, `/invite/:t`, `/link/:t`, `/s/:t`. Redirects:
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
