# Browser cache and delta sync — design

A design, not yet the specification: `docs/architecture.md` stays the
specification, and the pull requests that build this fold its decisions into
§8 (conditional answers, the day stamps), §9 (event ids and resume), §12 (what
the browser keeps) and §14 (the cache, the freshness line, offline), and
remove this document, as the platform plans were removed by the last pull
request of their round. Wherever it names a limit, the number is a proposal
to be held or changed by measurement, never a guess dressed as a fact.

**The brief.** Open Trail and see what it showed last time at once — one's
own map, the day so far, the people — and only then stream in what changed;
hide a slow server behind what the browser already has; and at about a
thousand accounts on one node, make every dashboard open cost the server
less: deltas instead of whole answers, `304 Not Modified` instead of bodies,
a live stream whose reconnects do not stampede. All of it thoroughly tested.

## 0. The decisions in one screen

- **Own data only on disk.** The browser keeps the signed-in person's own
  data in IndexedDB: devices, today's tracks and timeline, the history days
  and ranges they looked at, heat views, Insights, the calendar's days.
  Other people's positions and tracks, public link pages, the access log,
  tokens, passkeys, browsers, shares and links stay in memory for the tab's
  life, as today. One owner per browser profile; another account signing in
  wipes the store first.
- **Stale-while-revalidate, never stale-as-live.** What the store holds is
  painted first with an honest freshness line ("Updated 3 min ago",
  "Updating…", "Offline · as of 10:32"), then revalidated. Whether a position
  is "Live" is still decided from its own time against the clock, never from
  when it was fetched.
- **Stamps, not cursors.** A delta of a simplified track or an inferred
  timeline is not composable, a day is: every day-sliced answer carries a
  *stamp* per device and local day, the calendar's digest (`/api/stats/days`)
  carries the same stamps, and equal stamps mean the identical answer. A
  cached day is served without a request while its stamps match; a range is
  revalidated with `If-None-Match` and a `304` that costs the server one
  cheap query instead of a track build.
- **Events with ids.** `/api/events` numbers its events per user, keeps the
  last two minutes in memory and replays them to a stream that comes back
  with `after=<id>`; a gap too old answers `resync`. A `days` event carries
  fresh stamps after the daily statistics ran, so the Devices page stops
  polling. Session re-checks are batched, reconnects are jittered, and a
  restart no longer turns into ten thousand refetches.
- **TanStack Query stays the one cache.** Its experimental per-query
  persister (`@tanstack/query-persist-client-core`) is wired to a store of
  our own in IndexedDB that validates every entry against the contracts with
  zod on the way in, keeps budgets (32 MB soft, 64 MB hard per owner), packs
  points into typed arrays, and purges on sign-out, on a lost session, on an
  owner change and on the device toggle. A service worker precaches the
  app's shell so Trail opens offline; it never touches `/api`.
- **A look is a request.** The data access log records a `304` like a `200`
  (status 304); a view painted offline is not a look until the
  revalidation that follows reports it.
- **Behind a device toggle**, on by default: Settings › Preferences › "Keep
  a copy of your data on this device", with the size and a button to clear
  it. Nothing about the cache leaves the device: the counters live in
  Settings › About.

## 1. Where the time goes today

A cold open of People (Live, Me) makes nine requests:

| Request | What the server does | Cost (estimate) |
|---|---|---|
| `GET /api/auth/session` | one indexed lookup | < 1 ms |
| `GET /api/config` | from memory | — |
| `GET /api/devices` | the user's device rows | ~1 ms |
| `GET /api/v1/people` | shares, devices, grid projection, `touchShareViews` | 2–5 ms |
| `GET /api/tracks` (today, raw) | pages of 20 000 points, RDP importance, distance (§8.1) | 10–40 ms per device-day of 5 000 points |
| `GET /api/v1/tracks?level=inferred` (today) | processed points and segments of the day, simplified | 10–40 ms |
| `GET /api/v1/segments` (today) | the day's stops and moves | 1–3 ms |
| `GET /api/v1/devices/{id}/mode` | the toggle in force | ~1 ms |
| `GET /api/events` | a stream: session lookup, a ping every 20 s with a session re-check | ~1 ms, then one query per 20 s per stream |

History's prev/next day costs the three heavy ones again per day; the Devices
page polls `/api/stats/days` every 10 s while uploads come in; Heat asks for
the viewport (< 10 ms, §8.2) after every pan.

Honest arithmetic for a thousand accounts: five opens a day each is 5 000
opens, perhaps 150 ms of server time per cold open, about 13 minutes of CPU a
day — nothing. What loads one node is the phones (a thousand of them
uploading once a minute is 17 uploads a second at 30–150 ms each, §8.2), the
processing worker and its map fetches, and the peaks: every open page
reconnecting and refetching everything after a restart, or everybody opening
Trail in the same minute after a notification. So the cache is a latency win
first — a slow server stops mattering for what the browser already holds —
and a load win at the peaks, where whole answers turn into `304`s and the
restart storm is spread and mostly empty. The design says which is which.

## 2. What is cached, and for how long

### 2.1 Kinds of data

- **Live** — devices (positions, battery, status), the people list, the
  current mode: changes with every upload, pushed by events. Painted from
  the store, revalidated at once, kept current by the stream.
- **Today** — tracks, level tracks, timeline, visits, trips of the current
  local day: grows all day, changes when processing catches up. Painted from
  the store, revalidated at once with `If-None-Match`; unchanged → `304`.
- **Settled days** — any past local day. Not immutable: a phone that was
  offline uploads a week-old day later (`recorded_at` old, `received_at`
  new), a deletion removes points, a new release's backfill rewrites the
  processed levels. So a past day is *settled while its stamps match the
  digest* (§4.1), and nothing is assumed from its age.
- **All-time** — the heatmap's cells per viewport and the yearly totals:
  change with every upload, cheap on the server, worth painting at once.
- **Lists** — Settings' lists, the access log, tokens: memory only.
- **Other people's** — memory only (§2.5).

### 2.2 Per query

`fresh` is how long the entry is shown without asking (TanStack's
`staleTime`); `validate` what a revalidation sends; `ttl` how long an entry
may live untouched before the sweep removes it; `warm` whether it is restored
before the first paint (§3.4). Keys are the existing ones of
`apps/web/src/api/queryKeys.ts`.

| Query (key) | On disk | Warm | Fresh | Validate | TTL | Kept current by |
|---|---|---|---|---|---|---|
| `config` | yes | yes | 1 h | — | 30 d | — |
| `devices` | yes | yes | 30 s | ETag | 30 d | `device`, `device-removed` |
| `tracks` today | yes | yes | 0 | ETag (a `304` when nothing arrived) | until the day ends + 7 d | `ingest.points` appended; the 20 s refetch, now a `304` |
| `tracks` past day | yes | — | ∞ while stamps match, else 0 | stamps (digest), else ETag | 90 d since last touched | `days` event |
| `tracks` range | yes | — | 0 | ETag | 90 d | — |
| `level-tracks` today / day / range | yes | today | as `tracks`, with the processed stamp | stamps / ETag | as `tracks` | `segments` event |
| `timeline` today / day / range | yes | today | as `tracks` | stamps / ETag | as `tracks` | `segments` |
| `visits`, `trips` day / range | yes | — | as `tracks` (raw stamp) | stamps / ETag | 90 d | `days` |
| `days` (a month, the 400-day totals) | yes | the current month | 60 s | ETag | 90 d | `days` event, in place |
| `heatmap` (bbox, zoom, devices) | yes, the last 20 | — | 5 min | ETag | 30 d | — |
| `insights` (page, params) | yes | — | 5 min | ETag | 30 d | `segments` |
| `device-mode` | yes | the device that reported last | 30 s | — | 1 d | `segments` |
| `activity` (48 h) | yes | — | 5 min | — | 7 d | `ingest` |
| `ingest-log` (device, 20) | yes | — | 0 | — | 7 d | `ingest` |
| `session` | no — the probe gates every paint (§5.2) | — | 5 min | — | — | `session-ended` |
| `people`, `person-tracks`, `shares`, `incoming-shares`, `share-links` | no | — | as today | — | — | `person`, `share` |
| `public-share`, `link-info` | no | — | as today | — | — | — |
| `access-log` (lines, summary, recent), `passkeys`, `sessions`, `api-tokens`, `invites`, `admin-users`, `locations` pages | no | — | as today | — | — | — |

`ingest-log` and `activity` are worth a line: the Devices page is the proof
that data keeps arriving, and a feed from two days ago painted under "Updated
2 days ago · updating…" is still a better first screen than a skeleton.

### 2.3 Keys

The store's key is `${cacheFormat}|${owner}|${queryHash}`:

- `cacheFormat` — a constant in `apps/web/src/cache/cacheFormat.ts`, bumped
  by any change to the shape *or the meaning* of what is stored (the IndexedDB
  database version follows it; `onupgradeneeded` clears the store). A change
  the contracts catch needs no bump: an entry that fails its schema is dropped
  on hydration.
- `owner` — the account id from the session probe. The one owner the store
  holds is also in a `meta` record; a probe that names another account wipes
  the store before anything is restored (§5.3).
- `queryHash` — TanStack's deterministic hash of the query key, which already
  holds everything an answer depends on: the range (`from`, `to`), the
  devices (`deviceIds`, null for all), the `level`, a heat view's `bbox`,
  `zoom` and devices, an Insights page's period, devices and mode, a
  person's share id and history (`share: "<id>:<days>"`, were it ever on
  disk). Processing versions are not in the key: a backfill changes a day's
  processed stamp, which is what invalidates it (§4.1); the version itself
  is part of that stamp.
- The owner's **time zone** is in the entry's `scope`: day-keyed answers
  (`days`, `tracks` of local days, `timeline`, `insights`) are the zone's,
  and an entry from another zone is dropped on hydration. Changing the zone
  in Settings › Profile rebuilds the statistics on the server (§10) and
  starts the browser afresh for those entries.

### 2.4 Budgets and eviction

Sizes, measured against the contract's limits: a device-day of raw track
(≤ 8 000 points × 6 numbers) is ~1 MB as nested arrays in memory and
~300 KB as JSON, 256 KB packed (§3.3); a level track ≤ 8 000 × 3 numbers
≈ 100 KB packed; a day's timeline ≤ 1 000 segments ≈ 300 KB; a heat view
≤ 20 000 cells ≈ 240 KB packed; a month of day totals a few KB. A day of
one device at every level is therefore ~0.7 MB; a 93-day range is capped
per device the same way.

- **Soft budget 32 MB, hard budget 64 MB per owner** (the sum of the
  entries' `bytes`, counted by the store itself; `navigator.storage.estimate()`
  is read for the About page only). Past the soft budget the sweep removes,
  least recently touched first, heat views beyond the newest 20, then settled
  days and ranges, then Insights; never the warm set, never today. Past the
  hard budget nothing is written until the sweep ran. An entry over 4 MB is
  never written (a defence, not an expectation: no contract allows one).
- **TTL** per the table, counted from `touchedAt` (last shown), swept at
  start-up and once an hour while open.
- **`QuotaExceededError`** on a write: sweep to half the soft budget and
  retry once; a second failure turns persistence off for this page load
  (memory only, a counter in About), never an error on screen.
- **What the browsers give.** Chrome and Firefox allow an origin a share
  of the disk (gigabytes on a laptop, hundreds of megabytes on a phone) and
  evict whole origins least-recently-used under pressure unless storage is
  persistent; Safari gives a home-screen web app a store of its own and may
  delete a site's script-writable storage after seven days of Safari use
  without a visit (ITP). Trail asks for `navigator.storage.persist()` once
  (Chromium grants it without a prompt to an installed or much-used site,
  Firefox asks, Safari does as it pleases) and treats every loss as what it
  is, a cold open: the store is a copy, never the only one.

### 2.5 Never on disk

- **Other people's data.** The people list (their positions within their
  share's window), their tracks, the shares in both directions and the
  links: a stopped, ended, hidden or coarsened share shows nothing "from that
  moment on" (§8.5), and a copy on disk cannot learn of a moment that passed
  while the browser was closed. In memory the existing rules hold:
  `forgetShareInCache` on `share` events, `gcTime: 0` for person tracks,
  keys that carry the share's id and history. A warm open paints one's own
  map at once; the cards of others fill from `GET /api/v1/people`, which
  `main.tsx` starts together with the session probe, so on a healthy server
  they arrive with the first paint anyway. Putting them on disk behind a
  second toggle, with a purge list from the server, is an open question (§9),
  not part of this round.
- **The public link page** (`/s#<secret>`): no session, the secret in the
  fragment, nothing written; the service worker serves the shell and the
  page asks the network as today.
- **The access log** and its summaries: a record of who looked at you, read
  from the server when the page opens; a copy would keep other people's names
  on disk for no gain.
- **Secrets**: one-time secrets (tokens, links, device credentials) live in
  component state and never in a query; the session cookie is `HttpOnly`;
  the store never holds a credential of any kind. Passkeys, browsers
  (addresses), tokens, invites, the administrators' lists: memory only.
- **Mutations**: never persisted, never queued (§6.3).

## 3. Storage

### 3.1 The library choice

`persistQueryClient` (the whole cache dehydrated into one blob, rewritten
throttled on every change) is the wrong shape for arrays of points: the blob
would be re-serialised on every `ingest` event. TanStack Query 5's
`experimental_createQueryPersister` from `@tanstack/query-persist-client-core`
persists *per query*: `persisterFn` wraps every `queryFn`, restores a stored
entry on first mount — with the entry's own `dataUpdatedAt`, so freshness and
`staleTime` behave as if the data had just been fetched then — resolves it at
once and refetches in the background when it is stale; `persisterRestoreAll`
restores a set before anything renders; `persisterGc` sweeps; `buster`,
`maxAge`, `filters`, `serialize`/`deserialize` are hooks. It takes any
`AsyncStorage` (`getItem`, `setItem`, `removeItem`, `entries`).

Decision: use it for the TanStack integration — the timing of `setState`
against a mounting query is the fiddly part, and it is theirs to keep right —
with a storage of our own underneath that does what the persister does not:
the owner, the scope, the contracts on hydration, the budgets, the packing of
points, the purge paths, the counters. The `experimental_` prefix is a risk
(§9): the integration is one file (`cache/queryPersister.ts`) and the storage
is independent of it, so swapping the persister for a hand-written
`persisterFn` later is a bounded change.

### 3.2 The store

`apps/web/src/cache/` (one file per purpose, as everywhere):

- `cacheFormat.ts` — `export const cacheFormat = 1`.
- `openCacheStore.ts` — opens IndexedDB `trail-cache`, version `cacheFormat`,
  object store `entries` keyed by `key`, indexes `owner`, `touchedAt`,
  `warm`; a `meta` store with `{ owner, timezone, bytes }`. Every access in
  try/catch: a browser without IndexedDB (private windows in some
  configurations) runs memory only.
- `cacheEntry.ts` — the record:

  ```ts
  interface CacheEntry {
    key: string;          // `${format}|${owner}|${queryHash}`
    owner: string;        // user id
    scope: { timezone: string };
    resource: string;     // the key's first element ("tracks", "level-tracks" …)
    fetchedAt: number;    // the server's answer (dataUpdatedAt)
    touchedAt: number;    // last shown, for the sweep
    expiresAt: number | null;
    etag: string | null;  // the answer's ETag, for If-None-Match
    stamps: DayStamp[] | null; // per device and local day (§4.1)
    warm: boolean;
    bytes: number;
    body: unknown;        // packed (§3.3) or structured-clone as answered
  }
  ```
- `cachePolicy.ts` — the table of §2.2 as data: per resource `persist`,
  `warm`, `freshMs`, `ttlMs`, `validate: "etag" | "stamps" | "none"`,
  `maxEntries`, and the codec.
- `cacheKey.ts`, `encodeEntry.ts`, `decodeEntry.ts` (the contract's schema
  with `safeParse` on every hydration; a failure deletes the entry and counts
  `invalid`), `pointCodec.ts`, `sweepEntries.ts`, `purgeCache.ts`,
  `cacheStats.ts`, `useCacheEnabled.ts`, `stampsMatch.ts`,
  `restoreWarmSet.ts`, `queryPersister.ts` (the persister with its
  `AsyncStorage` over the store), `cachedFetch.ts` (`apiFetch` with
  `If-None-Match`, §4.2).
- `createQueryClient.ts` gains `defaultOptions.queries.persister` when the
  device toggle is on; queries that must never persist (the §2.5 lists) set
  `persister: undefined` in their hook, and the policy refuses any resource
  it does not list, so a new query is memory-only until someone adds it to
  the table on purpose.
- Tabs share the store; a `BroadcastChannel("trail-cache")` carries purges
  and the toggle, so a sign-out in one tab empties the others (which also
  get `session-ended` from the stream).

### 3.3 Packing points

IndexedDB stores structured clones; an array of 8 000 six-element arrays is
~50 000 heap objects to clone, write, read and clone again. `pointCodec.ts`
packs a `TrackPoint[]` into columns — `Float64Array` lon and lat, `Int32Array`
t, `Float32Array` speed, accuracy and altitude with `NaN` for null — one
`ArrayBuffer` of 32 bytes a point, and unpacks in a tight loop (8 000 points
in about a millisecond). The same for level tracks (`[lon, lat, t]`) and heat
cells (`[lon, lat, count]`). The entry's `body` keeps the answer's shape with
the arrays replaced by `{ packed: ArrayBuffer, n }`; `decodeEntry` restores
the tuples and only then runs the contract's schema, so what the app sees is
exactly what `apiFetch` would have handed it. Everything else is stored as
answered.

### 3.4 Hydration: the warm set before paint, the rest as it comes

Before the router renders, `restoreWarmSet` reads the owner's `warm` entries
(the index; a few hundred KB to 4 MB) and hands them to
`persisterRestoreAll`, in parallel with the session probe. Whichever takes
longer decides the first paint; on a 4G phone the probe does. A warm read
slower than 300 ms stops waiting: the page paints with what is in, the rest
arrives through the persister. Everything not warm is restored on mount, one
`getItem` (one to five milliseconds) per query, which is why the first
History day you step to shows its skeleton for a frame and the calendar's
dots do not.

### 3.5 The service worker: the shell, never the API

Without a service worker there is no offline open at all: `index.html` is
`no-cache` and a browser that cannot revalidate shows its own error page. So
`scripts/build.mjs` runs `workbox-build`'s `generateSW` after `vite build`
(no Vite plugin: the repository already has one build script, and
`vite-plugin-pwa` would be a second place deciding what is built and how
the registration is injected, with the CSP to keep in mind at each of its
options; `generateSW` is one call with a manifest of globs) and writes
`apps/web/dist/sw.js`:

- precache `index.html`, `/assets/**` (hashed, `immutable` already), the
  manifest and icons, each revisioned;
- `navigateFallback: "/index.html"` with a denylist of `^/api/`, `^/docs`,
  `^/mcp`; `/s` is a navigation like any other (the fragment never reaches a
  request URL);
- **no runtime caching**: no route for `/api/**` — the API's cache is the
  store, with its owner, its purges and its contracts, and a second cache
  without them would be a liability; `/api/events` and the public link's
  header-carried secret never pass through it;
- `skipWaiting` and `clientsClaim`: a new build takes over on the next open;
  a lazy chunk of the old build that is gone is a chunk-load error the app
  already answers with a reload (`isChunkLoadError`).

`main.tsx` registers `/sw.js` after load, same origin (`worker-src 'self'`
allows it); the API serves it `no-cache` like every non-asset file. Cookies
are untouched: a page's `fetch` through a worker carries the same
`SameSite=Strict` cookie it would without one, and the shell is public.
The e2e `staticAssets.spec.ts` gains the worker file and its headers.

### 3.6 Memory on phones

Nothing on disk is in memory until shown. `gcTime` for settled days and
ranges is lowered to 2 minutes (the disk has them), person tracks keep 0,
the warm set the default 5 minutes. The packed buffers are decoded on
restore and discarded; the QueryClient holds tuples as today. A page that
browses forty days of History holds forty entries on disk and a handful in
memory.

## 4. Delta sync

### 4.1 Stamps: per device and local day

Why not `since` cursors: `GET /api/locations` already has one for raw
points, but the dashboard draws derived answers — a track simplified to a
budget over the whole range, a timeline cut into stops and moves across the
window the worker chose — and a delta of a derived answer is not composable.
A local day is: every day-sliced answer is a function of a day's recorded
rows and their processing, and the daily statistics already describe a day
in four numbers. So the unit of delta is the day, and the question "did this
day change?" is answered by a stamp.

**`DayStamp`** (`packages/contracts/src/cacheStamp.ts`):

```ts
{ deviceId, date, raw: string, processed: string | null }
```

- `raw` = `${points}.${firstAt}.${lastAt}.${visits}.${trips}` from
  `daily_stats` (`points`, `first_at`, `last_at`; the owner's zone) and the
  counts of visits and trips recorded in the day. Any upload that adds
  points to the day, any deletion, any visit or trip arriving changes it;
  a re-sent upload of duplicates changes nothing, as it changes no data.
- `processed` = `${count}.${maxComputedAt}.${minVersion}.${pending}` over
  the day's `segments` (`(device_id, started_at)` index) and
  `hasPendingWork` for the day; null while the day has no segment. A window
  the worker finishes rewrites the day's segments and processed points
  together (§17.4), so `max(computed_at)` moves whenever either level did;
  `pending` is true while a queued window overlaps the day, and a day with
  points but without segments (a two-minute blip) stays null and is
  refetched each time — a few hundred bytes.
- The strings are opaque to the browser: it compares them, never parses
  them. The server builds them in `apps/api/src/cache/dayStamps.ts` from one
  range scan of `daily_stats` per device, one of `visits`, one of `trips`,
  one aggregate over `segments` and one over `processing_queue`: for a
  month of a device, under two milliseconds; never from `locations` or
  `processed_points`.
- **Stamps are read before the data.** A handler loads the stamps of the
  range first and the points after; an upload that lands between the two is
  in the data and not in the stamps, so the next comparison refetches once
  — the safe direction. The daily statistics lag an upload by ten seconds
  (the debounce), which is the same direction. The opposite order could
  stamp an answer as newer than it is, and the browser would keep it until
  the next change: the order is an invariant with a test.

Every day-sliced answer carries its stamps, an additive field:
`tracksResponse.stamps`, `levelTracksResponse.stamps`,
`timelineResponse.stamps`, `visitsResponse.stamps`, `tripsResponse.stamps`
(a `DayStamp[]` over the devices and the local days the range intersects,
for v1 routes in the OpenAPI document, snapshot refreshed on purpose). The
digest is `GET /api/stats/days` (and `/api/v1/stats/days`): each row gains
`stamp: { raw, processed }`.

**What the browser does with them.** A cached past day with a `days`
answer for its month in memory and fresh (60 s) is settled when the stamps
match — `raw` for tracks, visits, trips and `level=raw`; `raw` and
`processed` for level tracks, the timeline and Insights — and its
`staleTime` is infinite (`staleTime` is a function of the query in TanStack
5): stepping back through History asks the server for nothing it saw before.
A mismatch sets `staleTime` 0: the entry is painted and refetched whole,
with its ETag for the case where the server finds the data unchanged after
all. Ranges skip the comparison and use their ETag.

### 4.2 Conditional requests

`Cache-Control: no-store` stays on every `/api` answer, and Express's own
ETag stays off (`app.set("etag", false)`): the browser's HTTP cache is not
the cache, and hashing bodies that are never stored is wasted work. Chosen
routes compute a cheap **validator before the heavy read**, send it as a
weak ETag, and answer `304` with no body when `If-None-Match` names it:

| Route | Validator (read first, in that order) |
|---|---|
| `GET /api/devices` | `count`, `max(greatest(updated_at, last_seen_at, battery_recorded_at))` over the user's devices |
| `GET /api/tracks`, `/api/visits`, `/api/trips` | the `raw` stamps of the range's device-days (`daily_stats`) |
| `GET /api/v1/tracks`, `GET /api/v1/segments` | the `raw` and `processed` stamps of the range |
| `GET /api/stats/days` | the body (≤ 800 small rows: hash it) |
| `GET /api/heatmap` | `sum(points_total)` and the ids of the devices asked for (an upload of inaccurate points alone changes the sum and not the cells — a needless `200`, never a wrong `304`) |
| `GET /api/v1/insights/*` | `count`, `max(computed_at)`, `min(version)` over the period's segments, `pending` |
| `GET /api/v1/people` | the body (projection is cheap; the saving is bytes and parsing, and nothing of theirs is on disk anyway) |

The ETag is `W/"` + the first 22 base64url characters of
`sha256(ownerId + route + canonical validator)` + `"`: the owner is in it, so
an ETag from one account never matches another's answer, and the comparison
happens after the principal is known, in the handler. A `304` keeps
`Cache-Control: no-store`, `ETag` and `X-Request-Id`, carries no body and is
compressed by nobody. `apps/api/src/cache/weakEtag.ts`,
`cache/answerConditionally.ts` for the dashboard's routers; `defineRoute`
gains `304` in `SuccessStatus` with `responses: { 304: null }`, the
request's `If-None-Match` in the handler's input and `etag` in its result,
and `send` sets the header on `200` only after the schema parsed the body.

In the browser `cachedFetch.ts` sends `If-None-Match` with the entry's
`etag` and, on `304`, hands the persister the stored body with a new
`fetchedAt`; `apiFetch` itself is unchanged, and a `304` it did not ask for
stays `invalid_response`. A `304` from the browser's own HTTP cache cannot
happen: nothing is stored under `no-store`, so the response reaches `fetch`
as the server sent it.

### 4.3 Events: ids, resume, the `days` event, storms

Today a stream that drops loses what was sent meanwhile, so every reconnect
refetches ten query families (`resyncAfterGap`); after a restart every open
page does, at once. Changes (`apps/api/src/events/`):

- **Ids.** The bus numbers events per user (`seq`, in memory) and keeps a
  ring of the last 256 events or two minutes per user (`eventRing.ts`,
  ~50 KB at most per user, swept when the user's last stream closes).
  Every message carries `id: <seq>`.
- **Resume.** `GET /api/events?after=<seq>` (the query, since the browser's
  `EventSource` cannot set `Last-Event-ID` on a stream the page reopens
  itself; the header is honoured too) replays the ring from `seq + 1` when
  it still holds it, else sends `resync` first; the browser keeps the last
  id per tab in memory and calls `resyncAfterGap` on `resync` only — no
  longer on every reconnect. A fresh process has an empty ring and answers
  `resync` to everyone, which is right: it may be a new release.
- **`days`** `{ deviceId, days: DayStamp[] }`: published by the daily
  statistics scheduler after a pass, to the owner's streams, so the Devices
  page's 10-second polling of `/api/stats/days` while uploads come in goes
  (the browser updates the month's `days` entry in place and marks the
  named days stale), and `ingest` keeps today's points and the feed live as
  now. `segments` keeps its shape; the browser marks the days it names
  stale instead of every level track and timeline in memory.
- **`hello`** gains `versions` (`processingVersions`): a page that stays
  open across a release learns of a new version and lets the next stamps do
  the rest; nothing in the browser depends on it beyond a line in About.
- **Session re-checks in one query.** The ping stays at 20 s, but the
  router checks every stream's session in one statement per tick
  (`activeSessions(ids)`: `id = ANY($1) AND expires_at > now()`) instead of
  one per stream — at a thousand streams, three queries a minute instead of
  fifty a second.
- **Storms.** `retry:` is per stream and jittered (3 000–8 000 ms; it only
  matters for the browser's own reconnects, the page's are jittered
  already), a global cap of 5 000 streams answers `503` with a random
  `Retry-After` of 10–30 s above it (the 10 per user stays), and the
  browser spreads the post-`resync` refetch over 0–20 s. After a restart a
  thousand pages then make, over twenty seconds, one `devices` request
  (`304` when nothing changed), one `people` request, one `tracks` of today
  (`304` when the phone was idle), one `level-tracks` and one `timeline`
  (`304`) each: some 250 requests a second at the peak, most of them one
  cheap query, instead of ten thousand whole answers in a burst.

### 4.4 Per open, before and after

| | Cold open (today) | Warm open, nothing changed (after) | Warm open, an upload meanwhile |
|---|---|---|---|
| Requests | 9 | 9 (one of them the stream) | 9 |
| Bodies | 6 full answers, ~1 MB | `config` and `people` only; `devices`, `tracks`, `level-tracks`, `segments` are `304`s | the three heavy ones again |
| Server time | ~100–150 ms | ~10 ms | ~100 ms |
| First paint with data | after the heavy three | after the probe | after the probe |
| History, a day seen before | 3 heavy requests | 0 requests (stamps) | a full refetch of that day only |
| Devices page while uploads come in | `/api/stats/days` every 10 s | the `days` event | the `days` event |
| Restart with 1 000 open pages | ~10 000 refetches in seconds | ~5 000 requests over 20 s, ~80 % `304` | — |

### 4.5 The data access log

A look is a request. A `304` is recorded exactly as a `200` would be — the
same action, the same resource, `status: 304` — by `recordDashboardAccess`
(called after the empty answer) and by `defineRoute` (`result.status`), so
"you looked at 26 October" stays true whether the day came down the wire or
was confirmed unchanged. A view painted from the store without asking (a
settled day; anything while offline) is not in the log, and the
revalidation that follows is; for a settled own day that is the next time
its stamps are checked, which the owner's own log is the only one to
notice. Other people's data is never painted without a request (§2.5), so
every look at a person is a line in their log as today, and the
`live.position` counting of pushed positions is unchanged. The access log's
sentences treat 304 as a look; the status is shown in the line's details.

## 5. Privacy and security

### 5.1 Threat model

| Threat | Answer |
|---|---|
| Someone with the browser profile reads the store (a shared computer, a lost laptop without disk encryption) | Only the owner's own data is on disk, and only what they looked at; the toggle (§5.4) turns it off and clears it; sign-out clears it; nothing of other people's, no secrets. Phones and modern desktops encrypt the disk; the store relies on that like the browser's own history does. |
| A script in the origin (an XSS through a dependency; Trail has no inline scripts and a strict CSP) reads the store | Encryption at rest would not help: a key the page can use, a script in the page can use; a non-extractable `CryptoKey` in IndexedDB stops only key export, not decryption. Not worth its cost (§9). What limits the blast radius is §2.5: the store holds what the same script could fetch from the API with the session anyway. |
| A session revoked from another browser, or expired, while this browser was closed | Nothing is painted before the probe answers (§5.2); a `401` purges the store. |
| A session revoked while this browser is offline | The probe cannot run; the store is shown under "Offline" until the network returns, then purged. Accepted: it is the owner's own data on their own device, and the alternative is no offline at all. |
| Another account signs in on the same browser | The probe names an owner the `meta` record does not: the store is cleared before any entry is restored, and the new owner starts cold (§5.3). |
| A poisoned entry (another script, a browser bug, a half-written record) | Only `cachedFetch` writes, from same-origin `fetch` with `credentials: "same-origin"`; every hydrated entry passes the contract's zod schema and the owner and scope checks, else it is deleted and counted; IndexedDB writes are atomic per record, so there is no half-written entry, only a missing one. The service worker never caches an API answer. |
| An ETag from one account used for another's answer | The owner is in the hash and the comparison happens after the principal is known; a test asserts no `304` across accounts. |
| The store fills the disk, or a huge answer | Contract limits bound every answer (8 000 points, 20 000 cells, 1 000 segments a page); the budgets and the 4 MB entry cap bound the store; `QuotaExceededError` degrades to memory only. |
| Event replay to the wrong stream | The ring is per user and the stream's user is the session's; `after` is a number, not a capability; replayed events are the ones the user's streams got anyway. |
| The public link page keeps a visitor's view | Nothing is written; the secret stays in the fragment and a header, as today. |
| A `304` hides a look | It is recorded with status 304 (§4.5). |

### 5.2 The probe gates every paint

`RequireSession` keeps showing `AppLoading` until `GET /api/auth/session`
answers, as today. The warm set is restored meanwhile, so the first paint
after a `200` is the whole page with data; after a `401` the store is purged
and the sign-in page comes. Offline (`navigator.onLine` false, or the probe
failing with `network`), the shell paints from the store under the offline
banner. A slow server is not offline: the probe is the cheapest request
there is, and a page that painted personal data before the server said who
is looking would be a page that paints it for a revoked session.

### 5.3 Purge paths

`purgeCache(reason)` clears the owner's entries and the `meta` record, tells
the other tabs, and resets the counters. It runs on: sign-out
(`useSignOut.onMutate`, before the request, like `sessionEndedOnPurpose`),
account deletion, a lost session (`isSessionLost` anywhere, the
`session-ended` event), an owner mismatch at start-up, the time zone changing
(day-keyed entries only), the device toggle turned off, and `cacheFormat`
changing. `forgetShareInCache`, `removeDeviceFromCache` and the other
in-memory helpers keep doing their work; `removeDeviceFromCache` also deletes
the device's entries from the store (its points are gone on the server too).

### 5.4 The device toggle

Settings › Preferences › **On this device** — "Keep a copy of your data on
this device" (a switch, on by default): "Shows your map at once when you
open Trail and works when you are offline. Turn it off on a shared
computer." Below it the size ("12.4 MB") and **Clear the copy**. It is this
browser's setting, not the account's (`localStorage` `trail.cache`, `"off"`
to opt out; read before hydration), because it is about the device. Off:
nothing is written, the store is cleared, the service worker stays (it holds
the public shell only).

## 6. UX

### 6.1 What the person sees first

A warm open of People paints the header, the Me card with the day so far,
the map with today's track and the latest own positions from the store, and
a **freshness line** in the page head (`FreshnessIndicator`, next to the
connection indicator): "Updated 3 min ago" while the store's copy is on
screen, "Updating…" while a revalidation runs, "Live" once the stream is
open and the live queries are fresh, "Offline · as of 10:32" when the
browser is offline. The cards of others show their skeletons until the
people answer. History's existing "Updating" chip and the dimmed refetch of
Insights keep their roles; a settled day shows no chip at all.

### 6.2 The live window rule

"Live" on a card, a pulsing marker, a speed on the Me card: all of it is
decided from the position's own time (`lastSeenAt`, `recordedAt`) against
the clock (`deviceStatus`, `describeMe`), never from when the data was
fetched — so a copy fetched an hour ago cannot show Live, since nothing in
it is newer than the copy. The rule the cache adds: while the stream is not
open and the newest answer is older than the live window (15 min), the Me
card and the markers show the time ("as of 10:32") instead of "Live", and
the head says so. `RelativeTime` ticks on screen; the `aria-live` region of
the freshness line announces state changes only, at most once a minute.

### 6.3 Offline

Read-only. The banner is already there ("You're offline. Trail shows what
it had loaded…"); with the store it shows what it had kept, too. Every
mutation (the quick toggle, a mode correction, shares, settings, tokens) is
disabled with the reason: uploads are the phones' job, a toggle "from now"
set offline means nothing an hour later, and a correction queued offline
would meet a recompute on arrival. No write queue, no conflicts. Online again
(`online`, visibility), the stream reconnects with `after`, the live queries
revalidate, the sweep runs.

### 6.4 Accessibility

The freshness line is text with an icon, `role="status"`, polite, and never
the only cue: the "Updating" chip stays `aria-hidden` as the line already
says it; the offline banner is a status region. Nothing new moves; the
pulsing marker stops where it stopped before. Settings' rows follow
`SettingsRow` (a switch, a value, an action); About's counters are a
definition list. axe runs on the new states in the e2e suite.

## 7. Testing

### 7.1 Unit (Vitest)

`apps/web/tests`, jsdom with `fake-indexeddb` (new dev dependency,
`import "fake-indexeddb/auto"` in a setup file of these tests only):

- `cacheKey.test.ts` — format, owner, hash; two owners never share a key;
  the same devices in another order are the same key (TanStack hashes
  object keys sorted but arrays in order, and the selection hands the
  hooks ids in the order the lists came: `cacheKey` sorts id lists before
  hashing).
- `pointCodec.test.ts` — round trip of `TrackPoint`, level points and heat
  cells, nulls as `NaN` and back, empty tracks, 50 000 points under 20 ms; a
  property test (lengths, random values).
- `cacheStore.test.ts` — put/get/delete, the owner index, `meta`, a store
  that throws (no IndexedDB) → memory only, `QuotaExceededError` → sweep
  then retry, a bump of `cacheFormat` clears.
- `decodeEntry.test.ts` — an entry that fails its schema is dropped and
  counted; another owner's, another zone's, another format's are dropped;
  a packed body decodes to what the schema expects.
- `sweepEntries.test.ts` — the soft budget, least recently touched first,
  heat beyond 20, the warm set and today never swept, the TTLs, the 4 MB
  cap.
- `stampsMatch.test.ts` — raw for raw-level queries, raw and processed for
  the others, a null processed stamp never matches, a missing digest row
  never matches.
- `cachedFetch.test.ts` — sends `If-None-Match`, `304` keeps the body and
  bumps `fetchedAt`, a `304` without an entry is `invalid_response`.
- `queryPersister.test.ts` — the persister restores with the entry's
  `dataUpdatedAt`, a stale entry refetches in the background, a settled day
  has an infinite `staleTime`, a resource not in the policy is never
  written.
- `purgeCache.test.ts` — every path of §5.3; the broadcast.
- `useServerEvents.test.tsx` extended — the last id, `after` on reconnect,
  `resync` runs `resyncAfterGap` and a plain reconnect does not, the spread
  of the refetch, `days` updating the month in place, `segments` marking
  days.
- `applyServerEvent.test.ts` extended — the same, cache side.
- The pages' tests (`PeoplePage`, `DevicesPage`, `InsightsPages`) with
  `mockApi` answering `304` and stamps: a warm render shows the store's
  data with the freshness line, then the revalidated data.

`apps/api/tests/unit`: `dayStamps.test.ts` (the canonical strings, null
processed, pending), `weakEtag.test.ts` (owner in the hash, stable, 22
characters), `eventRing.test.ts` (256 or two minutes, replay from a seq, too
old → null, swept when empty), `defineRoute.test.ts` extended (`304` in the
spec, the header only after the parse, the access record with status 304).

### 7.2 Integration (supertest)

- `conditionalAnswers.test.ts` — for every route of §4.2: a first `200` with
  an ETag; the same request with it → `304`, no body, `no-store`; an upload,
  a deletion, a correction, a processed window → `200` with a new ETag; a
  second account's ETag → `200`; stamps in the answer equal the digest's
  rows; the order invariant (an upload committed between the stamps and the
  points, with a hook in the test build, yields data newer than its stamps
  and a `200` on the next conditional request, never a `304` that hides it).
- `dayStamps.test.ts` — `/api/stats/days` and `/api/v1/stats/days` carry
  stamps; the raw stamp changes on upload, deletion, a visit and a trip, not
  on a re-sent batch; the processed stamp on a finished window and on a
  correction, `pending` while a window waits; another zone gives other days.
- `events.test.ts` extended — ids on every message, `after` replays, too old
  → `resync`, a fresh process → `resync`, `days` after the statistics ran,
  `hello.versions`, one session query per tick for many streams (count the
  statements), jittered `retry`, the global cap's `503` and `Retry-After`.
- `dataAccessRecording.test.ts` extended — a `304` recorded with status 304
  on the dashboard's routes and on v1, with the same resource as the `200`.
- The OpenAPI snapshot refreshed on purpose and read in the diff.

### 7.3 End to end (Playwright, Chromium desktop and iPhone)

`tests/e2e/cache.spec.ts`, with a `cacheState(page)` support that reads the
store through `page.evaluate` (`indexedDB.open("trail-cache")`), and a
`slowApi(page, routes, ms)` that delays chosen routes with `page.route`:

- **Cold against warm.** Sign up, upload the fixture, open People, wait for
  the track and the timeline. Reload with `/api/tracks`, `/api/v1/tracks` and
  `/api/v1/segments` delayed 5 s: the summary and timeline are visible within
  1 000 ms of `goto` (`performance.mark("trail:first-data")`, exposed as
  `window.trailE2eMarks`), the freshness line says "Updated … ago", then
  "Updating…", then the requests complete with `304` (asserted from
  `page.on("response")`) and the line says "Live".
- **A settled day.** Open History on yesterday, reload, step back and
  forward: no request for `/api/tracks` with yesterday's range (a
  `page.on("request")` counter), the digest request once; upload a point for
  yesterday, wait for the `days` event (the calendar dot changes), step to it
  again: one full request.
- **Offline and back.** `context.setOffline(true)`: the banner, the data
  stays, the quick toggle and Share my location are disabled with the reason,
  reload still shows the page (the service worker) with "Offline · as of …";
  `setOffline(false)`: "Updating…", then "Live", a stream reconnect with
  `after` (the request's URL).
- **Sign-out purges.** After sign-out the store has no entries and no
  `meta`; a second tab (`openBrowser` with the same `storageState`) empties
  too.
- **Two accounts.** Sign in B after A without signing A out (revoke A's
  session through the API): the store holds B's owner only; A's entries are
  gone.
- **A lost session.** Revoke the session from another browser while the
  page is closed; reopen: the sign-in page, and an empty store; while open:
  `session-ended` empties it.
- **Version bump.** Seed an entry with `format: 0` and a `meta` of the
  current owner; reload: the store is empty, no console error.
- **Corruption.** Seed an entry whose body fails the contract, one with a
  foreign owner, one with another zone: all three gone after the open, the
  page intact, no console error (the guard fails on any).
- **The cap.** Seed 70 entries of 1 MB (packed buffers) touched at
  different times: after the open the store is under 32 MB, the warm set
  and today's entries are there, the oldest heat views are not.
- **Quota.** `addInitScript` makes `IDBObjectStore.prototype.put` throw
  `QuotaExceededError`: the page works, nothing is written, About says
  "memory only".
- **Replay.** Abort `/api/events` with `page.route` for 10 s while an upload
  arrives, release it: the reconnect carries `after`, the device card and
  today's points update from the replay, and no `/api/tracks` refetch
  happens (the counter); then the same with the ring overflowed while the
  stream is down (130 one-point uploads: each is an `ingest` and a `device`
  event, more than the 256 the ring keeps) → `resync` → the refetches,
  spread.
- **The toggle.** Off: the store empties, a reload shows skeletons; on
  again: a warm open after the next.
- **Access log.** `accessLog.spec.ts` extended: a warm open of History's
  yesterday shows "looked at your history" with a 304 line in the details;
  nothing new for people (unchanged).
- **The worker and the shell.** `staticAssets.spec.ts`: `/sw.js` is served
  `no-cache` with the right type, the precache lists `index.html` and every
  chunk, `/api/*` is not in it.
- axe on the freshness states, Preferences and About; 320 px.

What Playwright cannot cover, written down as a checklist in this document's
successor section of §16 and walked on a real iPhone before the release that
turns the toggle on by default: a home-screen install opens warm, opens
offline, survives eight days without a Safari visit (the Safari-tab case may
lose the store, which must be a cold open and nothing worse), and behaves
under low storage. The suite's iPhone project is Chromium (passkeys), so
these stay manual.

### 7.4 Load

`scripts/load/dashboardOpens.mjs` (not in CI; run in the development
container against its database): makes N accounts and sessions directly
(rows in `users` and `sessions`, the token's SHA-256 as the id), uploads a
day per account, then replays with `autocannon` (new dev dependency) the
request sets of §4.4 — cold, warm-unchanged, warm-after-upload — and a
restart's reconnect wave (`/api/events?after=` for every session at once),
reporting req/s, p50/p95/p99 and the container's CPU. Targets to hold at
N = 1 000 on the Launchway node: a warm-unchanged open under 5 ms of server
time at the median; the reconnect wave over in 30 s with p99 under 500 ms;
no stream dropped at 1 000 concurrent.

## 8. Rollout

### 8.1 Order

1. **Contracts** (half a day, first, alone): `cacheStamp.ts`, `stamp` on
   `dayStatSchema`, `stamps` on the five day-sliced responses, the `days`
   and `resync` events, `hello.versions`. Additive: the running web app
   strips unknown keys (zod objects do) and ignores unknown events
   (`parseServerEvent` returns null).
2. **Server and web in parallel** (two development containers, the limit):
   the server task against the merged contracts; the web task against the
   same, with `mockApi` answering stamps and `304`s until the server lands.
   Both deploy independently: a server without the web change answers
   `304`s nobody asks for; a web app without the server change finds no
   stamps or ETags and treats every entry as `validate: "none"` with
   `fresh` 0 — stale-while-revalidate without the savings, still correct.
3. **End to end, load, docs** after both merged: the e2e suite of §7.3, the
   load script, the architecture's sections, `docs/api.md` ("Conditional
   requests" and the stamps for API users), the README's features, and this
   document removed.

### 8.2 Tasks and acceptance

**Task 0 — contracts** (`packages/contracts`): the schemas above with
`.meta`, unit tests in `packages/contracts/tests`; the OpenAPI snapshot is
left to task A. Done when the web and API typecheck against it unchanged.

**Task A — server** (`apps/api`):
- `cache/dayStamps.ts`, `cache/weakEtag.ts`, `cache/answerConditionally.ts`;
  stamps and ETags on the routes of §4.2 in the order of §4.1;
  `defineRoute`'s `304`; `recordDashboardAccess` and `recordAccess` with the
  status.
- `events/eventRing.ts`, ids, `after` and `Last-Event-ID`, `resync`,
  `days` from `DailyStatsScheduler`, `hello.versions`, `activeSessions` per
  tick, jittered `retry`, the global cap.
- Tests of §7.1 and §7.2; the OpenAPI snapshot; `docs/api.md`.
- Acceptance: every §4.2 route answers `304` to its own ETag and `200` to
  another account's; stamps equal the digest's for the same instant; the
  order invariant's test passes; a thousand fake streams cost one session
  query per tick; the integration suite stays under its time; no new
  environment variable (the cap is a constant).

**Task B — web** (`apps/web`):
- `src/cache/*` of §3.2, `pointCodec`, the policy table, the persister in
  `createQueryClient`, `cachedFetch`, `restoreWarmSet` in `main.tsx`, the
  purge paths, the toggle and About's counters, `FreshnessIndicator` and
  the live window rule, the offline read-only states, the `after`/`resync`
  stream, `days` and `segments` handling, the service worker in
  `scripts/build.mjs` and its registration.
- Tests of §7.1; `mockApi` gains `etag`/`304` and stamps.
- Acceptance: a warm render in the page tests shows the store's data before
  any request resolves; every purge path empties the store in a test; no
  resource outside the policy is written; the bundle's `query` chunk grows
  by the persister only; `npm run check` green; Chrome offers to install
  the app and opens its shell with the network off, in DevTools' Application
  panel the worker's precache lists the shell and nothing under `/api`.

**Task C — e2e, load, docs**: `cache.spec.ts` and the extensions of §7.3,
`scripts/load/dashboardOpens.mjs` with its targets met on the node, the
documentation moves, the manual iPhone checklist walked and ticked in the
pull request. Done when the whole suite passes under the lock in the
development container (`E2E_WORKERS=4 lockf -t 5400 /tmp/trail-e2e.lock
scripts/devc.sh npm run test:e2e`) and the release notes say what opens
faster.

### 8.3 Measuring, on the device only

`cacheStats.ts` counts, per page load: entries restored, bytes, hydration
time of the warm set, hits (painted from the store), misses, revalidations,
`304`s, invalid entries dropped, sweeps and what they removed, writes
refused. Settings › About › **On this device** shows them with the store's
size and the browser's estimate. Nothing is sent anywhere; a line of
telemetry to the server is an open question (§9).

## 9. Risks and open questions

- **`experimental_createQueryPersister` is experimental.** Its surface is
  small and the storage is ours; if a minor release changes it, the fallback
  is a hand-written `persisterFn` (~150 lines) behind the same
  `AsyncStorage`. Recommendation: take it, pin a caret, let the unit tests
  of §7.1 catch a change.
- **Other people's data on disk, later?** A second toggle, off by default,
  with the server's session probe carrying a tag over the viewer's shares so
  a changed or ended share drops everything of theirs before any paint, and
  entries that expire with the share's window. Worth it only if the people
  answer turns out to be the slow one on a loaded server; measure first with
  the load script. Recommendation: not this round.
- **A positive stamp that lies.** `raw` is count, first, last, visits,
  trips: adding and deleting the same number of points inside the same
  bounds in one day would leave it unchanged. Astronomically rare, and the
  consequence is a stale day until its next change. Recommendation: accept;
  if it ever matters, `daily_stats` can gain a `received_until` column (a
  migration and a backfill) and join the stamp.
- **A day with points and no segments** is never settled (null processed
  stamp): a refetch each time, a few hundred bytes. Accept.
- **The restart `resync`.** With an in-memory ring every restart is a
  `resync` for everyone, spread over 20 s and mostly `304`s. If the node
  shows it in `docker stats`, the ring can move to a small table (a day of
  events per user) or Postgres `LISTEN/NOTIFY`; not before it shows.
- **Encryption at rest**: declined (§5.1); revisit only if a threat appears
  that disk encryption does not answer.
- **Default of the toggle.** On, with the purges; a shared-computer
  default of off would cost every phone its warm open. Jens decides; the
  switch is one line.
- **Telemetry.** The counters stay on the device. A single opt-in line per
  day (hit ratio, bytes, hydration p50) to the server would tell whether the
  budgets fit a thousand people's phones; Jens decides whether it exists at
  all.
- **Safari's seven days.** A Safari tab that was not opened for seven days
  of use loses the store; a home-screen install does not. Nothing to do but
  say so in About.
- **`If-None-Match` and proxies.** Launchway's edge passes `304`s and
  `ETag`s through (Cloudflare too, when it ever sits in front); the e2e
  suite against a deployment (`E2E_BASE_URL`) proves it per environment.
- **What stays polled.** `activity` every 5 min (hour buckets roll over),
  the public link page every 15 s (no session, no stream): both as today.
