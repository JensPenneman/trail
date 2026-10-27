# Platform plan 2 (October 2026): People home, Settings, access log, Insights

The shared brief for the second round of platform work, after 0.3.0:

- **People becomes the home page** and absorbs the map (navigation: People ·
  Devices · Insights · Settings).
- **Settings** is rebuilt as a tree of pages in the style of the iPhone's
  Settings app.
- **A data access log**: every read of a person's data is recorded — who, when,
  through which channel, which data — with an overview of who looked.
- **Insights**: statistics about how you travelled, with charts.

`docs/architecture.md` stays the specification: every pull request updates
the sections it touches. `docs/platform-plan.md` (the first round) and this
document are deleted by the last pull request of this round.

---

## 0. Rules for every pull request

The rules of the first plan hold unchanged (contracts first, errors, security
defaults, tests at every level, one migration per PR regenerated on rebase,
docs, signed Conventional Commits, no AI mentions, budgets, single-instance
assumptions, branch dependencies). In addition:

1. **Threat-model before coding.** For every new endpoint, event, table and
   page: who may read or change what, through which principal and scope; what
   a recipient, a link visitor, a token holder and the owner learn about each
   other. Write it in the PR.
2. **Coordinates need `locations:read`; coordinate-free data needs the
   matching read scope.** A new scope needs a migration of the
   `api_tokens_scopes_check` constraint, a row in `apiScopeDescriptions`, and
   the matching row in `docs/api.md` (a test compares them).
3. **A new environment variable** goes into `envSchema.ts`, `loadConfig.ts`,
   `deploy/.env.example`, `deploy/compose.yaml`, `docs/architecture.md` §4 and
   `tests/e2e/support/serverEnvironment.ts`.
4. **A new user-data table** is added to `laterTables` in
   `apps/api/tests/integration/migrationUpgrade.test.ts`.
5. **OpenAPI**: every route has `summary`, `description`, examples; the
   snapshot (`apps/api/tests/unit/__snapshots__/openapi.json`) is refreshed
   deliberately (`npm test -w @trail/api -- -u`) and reviewed in the diff.
6. **Web**: plain CSS with the design tokens, the primitives in
   `apps/web/src/ui`, dark mode, forced-colors, reduced motion, keyboard
   operable, axe green, no console errors; 320 px phones through desktop.
7. **Dev container** for anything that needs Postgres or browsers;
   e2e only under the machine-wide lock
   (`E2E_WORKERS=4 lockf -t 5400 /tmp/trail-e2e.lock scripts/devc.sh npm run test:e2e`).

---

## 1. Navigation and the People home page

**Done** (`feat/people-home`): `docs/architecture.md` §14 is the
specification now; §1.4 lists what the pull request settled.

### 1.1 Tabs

**People · Devices · Insights · Settings**. `/` is People. `/people`
redirects to `/` (parameters kept); `/?view=…` keeps working. The phone tab
bar has four items; desktop shows the same four in the header.

### 1.2 The People page (= the Map page of 0.3.0 plus the people list)

- One map with the three views **Live · History · Heat**, the person selector,
  the device filter, the level control and the style control, exactly as the
  Map page has them, plus the people list of the former People page in the
  side panel (desktop) / the sheet (phones): a **Me** card first (with the
  device cards and the upload feed when Me is selected), then a card per
  person sharing with me, the **Share my location** button, and a short
  "You share with N people" line linking to Settings › Sharing.
- Selecting a card selects that person (the URL `people=` parameter as today;
  "Everyone" when two or more share with me). With **Me** selected the page
  offers everything the Map page offered: levels, timeline, segment
  corrections, quick-mode chips, heatmap, visits and trips. With another
  person selected: Live shows their positions; History shows their track only
  when their share allows it (precise with history) and otherwise a calm
  notice; Heat, levels, timeline and corrections are hidden (not disabled)
  because the API does not offer them for other people.
- Person markers, colours, cards, the share dialog and the stop-share dialog
  are the existing components. The former People page's own small map goes.
- Deep links: a person card's "Show on map" selects that person on this page;
  `/?view=live&people=<userId>` still works.

### 1.3 Redirects to keep

`/people` → `/`; `/history`, `/explore` as today; `/settings/...` as §2.6.
`isSignedInPath` follows.

### 1.4 Settled in the pull request

1. **Choosing someone.** A card's **Show on map** makes that person the
   map's choice, alone, or — for someone on the map already — only moves the
   camera to them; **Show everyone** (two or more sharing) toggles between
   everyone and Me alone; the person selector in Map options stays for any
   mix. Me alone is the default and is not remembered.
2. **Without Me** the page has no Heat in the view switch, no level control
   or legend, no timeline, corrections, visits or trips (not disabled: not
   there). An address with `view=heat` and no Me shows Live and keeps its
   `view`, so choosing Me again brings Heat back.
3. **The Me card** holds Live's device cards and the upload feed while Me is
   on the map; otherwise it shows a line (devices, how many live, the last
   upload) and Show on map. History's and Heat's details stay above the
   people, as on the Map page.
4. **One's own shares** live in Settings › Sharing (Change, Stop, Confirm);
   People has the line "You share with N people" (and how many wait for a
   confirmation) leading there. The stop-share dialog is on the card of
   someone one shares back with, next to "You share with <name>".
5. **Coarse positions**: the camera frames an approximate or area share's
   whole circle, not its centre, which would pass for an exact spot.
6. **Tabs**: Insights was not on `main` yet, so the tab bar has People ·
   Devices · Settings; `feat/insights` adds its item between Devices and
   Settings.
7. **Code**: the page is `pages/people/PeoplePage.tsx` (the Map page moved
   there); the views and the map's controls stay in `pages/map`. "The sheet"
   on phones is the page below the map, as on the Map page.

---

## 2. Settings in the style of the iPhone

**Done** (`feat/settings-shell`): `docs/architecture.md` §14 (and §8 for the
preferences) is the specification now; §2.7 lists what the pull request
settled.

### 2.1 Shape

- **Root** (`/settings`): a search field, then grouped lists of rows. A row
  has an icon tile, a label, an optional value on the right and a chevron;
  some rows are switches. Tapping a row pushes a page; pages can have rows of
  their own (two to three levels deep). A page has a back control and its
  title; on phones the title starts large and collapses on scroll, on desktop
  the tree is a sidebar on the left with the page on the right (System
  Settings style), the sidebar showing the same groups and highlighting the
  current page.
- **Search** filters the rows of all pages by label and keywords (client-side
  index of the tree), showing matches with their path ("Privacy & data ›
  Public links").
- **Transitions**: a short slide on phones, none with `prefers-reduced-motion`.
- **Focus and titles**: as today (`useRouteFocus`, document title
  "<page> · Settings"); every page is a landmark with its heading.

### 2.2 Tree

| Group | Row → page | Deeper |
|---|---|---|
| Account | Profile `/settings/profile` | — |
| Account | Passkeys `/settings/passkeys` (list, add, one-time link) | `/settings/passkeys/:id` rename, delete |
| Account | Browsers `/settings/browsers` (sessions) | revoke one / others |
| Privacy & data | Sharing `/settings/sharing` (people you share with, share dialog) | `/settings/sharing/:shareId` devices, precision, history, expiry, last looked, stop |
| Privacy & data | Public links `/settings/links` | `/settings/links/:id` label, scope, expiry, QR, views (§3), revoke |
| Privacy & data | Who viewed you `/settings/privacy/viewers` (§3, second wave) | per actor `/settings/privacy/viewers/:actor` |
| Privacy & data | Access log `/settings/privacy/access-log` (§3, second wave) | — |
| Privacy & data | Your data `/settings/data` (export, delete a range, delete account) | — |
| Developer | API tokens `/settings/tokens` | `/settings/tokens/:id` scopes, devices, expiry, usage (§3), roll, revoke |
| Developer | MCP `/settings/mcp` (how to connect, Agent template shortcut) | — |
| Developer | API reference → `/docs` (external row) | — |
| App | Preferences `/settings/preferences` (§2.4) | — |
| App | Notifications `/settings/notifications` (device alerts overview; ntfy status) | — |
| App | About `/settings/about` (version, build, ingest URL, sign out) | — |
| Admin (admins only) | Accounts `/settings/accounts` (invitations, accounts) | — |

Rows that need data (e.g. "Public links — 3 active", "API tokens — 2") show
their count as the right-hand value.

### 2.3 Components

`apps/web/src/settings/`: `SettingsShell` (root/sidebar/page frame, back
control, large title), `SettingsGroup` (titled inset list with footer text),
`SettingsRow` (icon, label, value, chevron | switch | external), `SettingsPage`
(title, description, children), `SettingsSearch`, `useSettingsTree` (the
tree as data: id, path, group, label, icon, keywords, adminOnly, badge
loader). Existing section components are reused inside the pages.

### 2.4 Preferences (new, small API)

`users.preferences jsonb NOT NULL DEFAULT '{}'` (migration), validated by
`preferencesSchema`: `mapStyle` (auto|light|dark|satellite), `level`
(raw|averaged|mapped|inferred), `showOwnActivity` (bool, default false; §3).
`PATCH /api/me { preferences }` merges fields; `SessionUser` carries
`preferences`. Precedence on the web: URL parameter › localStorage ›
server preference › built-in default (`useTrackLevel`, `useMapStyle`).

### 2.5 Tests

Unit: the tree (paths, admin gating, search index, old-anchor mapping);
e2e: every page renders and is accessible (axe) on desktop and iPhone,
deep links, back navigation, search, the switch rows, 320 px.

### 2.6 Redirects

`/settings/people` → `/settings/accounts`; old anchors keep mapping; the
section ids of 0.3.0 keep their paths where the table above keeps them.

### 2.7 Settled in the pull request

1. **`/settings`** is the list on phones and opens the first page (Profile)
   beside the list from 64rem; the Settings tab leads there. An anchor of
   0.2's single page opens its page (`#browsers` → Browsers, `#link` →
   Passkeys › `#passkey-link`); one for administrators only, or none, shows
   `/settings` itself. Non-administrators who open Accounts land on
   `/settings`.
2. **The tree is data without requests**: the start-up code reads it for
   `isSignedInPath`. A row's badge names its value (`badge: "tokens"`), and
   `useSettingsTree` makes the values from the lists the pages load anyway
   (one cache). Values: the display name, passkeys, browsers, people shared
   with, working links ("3 active"), active tokens, alerts On/Off, the
   version; Accounts has none (it would load the administrators' account
   list on every visit).
3. **Back** goes back in the history when the page was opened from the one
   above it (the row puts its address in the location's state), otherwise to
   the page above; coming back, focus returns to the row of the page that was
   left. Search results lead to the heading of their part (`#export`), which
   takes focus. After deleting a passkey, stopping a share or turning off a
   link, the page goes back to its list the same way.
4. **A public link's QR code** is on its page right after it is made, once:
   the secret exists only in the answer to making it and is held in memory
   (not in the history's state) until the page is left. Later visits say why
   it cannot be shown again. Turning a link off asks first.
5. **Who viewed you and Access log** are pages with an informative empty
   state that point to what Sharing, Public links and API tokens show today.
   `/settings/privacy/viewers/:actor` comes with wave 2, with the actor key of
   the access-log API.
6. **Preferences** store only what was set (`{}` for everyone else), read
   with defaults (a value a later release wrote reads as the default); the
   merge happens in the statement; unknown names are refused. Saving the map
   style or level forgets this browser's own choice of it, so the browser
   follows the account again; Satellite is offered only where the server has
   imagery. `showOwnActivity` is stored now for the access log of wave 2.
7. **Not in this round**: renaming a token or changing its scopes on its page
   (the API has `PATCH /api/me/tokens/:id`; the page shows them), and the
   usage of tokens, the views per day of links and what a person looked at
   (wave 2, §3.6).

---

## 3. Data access log

### 3.1 What is recorded

Every read of a person's location data, and the writes that change it or who
may see it, from every channel:

| Channel | Actor | Example actions |
|---|---|---|
| `web` | the owner's own browser session | tracks, timeline, heatmap, visits, trips, raw points, export |
| `api` | an API token | every v1 operation |
| `mcp` | an API token through a tool | `get_timeline`, `set_transport_mode`, … |
| `people` | a person the owner shares with (their session or token) | `getPerson`, `getPersonTrack`, `listPeople` |
| `live` | a person receiving `person` events | live position pushes (counted per hour) |
| `link` | an anonymous visitor of a public link | the public share view (counted per hour per visitor) |

Writes count too: segment/device mode changes (`web`, `api`, `mcp`), shares and
links created, changed, confirmed or revoked, tokens created, rolled or
revoked, deletions of a range. Account deletion removes the log with the
account.

### 3.2 Storage

`data_access_events`: `id` bigint identity; `owner_user_id` (cascade);
`bucket_start` timestamptz (UTC hour); `first_at`, `last_at`; `count` int;
`actor_kind` (`owner|person|link|token`); `channel` (§3.1); `actor_user_id`,
`actor_session_id`, `actor_token_id`, `actor_share_id`, `actor_link_id` (null
where not applicable; sessions and tokens may be deleted later, so the row
also stores `actor_label` as a snapshot: the session's user-agent label, the
token's name, the link's label, the person's display name); `visitor_key`
(links only: HMAC of masked IP + user-agent family with the server secret —
same visitor, same key; never reversible) with `ip_coarse` (IPv4 /24,
IPv6 /48 as text, e.g. `81.82.83.0/24`) and `ua_family` ("iPhone · Safari");
`action` (v1 `operationId`, private route name, `mcp.<tool>`, `link.view`,
`live.position`); `access` (`read|write|export`); `resource` jsonb
(`deviceIds`, `from`, `to`, `level`, `precision`, `mode` — never
coordinates); `status` smallint; `dedupe_key` text (hash of actor, channel,
action, resource). Unique `(owner_user_id, bucket_start, dedupe_key)`;
indexes `(owner_user_id, last_at desc)`, `(actor_token_id, last_at desc)`,
`(actor_link_id, last_at desc)`, `(actor_share_id, last_at desc)`.

Retention `DATA_ACCESS_RETENTION_DAYS` (default 365), pruned hourly with the
other expiries. This is a log, not location data: the "raw data forever"
rule does not apply.

### 3.3 Recording

`ctx.dataAccess.record(event)` buffers in memory (keyed by owner + bucket +
dedupe) and flushes every 2 s or 500 distinct events with one
`INSERT … ON CONFLICT DO UPDATE SET count = count + excluded.count, last_at =
greatest(...)`; flushed at shutdown; a failure is logged and never fails a
request. Nothing in the buffer or the rows contains coordinates or secrets.

Instrumentation points (one each, no per-route boilerplate where avoidable):

- **v1**: `defineRoute` gets an optional `access` entry in the spec:
  `{ kind?: "read"|"write"|"export", resource?: (input, result) => Resource,
  owners?: (input, result) => { ownerUserId, resource }[] }`. Scoped routes
  record automatically after a 2xx response: `action = operationId`, `kind`
  from the method, `resource` from the validated params/query (`device`,
  `devices`, `from`, `to`, `level`, `userId`), owner = the principal's user.
  People routes set `owners` to the people whose data was returned (one event
  per owner, channel `people`). Public and token-verify routes record nothing.
- **Private `/api` reads** (session): tracks, heatmap, stats, visits, trips,
  locations (raw), export (`export`), through one helper called in each
  handler; device lists, config and health are not recorded.
- **MCP**: in `runMcpWork` (the central wrapper): action `mcp.<name>`,
  resource from each tool's `describeAccess(args)`; `get_people` records one
  event per person shown.
- **Public link**: in `loadPublicShare`: owner = link owner, actor `link`,
  `visitor_key`/`ip_coarse`/`ua_family` from the request.
- **Live**: in `publishPeopleLater`: one event per recipient per owner per
  hour, `count` = pushes.
- **Writes outside v1** (tokens, device deletion, range deletion): explicit
  calls.

### 3.4 Reading

Scope **`audit:read`** (new; sessions hold it; the Read-only template gains
it, Agent does not). Owner-only; nobody else can read it, no admin either.

- `GET /api/v1/access-log?from&to&actor=owner|person|link|token&channel&action&cursor&limit≤200`
  → `{ items: [{ id, bucketStart, firstAt, lastAt, count, actorKind, channel,
  actor: { kind, userId?, displayName?, tokenId?, tokenName?, linkId?,
  linkLabel?, shareId?, sessionLabel?, visitor?: { key, ipCoarse, uaFamily } },
  action, access, resource, status }], nextCursor }`, newest first.
- `GET /api/v1/access-log/summary?days=7|30|90` → totals per actor kind and
  channel, per-day series, top actors (people, links with distinct visitors,
  tokens) with counts and last seen, and the owner's own activity separately.
- The dashboard calls both with the session; `showOwnActivity` (§2.4) only
  changes the default filter.

### 3.5 Threat model (write it in the PR)

The log tells the owner who looked (intended; the sharing guide says so to
recipients). It must not expose a recipient's IP to the owner (only links have
coarse IPs, and visitors are anonymous anyway), must not be readable by anyone
but the owner, must not leak coordinates, must not be forgeable through user
input (actions and resources come from the server, labels are capped and
cleaned), must not slow or fail requests, and must not grow without bound
(hour buckets, retention).

### 3.6 UI (second wave, inside the new Settings)

- **Who viewed you** (`/settings/privacy/viewers`): period 7 · 30 · 90 days;
  headline tiles (people, link visitors, token calls, MCP calls, your own
  sessions); a list of actors with counts and last seen; tapping one opens
  its timeline (hour buckets with what was read). A line per person reads
  like "Alice looked at your live position 14 times and your history twice,
  last on Tuesday 18:03".
- **Access log** (`/settings/privacy/access-log`): the filterable list
  (actor kind, channel, period, action), own activity hidden unless the
  preference says otherwise, infinite scroll, each row expandable to the
  resource details.
- **Token detail** shows its usage (calls per day, last actions); **Link
  detail** shows views per day and distinct visitors; **Share detail** shows
  what that person looked at.
- A card on Insights ("Who viewed you this month") links here.

### 3.7 Settled in the pull request (feat/data-access-log)

What the UI wave needs from §3.1–§3.5 as built (docs/architecture.md §8.7 has
the whole of it; the shapes are `packages/contracts/src/dataAccess.ts`):

- **Actors** are a union on `actor.kind`: `owner` (`sessionLabel`), `token`
  (`tokenId`, `tokenName`), `person` (`userId`, `displayName`, `shareId`,
  null when unknown) and `link` (`linkId`, `linkLabel`, `visitor` —
  `{ key, ipCoarse, uaFamily }`, null for the visitors counted together).
  Names are the current ones while the actor exists, else the ones they had.
- **A person's own credentials are not recorded**: a recipient's session,
  token, browser and address stay out of the owner's log (they are the
  recipient's); `actor = the principal` means the person, whichever
  credential they used. Their reads through the MCP server are `people`
  rows too, with the action `mcp.get_people`.
- **Live** rows are per recipient, device and hour (`resource.deviceIds`),
  not per recipient and owner only.
- **Bounded growth** needs more than hour rows: beyond 50 distinct rows of
  one action by one actor in an hour, the rest folds into one row with
  `resource: { folded: true }`; beyond 50 visitors of a link in an hour, the
  rest are counted on one row with `visitor: null`. Show them as "… and N
  more".
- **Order and paging**: newest hour first, within an hour by dedupe key; the
  cursor is keyed on `(bucket_start, dedupe_key)`, the unique key, which never
  changes once a row exists. A line's `id` is `<hour>.<dedupe key>`, opaque
  and stable (never the table's identity column, whose gaps would tell how
  much other accounts are read). The UI may sort an hour's rows by `lastAt`
  itself.
- **Indexes**: the unique key `(owner_user_id, bucket_start, dedupe_key)`
  serves the list, the summary and the retention (PostgreSQL 18 skips through
  it per owner), so there is no `(owner_user_id, last_at)` index; the actor
  indexes are on `bucket_start` too. Nothing indexed changes when a row is
  counted again, and `fillfactor = 70` keeps those updates heap-only.
- **Instrumentation**: `defineRoute`'s spec takes `access: false |
  { kind?, people? }`; what only the handler knows comes with its result:
  `owners` (the people routes; a person's track names the share it was read
  through) or `resource` (a new share's or link's id). MCP tools return
  `access` with their answer (the devices they resolved — an agent may name a
  device — or `get_people`'s owners) instead of a `describeAccess(args)`.
- **Actions** outside v1 and MCP: `dashboard.tracks`, `dashboard.heatmap`,
  `dashboard.statsDays`, `dashboard.statsActivity`, `dashboard.visits`,
  `dashboard.trips`, `dashboard.locations`, `dashboard.export`,
  `dashboard.deleteLocations`, `dashboard.deleteDevice`,
  `dashboard.createApiToken`, `dashboard.updateApiToken`,
  `dashboard.rollApiToken`, `dashboard.revokeApiToken`; `mcp.resource.devices`,
  `mcp.resource.device_location`; `link.view`; `live.position`.
- **Summary**: `people[].actions`, `tokens[].actions` (with `api` and `mcp`
  counts) and `links[].visitors` carry what the sentences of §3.6 need;
  `own` holds the owner's sessions by browser. `audit:read` needs a token
  for every device (a token limited to some is refused with 403
  `insufficient_scope`; the token dialog does not offer it then).

---

## 4. Insights

**Done** (`feat/insights`): `docs/architecture.md` §8.7 (the API), §14 (the
pages and the charts) and §17 (`wayKinds`, versions per level) are the
specification now; §4.6 lists what the pull request settled.

### 4.1 Pages

- `/insights` **Overview**: period selector (7 days · 30 days · 90 days ·
  this year · all · custom range; `?from&to` or `?period=`), device filter;
  headline tiles (distance, time on the move, moves, stops, active days);
  **transport breakdown**: a horizontal bar per mode (distance share) and a
  stacked bar chart per day/week/month (by period length) with a legend; a
  table of modes (distance, time, moves, average speed, share) where every
  row links to its mode page; a "compared with the previous period" delta
  per tile; a "processing still catching up" note when the queue has work in
  the range.
- `/insights/transport/:mode` **Mode page** (cycling, car, train, …): tiles
  (distance, time, moves, average and typical speed, longest, fastest);
  **by time of day** (24 bars, distance or time) and **by weekday**;
  **roads** (car, cycling, bus, walking, running: distance by road class —
  motorway, trunk, primary, secondary, tertiary, residential, service,
  track, cycleway, footway, path — as a bar list; train/tram/metro: rail
  share and station stops; boat: ferry share); **top moves** (longest,
  fastest, most recent five: date, distance, duration, average speed, with
  "Show on the map" opening `/?view=history&date=…&segment=<id>`);
  **speed distribution** (histogram of segment median speeds).
- `/insights/time` **When you travel**: an hour × weekday grid (heat cells)
  for time on the move, switchable per mode.
- `/insights/roads` **Roads**: distance by road class across modes, with a
  mode switch.

Data is the owner's own (devices filter); people are out of scope for now.

### 4.2 API (`history:read`, coordinate-free; tag "Insights")

- `GET /api/v1/insights/overview?from&to&devices` → `{ timezone, period,
  previous, totals, modes: [{ mode, distanceM, durationS, moves, avgSpeedKmh,
  share, deltaDistanceM }], series: [{ bucket, mode, distanceM, durationS }],
  pending: boolean }`; `bucket` is a local day, week or month depending on
  the span (≤ 31 days → day, ≤ 26 weeks → week, else month).
- `GET /api/v1/insights/modes/{mode}?from&to&devices` → tiles, `byHour` (24
  × distance/time), `byWeekday` (7 ×), `roads` (by `WayKind`, distance), `rail`
  / `ferry` shares where relevant, `stationStops`, `speedHistogram`
  (km/h buckets), `topMoves` (segment id, startedAt, endedAt, distanceM,
  durationS, avgSpeedKmh, maxSpeedKmh; no coordinates).
- `GET /api/v1/insights/time?from&to&devices&mode` → the 7 × 24 grid.
- `GET /api/v1/insights/roads?from&to&devices&mode` → distance by `WayKind`
  and by family.
- Limits: ≤ 3 years per call; everything computed from `segments` (prorated
  by overlap with the local-day buckets like `loadModeStats`), so no table
  scan of points.

### 4.3 Processing change (same PR)

`segments.features` gains `wayKinds: Record<WayKind, number>` (distance
share per road class, from the mapped points of the move; null without map
data) next to the family shares. Bump the inferred-level processing version
so the backfill recomputes features from the stored mapped points (no map
fetch needed); the CLI `trail reprocess --from-level inferred` does the same
on demand. MCP `get_day_summary` and the mode stats are unchanged.

### 4.4 Charts

`apps/web/src/charts/`: `BarChart` (grouped/stacked, horizontal or
vertical), `LineChart`, `Histogram`, `HeatGrid`, `StatTile`, `Legend`,
`ChartTable` (the data as a table in a disclosure, like
`ActivitySparkline`). Inline SVG, responsive (viewBox + ResizeObserver),
design tokens (`--mode-*` for modes, a neutral sequential ramp for the grid),
dark mode and forced-colors, pointer and keyboard tooltips (each mark
focusable, `aria-describedby`), `<figure role="img" aria-label>` with a text
summary, no animation under reduced motion, no new dependency. Before
designing them, read the `dataviz` skill (colour, form and accessibility
rules) and follow it.

### 4.5 Tests

Unit: the aggregation (proration across day/DST boundaries, previous-period
deltas, bucket choice, road shares), chart helpers (scales, ticks, summary
text); integration: every endpoint incl. scope and device restriction, the
pending flag, empty periods; e2e: Overview with uploaded fixture data (modes
inferred by the pipeline in the test server — use a fixture journey with at
least two modes), navigate to a mode page, switch periods, keyboard through a
chart, axe on every page, 320 px.

### 4.6 Settled in the pull request

1. **Periods are local days**, `from` and `to` included (like
   `/api/v1/stats/modes`), at most three years apart (the day before the same
   date three years on). Both may be left out: `to` is today, `from` the first
   day with a stop or move (at most three years back). The page's "All" asks
   without `from`. The period before is as many days just before `from`.
2. **Proration happens in TypeScript**, not SQL: one query reads the moves
   overlapping the period from `segments`, and the period's local hours
   (23 or 25 on the days the clocks change) split them by time, the distance
   in proportion. That keeps the proration unit-tested, DST included, and a
   request of three years builds its 26 000 hours in about 30 ms. Counts
   (moves, stops, the statistics of whole moves) are of what started in the
   period.
3. **Shapes beyond the list of §4.2**: `period` carries `bucket` and every
   step (`buckets`), since `series` leaves out empty steps; a mode's page has
   a `series` too (its line chart), `typicalSpeedKmh` (the median of the
   moves' median speeds, weighted by time), `longest` and `fastest` (top
   speed); `stationStops` counts halts at stations for trains, at tram stops
   for trams and at metro stations for metros; time and roads list the modes
   of the period (`modes`) for the mode switch; roads give `mappedM`, the
   distance the shares are of. `wayKinds` stores every kind, families are
   derived from it.
4. **Versions per level**: `processingVersion` became `processingVersions`
   (averaged 1, mapped 1, inferred 2); the backfill starts at the lowest
   level that changed, so production re-runs only the inference, on its
   stored mapped points.
5. **The figure is not `role="img"`**: its marks are focusable, and a role
   with presentational children would hide them (axe `nested-interactive`).
   The figure is named by its visible title and described by its visible
   summary; the SVG is a group of marks, each an image named by its row and
   described (`aria-describedby`) by its values, all one tab stop with arrow
   keys.
6. **Colour**: the `--mode-*` palette fails the categorical checks of the
   dataviz method for some neighbours (walking and running, train and boat),
   so stacks carry 2 px gaps, a legend, tooltips and a table, keep the modes'
   fixed order and fold past seven modes into "Other modes". The grid's
   ramp (`--heat-*`) is a warm grey checked for monotone lightness.
7. **"Show on the map"** opens `/?view=history&date=…&segment=<id>`; the
   History view opens that move's dialog, and closing it drops `segment`.
8. **Not done here**: people in Insights (their shares give no segments),
   comparisons against the same period a year before, and the access log's
   card (wave 2).

---

## 5. Delivery

| Wave | Branch | Owns | Migration |
|---|---|---|---|
| 1 | `feat/people-home` | §1 | — |
| 1 | `feat/settings-shell` | §2 (pages of §3.6 get their routes and empty states only) | `preferences` |
| 1 | `feat/insights` | §4 incl. the processing feature | — |
| 1 | `feat/data-access-log` | §3.1–§3.5 (API only) | `data_access_log` (incl. the `audit:read` scope) |
| 2 | `feat/access-log-ui` | §3.6, the Insights card, token/link/share detail usage | — |

Merge order in wave 1: people-home → settings-shell → insights →
data-access-log (each rebased, migration regenerated, OpenAPI snapshot
refreshed, CI green, reviewed). Wave 2 starts on main after wave 1.
Release 0.4.0 after wave 2; both plan documents are deleted in the last PR.
