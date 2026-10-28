# Design: processing as a service

Status: proposed (28 October 2026). Main at `73f5833` (0.5.0 in production);
the hotfix `fix/window-growth` (0.5.1) is the starting point of this design.
Sections of [architecture.md](../architecture.md) referenced as §n.

Related streams, referenced as interfaces and not designed here: the
self-hosted OpenStreetMap extract (a local `WaySource`; Overpass becomes
optional), browser caching of tracks, and the load test that enforces the
targets of §6.5.

## 0. The decisions in short

1. The worker runs as a container of its own, from the same image, started
   with `trail worker`. The API keeps ingest, HTTP and SSE and does no
   processing; `PROCESSING_ROLE` (`api`, `worker`, `all`) selects the role,
   and `all` (the default) keeps a single container working as today.
2. Postgres stays the only coordination: a job table that both processes
   read and write, the per-device advisory locks that already exist, a
   heartbeat row per worker, and `NOTIFY` from the worker to the API for the
   `segments` events. No message broker, no leader.
3. An upload stores its points, its rejects, the device cache, the heat
   cells and the ingest log in one transaction, and queues its own work in
   that same transaction. Everything else — processing, daily statistics,
   alerts, retention, the heat fill — runs in the worker.
4. Every pass is bounded: at most `PROCESSING_PASS_MAX_POINTS` (60 000)
   raw points and 36 hours. A bigger job is split before it runs; growth to
   whole segments stays within the budget. The incident's 575 000-point
   window becomes ten passes of a few seconds each.
5. A move whose map tiles are missing waits as a `remap` job for those moves
   only; the window itself is finished at once. A local way source fetches
   missing tiles inside the pass, so nothing waits.
6. Three priorities — live, repair, backfill — scheduled by a credit rule:
   the backfill gets a fixed share of the worker's time whenever live work
   exists, all of it when none does, and never a turn while a live job is
   older than 60 seconds.
7. The backfill is a managed run with progress, an ETA, pause, resume and
   cancel, visible in Settings (administrators) and on the CLI.
8. Metrics on the worker's own port, a queue summary in the log every
   minute, and a processing summary in `/api/health`.
9. One worker is enough for 1 000 devices (§6); a second one is a Compose
   replica, nothing else changes. The disk, not the CPU, is the first wall.

## 1. Why the shape changes

After the 0.5.0 deploy one window of one device — 16 to 28 October,
575 000 points — was queued for every upload of that phone. Each pass read
and wrote all of it (10 to 20 minutes), left it waiting for 55 map tiles,
and the next upload took it along again, its start creeping earlier every
pass. The API process sat at 140–270 % CPU, Caddy answered 502 for
`/api/health`, and the 29-day backfill never got a turn.

Four causes, each with its fix in this design:

| Cause | Where | Fix |
|---|---|---|
| A waiting window stored the bounds the pass had grown it to, and every upload took it along | `processWindow`, `takeNextWindow` | 0.5.1 (`fix/window-growth`): queued bounds are kept; waiting rows are not taken along |
| No cap on a pass: a 12-day span of 575 000 points ran as one transaction | `extendWindow`, `processWindow` | Bounded passes and job splitting (§4.3) |
| Missing tiles made the whole window wait and run again | `awaitTiles` | `remap` jobs for the waiting moves only (§4.4) |
| The worker shared the API's event loop, heap and CPU | `main.ts`, `deploy/compose.yaml` | A worker container of its own (§2) |

The brief behind it: new data is saved first and acknowledged; every
calculation is done later, by a process that cannot take the API down;
as little as possible depends on other services; one node carries about
1 000 phones sending points through the day.

## 2. Process topology

### 2.1 Two roles of one image

The image stays one (`Dockerfile` unchanged but for one entry point). The
role comes from `PROCESSING_ROLE`:

| Role | Entry | Runs |
|---|---|---|
| `api` | `apps/api/dist/main.mjs` (the image's `CMD`) | HTTP, ingest, SSE, the data access log's writer, the sharing cache |
| `worker` | `trail worker` → `apps/api/dist/cli.mjs worker` → `startWorker()` (`apps/api/src/worker/startWorker.ts`); in development `tsx watch src/worker.ts` | Everything of §2.2 "moves" |
| `all` (default) | `main.mjs` | Both, in one process, as today: a single container, `compose.dev.yaml`, the end-to-end suite's server, anyone's install that never set the variable |

`deploy/compose.yaml` sets `app` to `api` and the new `worker` service to
`worker`. The default stays `all` so that nothing changes for a deployment
that does not know the new service; the worker's modules are loaded in
every role, the role only decides what starts.

Both entries wait for the database and run the migrations under the same
advisory lock (`runMigrations`): whichever starts first migrates, the other
waits and finds nothing to do. Neither depends on the other being up.

### 2.2 What stays in the API, what moves

| Stays in the API | Moves to the worker |
|---|---|
| Ingest (§6): the upload's transaction, now with its job row (§3) | Processing passes (`processWindow` and the pipeline) |
| SSE streams and the in-process bus (§9); the `ingest`, `device`, `person`, `share` events | Map tile fetching (`TileFetcher`) and the daily download budget |
| `segments` events for what the API itself does: a deletion (`POST /api/locations/delete`), a corrected mode (§17.5) | The backfill (`enqueueBackfill`) and `trail reprocess`'s work |
| The data access log's recorder and writer (in memory, §8.8) | Daily statistics (`DailyStatsScheduler` goes; §3.2) |
| The sharing cache (`SharingState`) | The silent-device and recovered-device alerts (ntfy) |
| Health (`/api/health`, `/api/health/live`) | The hourly retention (`pruneExpiredData`) |
| The CLI's short commands (`users`, `invite`, `passkey-link`, `prune`, `recompute`) | The start-up heat fill (`fillHeatLevels`) |
| | Creating the next month's partitions, once tables are partitioned (§6.4) |

After the move the API makes no outbound request at all (ntfy was its only
one besides Overpass). The `app` service can then leave the `default`
network and sit on `backend` alone; that is a later hardening step (§8),
not part of the rollout.

### 2.3 Coordination through Postgres

- **The queue is a table** (`processing_jobs`, §4.1), as §2 of the
  architecture requires of anything that must survive a restart. The worker
  polls it: every 2 s while idle (one indexed `min(next_at)`), at once after
  a pass that left work ready, every 60 s for retries and expired leases,
  every 15 min for the rearm and catch-up pass. A wake-up channel from the
  API would save at most two seconds; the poll costs nothing.
- **Per-device locks** stay `pg_advisory_xact_lock(hashtextextended(
  'trail.processing:<id>', 0))` (`deviceLock.ts`): advisory locks are
  cluster-wide, so a pass in the worker and a deletion or a corrected mode
  in the API already exclude each other across processes.
- **`segments` events** cross the process boundary with `NOTIFY`. The pass
  ends with `SELECT pg_notify('trail_processing', $1)` inside its
  transaction, so the message leaves with the commit; the payload is
  `{"t":"segments","u":"<user>","d":"<device>","from":…,"to":…}` (about
  160 bytes, far under the 8 000-byte limit). The API holds one dedicated
  `pg.Client` outside the pool that `LISTEN`s (`events/processingListener.ts`)
  and republishes on the `EventBus`; it reconnects with backoff (1 s,
  doubling to 30 s) and, on every reconnect, publishes a `segments` event
  for each (user, device) with `segments.computed_at` later than the moment
  the connection broke — so a notification lost while the listener was down
  still reaches an open dashboard. The worker side is
  `events/processingNotify.ts`. In role `all` both ends live in one process
  and the path is the same; tests run it against the real database.
- **Heartbeats**: `processing_workers` (`id` = hostname, pid and start
  time; `started_at`, `last_seen_at`, `version`, `job_id`, `passes`,
  `points`), updated every 15 s by each worker and read by `/api/health`
  (§4.7). Rows unseen for an hour go with the hourly prune.
- **Periodic jobs** (prune, alerts, heat fill, the backfill at start,
  partitions) take `pg_try_advisory_lock(hashtextextended('trail.job:<name>',
  0))` on the worker's own connection for the run; with several workers
  exactly one runs each. No leader election.

### 2.4 One worker or several

One worker is the default and carries the load of §6. Several are Compose
replicas of the same service (`deploy: replicas: ${TRAIL_WORKERS:-1}`,
honoured by Compose v2 and so by Launchway); nothing else changes:

- the claim (§4.5) is `FOR UPDATE SKIP LOCKED` and takes no job of a device
  that another worker is running (a partial unique index on `(device_id)
  WHERE state = 'running'` makes a race fail instead of overlap);
- a crashed worker's jobs come back through their lease (§4.5);
- the periodic jobs go to whoever holds the try-lock.

The pass transaction remains the unit of exclusion, so a worker added or
removed at any moment is safe.

### 2.5 Compose and Launchway

`deploy/compose.yaml` gains the service; `app` loses nothing but its
processing:

```yaml
  worker:
    image: ${TRAIL_IMAGE:-ghcr.io/jenspenneman/trail:sha-${LAUNCHWAY_COMMIT_SHA_SHORT:?set by Launchway}}   # as app
    pull_policy: always
    restart: unless-stopped
    init: true
    # a pass finishes its transaction (at most about a minute under the pass budget)
    stop_grace_period: 90s
    command: ["trail", "worker"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      # the app's list (architecture §4), plus:
      PROCESSING_ROLE: worker
      PROCESSING_METRICS_PORT: "8081"
      NODE_OPTIONS: --max-old-space-size=768
    networks: [default, backend]      # default: Overpass and ntfy
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    cpus: 2
    mem_limit: 1g
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:8081/health/live || exit 1"]
      interval: 30s
      timeout: 5s
      start_period: 60s
      retries: 3
    logging: *logging
```

`app` gets `PROCESSING_ROLE: api`, `cpus: 2` and keeps `mem_limit: 1g` with
`--max-old-space-size=512` (the backfill no longer needs its heap; shrink
further once measured). `db` gets `cpus: 4` and the settings of §6.4. The
brief calls the app container "1 CPU"; `deploy/compose.yaml` sets no `cpus`
at all today, which is how one process reached 270 %. Caps are explicit from
now on: app 2, worker 2, db 4 of the VM's 12, the rest for Launchway, its
edge and a check (6 CPUs, 3 GiB).

Consequences, in the manner of Launchway's ADR 0020:

- Launchway deploys the service with the next release; nothing is configured
  on its side. Previews get a worker container too (an empty database, so it
  idles). The edge routes `app` only; the worker publishes no port and joins
  no proxy network.
- Launchway's Compose policy keeps `mem_limit` for deployments today; it
  must keep `cpus` and `deploy.replicas` too. Verify on the first preview
  (§7); if the policy strips them, the pass budget still bounds the worker,
  and the caps go into Launchway's policy as a follow-up there.
- Memory on the 8.25 GB VM: db 2 GiB, app 1 GiB, worker 1 GiB, backup
  512 MiB, Launchway's own stack about 1 GiB, a check up to 3 GiB — 8.5 GiB
  of caps, which is more than the VM only when a check runs at its cap next
  to everything else at its cap. The OOM killer takes checks first
  (`oom_score_adj` 1000, ADR 0020). A second worker needs the VM raised.
- A deploy recreates both containers. The old worker stops inside 90 s with
  its pass rolled back or committed; the new one reclaims the lease at once
  (§4.5). For a few seconds an old API and a new worker, or the reverse, run
  against the same schema: migrations only add, the queue rows carry no
  version-specific meaning, and a window written by the old inference is
  replaced by the backfill the new version queues.
- `docker compose exec app trail reprocess` no longer processes in the app
  container; it queues a run (§4.6). The runbook's note about a second Node
  process under the app's 1 GB goes away.
- The backup dumps the queue tables with everything else. A restore brings
  back jobs as they were: harmless, every pass is idempotent (§4.5).
- Rollback to a release without the service leaves a `worker` container of
  the old image running `trail worker`, which that image does not know: the
  CLI exits 2 and the container restarts in a loop until the project is
  redeployed. Harmless (the old `app` processes in-process), and visible in
  Launchway. The runbook names it.

### 2.6 Local development, tests, CLI

- `npm run dev` (`scripts/dev.mjs`) spawns three services: `api`, `worker`
  (`tsx watch src/worker.ts` with `PROCESSING_ROLE=worker`) and `web`, with
  the same prefixes and the same `.env`. `api` runs with `PROCESSING_ROLE=api`,
  so development matches production. The development container
  (`scripts/devc.sh`) needs no change: `npm run dev` runs inside it.
- Integration tests keep `createTestContext()` with the worker in-process
  (`flush()` runs every ready job and fetches tiles, as today) and the
  `FixtureWaySource`; the `segments` event travels through `NOTIFY` there
  too, which `SseClient` already waits for. A new `createWorkerContext()`
  starts a worker without the HTTP app, so one test can hold an API context
  and a worker context on the same database (`processingTopology.test.ts`,
  §9).
- The end-to-end suite's server (`scripts/e2e-server.mjs`) keeps role
  `all`; the two-process path is covered by the integration test above and
  by the preview deployment.
- CLI (§11 of the architecture):
  - `trail worker` — the worker loop in the foreground (the service's
    command; exit 1 on an invalid configuration, 0 on SIGTERM).
  - `trail reprocess [--device] [--from --to] [--from-level] [--wait]` —
    creates a run (§4.6) and prints its id; `--wait` prints progress every
    10 s until it finishes. It no longer processes anything itself: the
    worker does, with the same budgets as everything else, and the command
    returns in a second.
  - `trail processing status` — workers, queue counts and ages, open runs
    with progress and ETA; `trail processing pause|resume|cancel <run>`;
    `trail processing retry <job>` for a poisoned job (§4.5).
  - `trail recompute` stays as it is (heat cells and daily statistics, in
    the command's own process under the device lock).

## 3. Ingest as the hot path

### 3.1 What an upload does, synchronously

One transaction (`ingestUpload`), as §6.2 of the architecture, with one
statement added at step 3:

| Step | Statement | Cost (node, estimate) |
|---|---|---|
| 0 | token lookup by hash, `SELECT … FOR UPDATE` of the device row | 0.5 ms |
| 1 | `INSERT INTO locations … ON CONFLICT DO NOTHING RETURNING` with the heat-cells CTE (six levels) — one statement, `insertLocations` | 3 ms + 0.05 ms per point + the cell upserts (at most six per distinct cell) |
| 1 | visits, trips, events, rejects (`ON CONFLICT DO NOTHING`) | 1 ms each when present |
| 2 | the device cache (`updateDeviceAfterIngest`) | 0.5 ms |
| 3 | `ingest_log` row; **new**: the device's live job upsert (§4.2), and `recovery_alert_due_at = now()` on the device when `stale_alerted_at` was set | 0.5 ms each |
| 4 | commit, answer | 1 ms |

Target budgets at p95 on the node, with the worker busy: a one-point request
(OwnTracks, the OsmAnd format) 30 ms; an Overland batch of 200 points
120 ms; of 1 000 points 500 ms; the largest batch the route accepts (5 000
records, 5 MB) 2 s. These are database-bound numbers; the load-test stream
measures them (§6.5). A phone waits about a minute for an answer (iOS's
default request timeout) before it gives up and retries later.

After the response (`afterIngest`, step 5): the `ingest` and `device`
events, the `person` events to the people the device is shared with — all
in-memory fan-out, no database work beyond the device summary read that
`publishDeviceLater` already skips when nobody is listening.

The job row moves into the transaction on purpose. Today the queueing runs
after the response (`ctx.background.run`), which is why a process stopped in
between loses the window and the 15-minute catch-up pass exists. With the
upsert in the transaction, what an upload did and the fact that it needs
processing are one atomic fact; the catch-up pass stays as a safety net
that should never fire. The alternative — a separate "dirty devices" table
written after the response — is the same write with a window to lose it.

### 3.2 What is deferred, and to where

- **Processing**: the live job (§4.2). The pass runs 5 s after the first
  upload of a burst and at most every 30 s per device.
- **Daily statistics**: no scheduler in the API any more. The live pass
  knows its window and ends by recomputing `daily_stats` for the local days
  it touched (`recomputeDailyStats`, as now: one read of the day's points
  and one upsert per day). A time-zone change (`PATCH /api/me`) queues a
  `stats` job per device instead of rebuilding in the request's process.
  Freshness on the Devices page goes from about 10 s to about 30 s.
- **Alerts**: the worker's alert job runs every 60 s: silent devices as
  today (§10 of the architecture) and recovered devices, whose
  `recovery_alert_due_at` the ingest set; the stamp is cleared after
  delivery, so an unreachable ntfy is retried next minute. The "sending
  data again" alert arrives within a minute instead of at once.
- **Heat cells stay inline.** They could move to the live pass, but their
  upsert is `count = count + excluded.count`: not idempotent, while every
  pass must be repeatable (§4.5). Inline, the CTE counts exactly the rows
  `RETURNING` gave, once, in the same transaction; the cost is a few
  milliseconds per batch. `fillHeatLevels` at start stays the consistency
  check it is, in the worker.

### 3.3 Back-pressure

Accept first. The queue never refuses an upload: a device has at most one
open live job, which coalesces every upload until a pass takes it, so the
table's size is bounded by the number of devices plus the backfill's jobs.
The ingest answers `503` (`{"error":"Server temporarily unavailable"}`,
`Retry-After: 30`) only when the database is down or no pool connection is
obtained within 5 s (`connectionTimeoutMillis`): the phones keep their data
(OwnTracks for iOS keeps a message it gets a 5xx for, §6). Rate limits per
token stay as they are.

An overload guard is kept in reserve: when the API's event-loop lag
(`perf_hooks.monitorEventLoopDelay`) exceeds 2 s at p99 for ten seconds, the
ingest endpoints answer `503` with `Retry-After: 15` until it recovers,
instead of queueing requests into their timeouts. The load test decides
whether it is needed at the targets of §6.5; it ships off by default
(`INGEST_OVERLOAD_LAG_MS=0`).

### 3.4 The worker is down for hours

Uploads keep coalescing into each device's live job; nothing else grows.
When the worker returns, every device has one job spanning the outage,
oldest first; a job over the budget is split (§4.3). For 1 000 devices after
an eight-hour outage that is about 1 000 passes of a few thousand points
each — 20 to 40 minutes of catching up on one worker, during which the live
age metric (§4.7) says so and `/api/health` reports the worker up again.

## 4. Job model

### 4.1 The tables

`processing_jobs` replaces `processing_queue` (migration `0010_processing_jobs`
moves the rows: live and repair rows one to one, backfill rows into one
run; `processing_queue` is dropped by the following release).

| Column | Type | Meaning |
|---|---|---|
| `id` | bigint identity PK | |
| `device_id` | uuid → devices (cascade) | |
| `kind` | text | `live` (new points), `repair` (a deletion, a corrected mode, a split's older parts, catch-up), `remap` (moves waiting for map tiles), `backfill` (a version bump), `reprocess` (`trail reprocess`), `stats` (daily statistics only) |
| `priority` | smallint | 0 live; 1 repair, remap and stats; 2 backfill and reprocess. Set from `kind` on insert, kept for the index |
| `from_at`, `to_at` | timestamptz | the queued bounds — never the bounds a pass grew them to (0.5.1) |
| `from_level` | text | `averaged`, `mapped`, `inferred` (as today) |
| `state` | text | `ready`, `waiting` (remap: tiles not there), `running`, `paused` (its run is paused), `failed` (poisoned, §4.5) |
| `next_at` | timestamptz | ready time, to the millisecond (`readyNow`) |
| `attempts`, `last_error` | int, text | |
| `missing_tiles` | jsonb | the tiles a `remap` job waits for |
| `moves` | jsonb | a `remap` job's spans: `[[from, to], …]`, epoch seconds |
| `run_id` | bigint → processing_runs (set null) | membership of a managed run |
| `claimed_by`, `claimed_at` | text, timestamptz | the worker holding it |
| `reason` | text | for the log: `ingest`, `delete`, `override`, `catch-up`, `split`, `remap`, `backfill`, `reprocess`, `timezone` |
| `enqueued_at` | timestamptz | |

Indexes: `(state, priority, next_at)` for the claim; partial unique
`(device_id) WHERE kind = 'live' AND state = 'ready'` — the ingest's
coalescing target; partial unique `(device_id) WHERE state = 'running'`;
`(device_id, from_at)`; `(run_id) WHERE run_id IS NOT NULL`.

`processing_runs` — one row per managed backfill or reprocess (§4.6):
`id`, `kind` (`backfill` | `reprocess`), `reason` (text, e.g. `inferred 3
→ 4`), `from_level`, `scope` (jsonb: device ids, range), `versions` (jsonb:
the target versions), `total_jobs`, `done_jobs`, `failed_jobs`,
`total_points` (from `daily_stats`), `done_points`, `created_by` (`server`,
`cli`, or a user id), `started_at`, `finished_at`, `paused_at`,
`cancelled_at`, `superseded_by` → processing_runs.

`processing_workers` — the heartbeats of §2.3. `processing_state` stays for
the recorded versions.

### 4.2 Kinds, priorities and fairness

The live job of a device is one row: the ingest upserts
`INSERT … ON CONFLICT (device_id) WHERE kind = 'live' AND state = 'ready'
DO UPDATE SET from_at = least(…), to_at = greatest(…), next_at = least(…)`
with bounds first new point − 30 min to last new point + 30 min and
`next_at = now() + 5 s`. A row a pass has claimed is `running`, so an upload
during the pass starts a fresh `ready` row instead of widening the one being
processed (what `enqueued_at` guarded before). When a pass ends and a new
ready live row of the device already exists, the pass sets its `next_at` to
at least 30 s after its own end: a phone uploading every few seconds costs
one pass every 30 s, not one per upload.

The scheduler (`worker/chooseNext.ts`, a pure function over the queue
heads and the last five minutes of pass times) decides which priority the
claim may take:

1. If the oldest ready live job is older than `PROCESSING_LIVE_AGE_TARGET_S`
   (60 s), take live (priority 0) only.
2. Otherwise, if backfill time in the last five minutes is below
   `PROCESSING_BACKFILL_SHARE` (0.5) of all pass time and a backfill job is
   ready, take the backfill (priority 2) — even while live and repair jobs
   are ready; they wait one bounded pass. The rule is evaluated after every
   pass, so a long live burst is followed by backfill passes until the share
   holds again.
3. Otherwise take priority ≤ 1 (live, then repair), and backfill only when
   nothing else is ready.

With no live work the backfill runs at full speed; with continuous live
work it keeps its share; a phone uploading every minute can never starve it
(the incident), and a backfill can never push live latency past the target
for more than one pass. Passes are bounded (§4.3), so no pre-emption is
needed: the longest a live job waits behind a running backfill pass is one
pass, about ten seconds at the budget.

Within a priority the order is `next_at`, then `id`: live and repair oldest
first; backfill jobs are inserted with `next_at` descending by day, so the
newest days come first as today.

### 4.3 Bounded passes

Two caps, both configuration (§4.8): `PROCESSING_PASS_MAX_POINTS` (60 000
raw points, about 17 hours of a phone at one point per second, weeks of a
balanced one) and `PROCESSING_PASS_MAX_SPAN_HOURS` (36). A pass that would
exceed either does not run; the job is split first (`processing/splitJob.ts`,
in the claim's transaction):

1. Count the points of the queued bounds (one index range on the primary
   key; about 20 ms for 100 000 rows).
2. Over the budget: find the largest recording gap in the span (`lag()` over
   the same range, a scan of the span's rows) and split there when it is
   longer than 30 min (the night the phone slept through, `gapSplitS`);
   otherwise at the 60 000th point, at an exact point boundary.
3. The two halves are jobs of the same run and level. A split live job
   keeps its newest half live; the older half becomes `repair` (priority 1),
   so a backlog of history never blocks the fresh points of other devices.
4. A half still over the budget splits again when it is taken.

Growth to whole segments (`extendWindow`) keeps its rules — the stop or move
under each edge, two days at most, a reach back over a real gap only — and
gains the budget: when the grown window would exceed the points cap, the
forward growth (the open segment the new points extend) is kept and the
backward growth is cut at the budget, at a point; `persistWindow` already
cuts the segment under the edge into a part that counts its own and keeps
its mode (§17.4). A stale multi-day stop at the edge thus costs a live pass
at most the budget, never two days of it.

The incident, replayed under these rules: the 575 000-point job is taken,
counted, split at its largest gaps into about ten jobs of ≤ 60 000 points;
the newest stays live, the rest are repair; each runs in a few seconds
(reading 60 000 rows in three pages, averaging and stops in well under a
second, writing 12 chunks of 5 000 processed points); live jobs of other
devices interleave; the backfill keeps its share throughout.

### 4.4 Map data: inline for a local source, remap jobs for a remote one

`WaySource` gains `readonly latency: "local" | "remote"`. The Overpass
source is remote (one request every 2 s, 40 s answers from the node); the
extract of the OSM stream is local (milliseconds, `bytes: 0`). The pass
behaves accordingly:

- **Local**: tiles the window needs and the cache lacks are fetched inside
  the pass, at most `PROCESSING_TILES_INLINE_MAX` (64) of them; beyond that,
  or on a failure, the moves concerned go the remote way below. With a
  local source nothing waits in practice, and the tile cache in Postgres
  stays what it is: the pass reads tiles from the cache, never from the
  source directly.
- **Remote**: the pass finishes the window at once — stops and moves from
  the averaged level, the moves whose tiles are there mapped, the others
  stored unmapped — and writes one `remap` job (state `waiting`) listing
  exactly those moves' spans and their `missing_tiles`. The `TileFetcher`
  (in the worker, alongside the passes, within the daily budget) fetches
  the tiles waiting jobs list, oldest job first, and sets a job `ready` when
  all of its tiles are cached (`rearmWindows`, as now; after a day
  regardless). A remap pass takes the union of its moves' spans as the
  window, grows it to whole segments as any pass, runs from the mapped level
  and reuses the stored mapping of every other move (§5.3), so it matches
  the waiting moves and re-runs the inference over the window — a few
  hundred points, not a day. Tiles due for a refresh (`PROCESSING_OSM_TTL_DAYS`)
  serve the pass and queue a remap the same way.

Nothing is "waiting for tiles" at the window level any more; the window's
timeline is complete after its first pass, with moves to be mapped later
served averaged (`availableLevel`, §17.1), and `pending` (the timeline's and
Insights' flag) counts ready and running jobs only, as before.

### 4.5 Claims, leases, idempotence, retries

The claim is one statement (`processingJobs.ts`):

```sql
WITH next AS (
  SELECT j.id FROM processing_jobs j
  WHERE j.state = 'ready' AND j.next_at <= now() AND j.priority <= $1
    AND NOT EXISTS (SELECT 1 FROM processing_jobs r
                    WHERE r.device_id = j.device_id AND r.state = 'running')
  ORDER BY j.priority, j.next_at, j.id
  LIMIT 1 FOR UPDATE SKIP LOCKED
)
UPDATE processing_jobs SET state = 'running', claimed_by = $2, claimed_at = now()
WHERE id = (SELECT id FROM next) RETURNING *;
```

Then the pass, in one transaction as today: the device's advisory lock; the
other ready jobs of the device that overlap the claimed one are marked
running and taken along (never a waiting one, never one of another run);
split if over budget (§4.3); the window; the pipeline; `persistWindow`; the
jobs deleted; follow-ups inserted (a remap job, the cut parts of a stale
segment as backfill jobs of the open run, the daily statistics); the run's
progress counters; `pg_notify`. A failure rolls everything back and sets
the job `ready` with `attempts + 1`, `next_at = now() + 30 s × 4^attempts`
(at most 6 h), and `last_error` (500 characters, no coordinates). After ten
attempts the job is `failed` — poisoned — and stays visible in the status
(§4.6) until `trail processing retry <id>` or a new job over the same range
replaces it; other jobs of the device run on. A poison job is logged once
with `processing job poisoned`.

A lease guards against a worker that died mid-pass: every 60 s the worker
sets `ready` again every `running` job whose `claimed_at` is older than
10 min or whose `claimed_by` has no heartbeat of the last 90 s; a worker at
start does the same for its own previous incarnation at once. Because the
pass is one transaction, a killed pass left nothing behind, and a repeated
pass writes the same rows: derived tables are replaced per window, segment
ids are kept while their start stays, heat cells are not touched by passes.
That idempotence is the invariant I6 of §5.4, tested.

### 4.6 The managed backfill

A version change (`processingVersions` ≠ `processing_state.backfill`) at the
worker's start creates a `processing_runs` row (`kind: backfill`, `reason`
naming the levels, `from_level` the lowest that changed) and queues one
job per (device, local day with points) under it — as `enqueueBackfill`
does today — with `total_jobs` and `total_points` from `daily_stats`. An
open run of the same kind is superseded: its jobs are re-queued under the
new run with the more thorough level, it gets `cancelled_at` and
`superseded_by`. `trail reprocess` creates a `reprocess` run the same way
for its scope. The versions are recorded in the same transaction, so a run
is created once per change and resumes after a restart.

Progress: each pass of a run's job adds to `done_jobs` and `done_points`
(one row update); the ETA is `remaining_points ÷ (points done in the last
ten minutes ÷ 600 s)`, honest about the share it gets. `finished_at` is set
by the pass that completes the last job. A failed job counts in
`failed_jobs` and does not block `finished_at` once every other job is done.

Pause sets the run's `paused_at` and its ready jobs `paused`; resume sets
them `ready`; cancel deletes them and sets `cancelled_at`. The worker
never looks at `processing_runs` while claiming — only at job states.

Surfaces:

- `GET /api/admin/processing` (session, administrators; `adminRouter`):
  `{ workers: [{ id, version, lastSeenAt, jobId }], queue: { ready: { live,
  repair, backfill }, waiting, running, failed, oldestLiveAgeS }, runs:
  [{ id, kind, reason, fromLevel, totalJobs, doneJobs, failedJobs,
  totalPoints, donePoints, etaS, startedAt, finishedAt, pausedAt }] }`,
  and `POST /api/admin/processing/runs/{id}/pause|resume|cancel`. Counts
  and ages only: no device names or job bounds, which would tell an
  administrator when other people's phones were active. Contracts in
  `packages/contracts/processing.ts`; the threat model goes with the pull
  request.
- Settings › Administration › Processing (`apps/web/src/settings/
  ProcessingPage.tsx`): the workers, the queue, each run with a progress
  bar, its ETA and Pause/Resume/Cancel; the page polls every 10 s while
  open. Non-administrators keep what they have: the `pending` notice in the
  timeline and Insights.
- `trail processing status|pause|resume|cancel|retry` (§2.6).

### 4.7 Observability

- **Metrics** on the worker's `PROCESSING_METRICS_PORT` (8081; 0 switches
  the listener off), a plain `node:http` server, Prometheus text at
  `/metrics` and `/health/live` (200 while the loop's own heartbeat is under
  90 s old — a stuck loop fails the container's health check):
  `trail_processing_jobs{kind,state}`, `trail_processing_oldest_ready_age_seconds{priority}`,
  `trail_processing_pass_seconds` (histogram, buckets 0.1 … 60),
  `trail_processing_pass_points` (histogram), `trail_processing_points_total`,
  `trail_processing_pass_phase_seconds{phase=read|pipeline|write}`,
  `trail_processing_tile_wait_jobs`, `trail_processing_tiles_fetched_total{outcome}`,
  `trail_processing_tile_budget_bytes_today`, `trail_processing_run_points{run,state}`,
  `trail_processing_worker_up`, and Node's `process_*` (RSS, heap, event
  loop lag). The port is on the project's networks only — nothing routes
  it; a later scraper of Launchway's can read it there, and
  `docker exec launchway-trail-worker-1 wget -qO- http://127.0.0.1:8081/metrics`
  reads it by hand.
- **Log lines** (pino, no coordinates): `processing pass done` with
  `jobId`, `kind`, `deviceId`, `points`, `segments`, `ms`, `readMs`,
  `pipelineMs`, `writeMs`, `split`, `remapQueued`, `missingTiles`;
  `processing queue` once a minute with the queue counts, the oldest live
  age, passes and points per second of the minute, and the backfill share
  held; `processing run progress` every five minutes per open run;
  `processing job failed` / `processing job poisoned`; `map tile stored`
  and the budget warning as today.
- **`/api/health`** adds `processing: { worker: "up" | "down" | "none",
  lastSeenS, oldestLiveAgeS, ready, failed }` from `processing_workers` and
  two indexed reads, under the route's existing per-IP limiter. `none` is
  role `all` with processing disabled. The status stays 200 when the worker
  is down — the API is up — so Caddy and an uptime monitor see the API's
  truth; `/api/health/processing` answers 503 when no worker was seen for
  90 s or the oldest live job is older than 10 min, for a monitor that
  watches the worker. `/api/health/live` is unchanged.

### 4.8 Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PROCESSING_ROLE` | `all` | `api`, `worker` or `all` (§2.1) |
| `PROCESSING_PASS_MAX_POINTS` | `60000` | A pass reads at most this many raw points; a bigger job is split (§4.3) |
| `PROCESSING_PASS_MAX_SPAN_HOURS` | `36` | A pass spans at most this long |
| `PROCESSING_BACKFILL_SHARE` | `0.5` | The share of pass time the backfill gets while live work exists (0.1–0.9) |
| `PROCESSING_LIVE_AGE_TARGET_S` | `60` | Above this age of the oldest live job, live work only |
| `PROCESSING_TILES_INLINE_MAX` | `64` | Tiles a pass fetches itself from a local source |
| `PROCESSING_METRICS_PORT` | `8081` | The worker's metrics and liveness port; 0 = off |
| `INGEST_OVERLOAD_LAG_MS` | `0` (off) | The API's event-loop lag above which ingest answers 503 (§3.3) |
| `TRAIL_WORKERS` | `1` | Compose only: worker replicas |

Every one of them follows the house rule for a new variable (§2 of the
architecture). The existing `PROCESSING_*` keep their meaning;
`PROCESSING_ENABLED=false` now means the worker runs the statistics, alerts,
retention and heat fill but queues and runs no level jobs.

## 5. Incremental recompute

### 5.1 Which windows an upload touches

1. The live job's bounds are the new points' span ± 30 min, coalesced per
   device (§4.2). The margin covers the case where no segment meets the
   window yet; it is the budget's smallest unit, not its size.
2. The pass grows the window to the stop or move under each edge, two days
   at most, within the points budget — forward growth first (§4.3) — and
   reaches back over a recording gap longer than 30 min only (`extendWindow`,
   §17.4). A shorter hole is no gap; the window starts where it did.
3. A device's consecutive live passes are at least 30 s apart, so a phone
   sending a point a second costs one pass per half minute; with uploads
   every five minutes each point is worked out about three times in all (its
   own pass, the next upload's growth over the open move, perhaps a remap),
   not once per later upload.
4. A deletion queues the range ± 30 min and the deleted segments' time as a
   `repair` job (as today, in its own transaction under the device lock); a
   corrected mode queues the move's span the same way.

### 5.2 Stale segments across versions

- A pass at the current version that cuts a segment of an older version at
  its edge queues the cut part as backfill jobs of the open run — day-sized,
  split by the budget, never one job over the whole part. A part left by the
  current version is never re-queued (no loop).
- Between a release and the end of its run, the invariant is: no segment of
  an older inferred version overlaps a window that a pass finished at the
  current version (I4, §5.4). The run's completion makes it: no segment of
  an older version at all.
- Processed points carry the mapped version, segments the inferred one, as
  today; a run after a change to the inference alone runs from the inferred
  level and keeps every stored mapping (§17.4).

### 5.3 Not matching twice

- In every pass, not only one from the inferred level, a move whose kept
  points all carry the current mapped version and a way kind keeps its
  stored mapping (`loadStoredMapping`, `storedMoveMapping`); a move with a
  point that was part of a stop before, or that is new, is matched.
- A move that grew — new points at its end — is matched from the last mapped
  point back by the seam margin (1.5 km, `cutMove`'s rule) to its new end,
  and the stretch's points before the seam keep their mapping. This reuses
  the stretch machinery of `mapPieces` and is gated by the benchmark: the
  dense day must match in the same time, and `wayKinds.test.ts` must give the
  same kinds whether a journey arrives in one upload or in ten.
- A `remap` job matches only the moves it lists (§4.4).

### 5.4 Invariants, and how tests hold them

Over any device and any range worked out at the current versions:

| | Invariant | SQL (per device) |
|---|---|---|
| I1 | No overlap: segments ordered by `started_at` have `ended_at ≤` the next `started_at` | a self-join on `a.started_at < b.ended_at AND b.started_at < a.ended_at` is empty |
| I2 | Ends meet: the next segment starts at `ended_at`, unless the earlier one is a stop that lasted beyond its last point (`features.lastPointT < ended_at`) or a travel gap lies between (> 30 min, ends > 300 m apart) | `lead()` over segments, joined to the points at the boundary |
| I3 | Coverage: every kept processed point of the range lies in exactly one segment, or in a travel gap | processed points not covered by any segment are at gaps with travel only |
| I4 | No stale tails: no segment of an older version overlaps a window finished at the current one; after a run, none at all | `segments.version < current` joined to finished jobs' ranges (kept for the test in a `processing_passes` log the test context records) |
| I5 | Queue sanity: no job spans more than the cap after a split, no two running jobs per device, every live job's bounds lie within what was queued | counts on `processing_jobs` |
| I6 | Idempotence: running a finished pass again changes nothing | fingerprint of `segments` (without `computed_at`) and `processed_points` (without `processed_at`) before and after |

`apps/api/tests/support/processingInvariants.ts` exports
`assertSegmentInvariants(db, deviceId, range)` (I1–I4) and
`assertQueueInvariants(db)` (I5), and the worker's test harness runs them
after every pass. The production-like scenario that bit 0.5.0 becomes
`apps/api/tests/integration/processingService.test.ts`:

1. A stay of three days at one point every four seconds (65 000 points,
   `stay()` of `syntheticWorld.ts`), stored as one segment of
   `inferred − 1` through `persistWindow` with the old versions; a commute
   journey before it; `PROCESSING_PASS_MAX_POINTS=20000` in the test's
   environment so the budget bites.
2. The `FixtureWaySource` refuses the tiles east of the stay (`failing`).
3. Twenty uploads three minutes apart of a ride east (the simulator's
   pattern), each followed by `flush()`; after each pass: the invariants,
   `points ≤ budget` from the pass log, the live job's bounds never earlier
   than queued, the backfill run's `done_jobs` strictly increasing across the
   twenty, and no segment of the old version overlapping a finished window.
4. The tiles are allowed again; the remap jobs become ready; the pass maps
   only the listed moves (every other processed point keeps its
   `processed_at`), and the invariants hold.
5. The same scenario with two worker contexts on one database
   (`processingTopology.test.ts`): never two running jobs of a device, the
   `segments` event arriving at the API context through `NOTIFY`, a worker
   stopped mid-pass leaving nothing and its lease taken by the other.

For the release rehearsal, not the suite: restore the production dump into
a local stack (`deploy/compose.dev.yaml`), run the live simulator
(`scripts/sim/live-uploads.mjs`, from the hotfix's `trailgrow-live.mts`)
against it for an hour, and read `trail processing status` and the
invariants through `trail processing check` (a CLI wrapper of the same SQL,
read-only).

## 6. Capacity arithmetic for 1 000 devices

### 6.1 Points and requests

Per device and day, from the presets (§6.3 of the architecture), the apps'
setup links and the one measured phone (Jens's, high-resolution: 1.23
million points in 27 days, 45 000 a day; 575 000 in the incident's 12
days). Assumed: 1.5 h of travel a day, 20 % of the devices moving at the
busiest hour.

| Device | Points/day | Requests/day |
|---|---|---|
| Overland balanced (5 s, 10 m, pauses when still) | 1 500 | 40 batches |
| Overland balanced-plus (1 s while moving, pauses) | 6 000 | 40 batches |
| Overland high-resolution (1 s, never pauses) | 45 000 | 1 440 batches (every minute) |
| OwnTracks move mode (30 m or 60 s) | 2 000 | 2 000 (one per point) |
| Traccar Client (10 s, 30 m — the brief's interval; the setup link says 30 s, which halves this) | 700 | 700 |

| Mix | Devices | Points/day | Average | Busy hour | Requests/day | Busy hour |
|---|---|---|---|---|---|---|
| A, lean: 550 balanced, 200 OwnTracks, 150 Traccar, 80 balanced-plus, 20 high-resolution | 1 000 | 2.7 M | 31/s | ≈ 125/s | 560 000 | ≈ 26/s |
| B, heavy: 450 / 200 / 100 / 150 / 100 | 1 000 | 6.5 M | 76/s | ≈ 300/s | 640 000 | ≈ 30/s |

Thirty requests a second of a few milliseconds each is a fraction of one
Node process; the ingest is bound by the database's write latency, not by
the API's CPU. The one-point apps dominate the request count, Overland's
high-resolution phones the point count: ten percent of the devices make
seventy percent of Mix B's points.

### 6.2 Database writes and growth

A `locations` row costs about 310 bytes with its primary key (Overland's
`extra` with tracking stats included), a `processed_points` row about 210
(`path_map` averaged over moves and stops), heat cells grow with places
visited, not with points.

| | Mix A | Mix B |
|---|---|---|
| `locations` | 0.84 GB/day, 25 GB/month | 2.0 GB/day, 61 GB/month |
| `processed_points` | 0.57 GB/day, 17 GB/month | 1.4 GB/day, 41 GB/month |
| Together | ≈ 42 GB/month, 0.5 TB/year | ≈ 100 GB/month, 1.2 TB/year |
| The node's 181 GB free | about four months | under two months |

The disk is the first wall, well before CPU. Recorded data is never pruned
(house rule), so the target needs a data disk sized for years and a backup
scheme that is not a daily full `pg_dump` into a synced folder (14 dailies of
500 GB cannot exist). Both belong to the capacity stream; this design makes
them visible and keeps the derived tables small enough to rebuild rather
than back up — a restore of `locations` plus a run rebuilds everything
else, which is why the run must be cheap (§6.3).

### 6.3 Worker time and memory

The pipeline costs 7 µs of CPU per point on an M2 Pro (150 ms for 21 000
points, `processingBenchmark.test.ts`); the node is taken as four times
slower, 28 µs. A point enters about three passes (§5.1). The database side
of a pass — three pages of 20 000 points read, processed points written in
chunks of 5 000, segments replaced, the day's statistics — is the real
cost: the design assumes 0.15 ms per point and pass on the node once passes
are bounded; the incident's pass ran at 1–2 ms per point with a 12-day
window, five pieces of 256 tiles and a heap at its limit, and
`pass_phase_seconds` (§4.7) is there to measure the difference.

| | Mix A | Mix B |
|---|---|---|
| Pipeline CPU per day | 2.7 M × 3 × 28 µs ≈ 4 min | ≈ 9 min |
| Database side per day at 0.15 ms | ≈ 20 min (1.4 % of one worker) | ≈ 50 min (3.5 %) |
| The same at the incident's 1 ms | ≈ 2.3 h (10 %) | ≈ 5.5 h (23 %) |
| A run over one year of history (1.0 G / 2.4 G points) at 0.18 ms, full speed | ≈ 50 h | ≈ 120 h |
| The same at the 50 % share | ≈ 4 days | ≈ 10 days |
| The current backfill (29 days of one phone, 1.3 M points) | ≈ 4 min | |

One worker carries either mix with room; a second one halves a run and is a
replica (§2.4). Memory per pass: 60 000 raw points with their averaged,
kept and mapped forms, about 400 bytes a point, 24 MB; a piece of map data
of 256 tiles up to about 250 MB in a city centre (the compose comment's
number); peak under 400 MB, the heap 768 MB, the container 1 GiB. A local
way source makes pieces cheap to load, so `pieceMaxTiles` can drop to 128
there and the peak with it.

### 6.4 Postgres

`db` runs with the image's defaults today (`shared_buffers` 128 MB,
`work_mem` 4 MB, autovacuum at 20 % of a table). For the 2 GiB container:

```
shared_buffers=512MB  effective_cache_size=1536MB  work_mem=16MB
maintenance_work_mem=256MB  max_wal_size=2GB  checkpoint_completion_target=0.9
wal_compression=lz4  random_page_cost=1.1  max_connections=60
autovacuum_vacuum_scale_factor=0.02  autovacuum_analyze_scale_factor=0.01
autovacuum_vacuum_cost_delay=2ms  log_min_duration_statement=2000
```

as `command:` arguments of the `db` service. `synchronous_commit` stays on:
an acknowledged upload is durable, which is the whole point of
acknowledging it. Connections: the API's pool of 10 plus the listener, 5
per worker, the backup, the CLI's 2 — far under 60. Partitioning
`locations` and `processed_points` by month (range on `recorded_at`, which
both primary keys contain; the cascade from a partitioned `locations` works
on Postgres 12 and later) keeps vacuum and index maintenance per month and
lets a month be dropped in one statement should retention of derived data
ever be wanted; the worker's hourly job creates partitions three months
ahead. drizzle-kit does not describe partitioned tables, so the migration is
written by hand and the schema files stay plain; that spike is the capacity
stream's, with a dump-restore rehearsal first.

### 6.5 Targets for the load-test stream

All measured on the node with the worker at the 50 % backfill share and a
run in progress, at Mix A's busy hour (125 points/s, 26 requests/s) for one
hour:

| Target | Value |
|---|---|
| Ingest p95 / p99 | one point 30 / 60 ms; 200-point batch 120 / 250 ms; 1 000-point batch 500 ms / 1 s |
| API reads p95 while the worker runs (a day's tracks, the timeline, People) | 400 ms |
| `/api/health` p99; 502s from the edge | 200 ms; none |
| Live queue age p95 / p99 (upload to the `segments` event) | 60 s / 5 min |
| Backfill throughput per worker at a 0 % / 50 % share | ≥ 1 500 / ≥ 700 points/s |
| Pass duration p99; points per pass | 60 s; never above the budget |
| Worker RSS; API RSS | ≤ 800 MB; ≤ 600 MB |
| Postgres CPU average / peak; pool wait p99 | ≤ 2 / 3 cores; 50 ms |
| Mix B, the same hour | the same budgets, documented where they do not hold |

## 7. Rollout

Each phase is one release, ships behind a flag or as a safe default, and
leaves production in a state the previous release can still run against
(migrations only add; `processing_queue` is dropped a release after it stops
being read).

| Phase | Release | Ships | Flag / default |
|---|---|---|---|
| 0 | 0.5.1 | `fix/window-growth`: queued bounds kept, waiting rows not taken along, alternating turns | — (bug fix) |
| 1 | 0.6 | The worker role and entry, the listener, heartbeats (migration `0008_processing_workers`), the Compose service, caps, `/api/health` processing summary, `npm run dev` with three services | `PROCESSING_ROLE`, default `all`; compose sets the roles |
| 2 | 0.6 | Bounded passes: the budget, splitting, growth within budget, the per-device pass interval; `remap` jobs on the existing table (`0009`: `moves`, `state`, `claimed_by`, `claimed_at`) | `PROCESSING_PASS_MAX_POINTS` 60 000; a very large value restores the old behaviour |
| 3 | 0.7 | `processing_jobs` and `processing_runs` (`0010`, data moved from `processing_queue`), claims and leases, the credit scheduler, poison jobs, the managed run with its API, page and CLI, `trail reprocess` queue-only, metrics and the minute summary | `PROCESSING_BACKFILL_SHARE`, `PROCESSING_LIVE_AGE_TARGET_S` |
| 4 | 0.7 | Daily statistics, alerts, the heat fill and the retention in the worker; `recovery_alert_due_at` (`0011`); the API without outbound requests | default; `all` keeps everything in one process |
| 5 | 0.8 | `db` settings, pool sizes, `TRAIL_WORKERS`, `processing_queue` dropped (`0012`); partitions with the capacity stream | — |

Production from today's state to the new worker without another incident:

1. **0.5.1 first.** The live window stops creeping; the 575 000-point row
   runs once more when its 55 tiles are in (about 40 min at Overpass's
   pace from the node) and then rests; the 29 day jobs alternate with live
   passes. Dump before the deploy, as for every release with a migration
   (`docker exec launchway-trail-backup-1 …`, runbook).
2. **Phase 1.** Rehearse on the Mac: restore the production dump into
   `compose.dev.yaml`'s stack with the branch's image, run the live
   simulator, watch `docker stats` and the logs for an hour. Deploy; the
   worker container takes the queue as it is; `app` processes nothing. The
   first preview of the pull request shows whether Launchway keeps `cpus`
   and `replicas` (§2.5).
3. **Phase 2.** Anything still large in the queue is split at its first
   claim. Watch `processing queue` lines: the oldest live age under a
   minute, passes under the budget.
4. **Phases 3–5.** The migration of `0010` moves the rows under one run,
   which the Settings page then shows with its progress; the day jobs it
   creates are the ones that were there.

Runbook changes (`docs/operations.md`): the "What runs" table gains
`worker`; a "Processing" section rewritten around the worker container —
its logs, `trail processing status`, pause and resume, the metrics port,
what `/api/health` says, restarting the worker alone (`docker restart
launchway-trail-worker-1`), the caps and how to raise them; new
troubleshooting rows (the worker is down and `/api/health` says so; the
oldest live age keeps growing; a failed job; a paused run; the old image's
worker container restarting after a rollback); "Rehearse a release on a
copy" with the simulator; and a note that a restored dump brings back its
queue.

## 8. Risks and open questions

| Risk or question | Recommendation |
|---|---|
| Launchway's Compose policy may strip `cpus` or `deploy.replicas` from a deployment (it keeps `mem_limit`) | Verify on the first preview of phase 1. If stripped: the pass budget still bounds the worker; add the keys to Launchway's policy as a follow-up there before any second worker |
| A `NOTIFY` is lost while the API's listener reconnects | The reconnect catch-up query (§2.3) ships with phase 1; the dashboard also refetches on its own SSE reconnect |
| Two processes migrate the schema | Already serialised by `runMigrations`'s advisory lock; both entries run it, the second finds nothing to do. Tested in `processingTopology.test.ts` |
| A rollback to an image without `trail worker` leaves the worker container restarting | Harmless; the runbook names it. No code can prevent it from the old image's side |
| The job row inside the ingest transaction adds a lock point on the hot path | The upsert targets a `ready` row by the partial unique index; a pass marks its rows `running` first, so the ingest never waits on a pass. Measured in the ingest p95 target |
| The daily statistics and the recovery alert arrive later (about 30 s and up to 60 s) | Accept; neither is a hot-path promise. A `stats` job of priority 1 keeps a time-zone change quick |
| The 50 % backfill share: too generous for live latency, or too little for a run? | Start at 0.5 with the 60 s live-age guard; the load test reports live age and run throughput at 0.3, 0.5 and 0.7 and the default moves if needed. The guard, not the share, protects live latency |
| Memory of a pass in a dense city with Overpass tiles (256-tile pieces of 250 MB) | The heap is 768 MB and pieces are sequential; with a local source `pieceMaxTiles` 128. The RSS target (§6.5) catches a regression |
| Partitioning `locations` under drizzle-kit, on a table with foreign keys and a cascade | Hand-written migration, a dump-restore rehearsal, the capacity stream's spike; not before the jobs table has settled |
| The disk: 181 GB at 42–100 GB a month; daily full dumps | Name it now (§6.2); the capacity stream sizes a data disk and replaces the dump with WAL archiving or incremental backups before any load test at 1 000 devices runs for real |
| High-resolution phones make 10× the points of a balanced one and 70 % of a heavy mix | A product decision, not this design's: a per-device daily point budget, or the preset's `min_time` nudged, later |
| Previews now run a worker container | Accept: an empty database idles at two polls a second |
| Should the heat cells, the one derived table the ingest still writes, move too? | No: their upsert is not idempotent and a pass must be repeatable (§3.2). Decided |
| `pending` in the timeline and Insights now reads `processing_jobs` | Same meaning (ready and running jobs overlapping the range; remap jobs excluded, as waiting windows were); the contract does not change |
| The `all` role keeps the old single-process behaviour available for ever | Keep it: it is what tests, the end-to-end server and a one-container install run. Document that production uses two roles |

## 9. Task breakdown

PR-sized, each with its migration (one per pull request, regenerated after a
rebase), its tests, its docs. Two lanes run in parallel at most (two
development containers on the Mac): lane A is the topology, lane B the job
model. Acceptance criteria are what the reviewer checks before merging;
every task keeps the three checks green and the OpenAPI snapshot deliberate.

| # | Lane | Task | Depends on |
|---|---|---|---|
| T0 | — | Ship 0.5.1 from `fix/window-growth` (the pull request exists; merge, release, verify the live row's bounds in production) | — |
| T1 | A | Worker role and entry: `PROCESSING_ROLE`; `apps/api/src/worker.ts`, `worker/startWorker.ts`, `worker/workerLoop.ts`, `cli/commands/workerCommand.ts`; the `ProcessingService` of the API reduced to enqueue; `events/processingNotify.ts` and `events/processingListener.ts` with the reconnect catch-up; `processing_workers` and heartbeats (migration); `createWorkerContext()` for tests | T0 |
| T2 | B | Bounded passes: `PROCESSING_PASS_MAX_POINTS`, `PROCESSING_PASS_MAX_SPAN_HOURS`, `processing/splitJob.ts`, `extendWindow` within the budget, the newest-half-stays-live rule, the 30 s per-device interval; `tests/support/processingInvariants.ts` and `processingService.test.ts` (§5.4, steps 1–3) | T0 |
| T3 | A | Compose: the `worker` service, roles, caps, health check, `PROCESSING_METRICS_PORT` with `/health/live` only; `scripts/dev.mjs` with three services; `/api/health` processing summary and `/api/health/processing`; `.env.example`, §4, the e2e environment; operations "What runs" | T1 |
| T4 | B | `remap` jobs and `WaySource.latency`: migration adding `moves`, `state`, `claimed_by`, `claimed_at`; the pass finishing a window with unmapped moves; inline fetching for a local source; stored-mapping reuse in every pass; `processingService.test.ts` step 4 | T2 |
| T5 | B | `processing_jobs` and `processing_runs`: migration moving `processing_queue`; claims with `SKIP LOCKED`, leases, poison jobs, `processingJobs.ts`, `processingRuns.ts`; `chooseNext.ts` with unit tests (a simulated queue: the share held within ±10 % over an hour, live age never over the target for more than one pass, full speed with no live work); `hasPendingWork` on the new table; `processingTopology.test.ts` | T4, T1 |
| T6 | A | Observability: `worker/metricsServer.ts` (Prometheus text), the pass phases, the minute summary, `processing run progress`, `processing job poisoned`; architecture §10 and §17.4 | T3, T5 |
| T7 | B | The managed run: creation at start and by `trail reprocess` (queue-only, `--wait`), progress and ETA, pause/resume/cancel, `GET/POST /api/admin/processing…` with contracts and the threat model, Settings › Administration › Processing with its tests, `trail processing status|pause|resume|cancel|retry|check` | T5 |
| T8 | A | Daily statistics, alerts (`recovery_alert_due_at`, migration), heat fill and retention in the worker; the `stats` job for a time-zone change; the API without outbound requests | T3 |
| T9 | either | `db` settings as `command:`, pool sizes (API 10 + listener, worker 5), `TRAIL_WORKERS`, the partition-ahead job behind a flag; `processing_queue` dropped one release later | T5 |
| T10 | either | Docs consolidation: architecture §3, §10, §11, §13, §17.4 as the code now is; operations "Processing", troubleshooting rows, "Rehearse a release on a copy"; README "Operations" | all |

Acceptance criteria and tests per task:

- **T1.** `PROCESSING_ROLE=api` starts no worker and `=worker` no HTTP
  server; `all` behaves as 0.5.1 (the whole integration suite passes
  unchanged). A `segments` event reaches an API context from a pass in a
  worker context on the same database; the listener survives a dropped
  connection (the test kills its backend with `pg_terminate_backend`) and
  the catch-up query publishes what was missed. Heartbeats are written and
  read. `trail worker` exits 0 on SIGTERM with a pass committed or rolled
  back, never half.
- **T2.** No pass reads more than the budget (asserted from the pass log in
  the scenario); a 12-day, 575 000-point job (the test builds 65 000 at a
  budget of 20 000) splits at its largest gaps; growth never exceeds the
  budget; I1–I5 hold after every pass; the live job's bounds never move
  earlier than queued; the backfill progresses during twenty live uploads.
- **T3.** `docker compose -f compose.yaml -f compose.dev.yaml up` runs three
  app containers with the caps; the worker's health check fails when the
  loop is stuck (a test mode that stops the heartbeat); `/api/health`
  reports `worker: down` 90 s after the worker stops and 200 regardless;
  the preview deployment shows the caps in `docker inspect`.
- **T4.** A window with missing tiles is finished in one pass with its
  unmapped moves served averaged; the remap pass touches only the listed
  moves (other `processed_points.processed_at` unchanged); a local source
  fetches inline up to the cap and a window with more tiles than that
  queues a remap; a tile due for refresh serves and queues a remap; the
  mapped kinds of a journey are the same whether it arrives in one upload
  or ten (`wayKinds.test.ts`); the benchmark holds.
- **T5.** Two workers never run one device at once; a worker killed
  mid-pass leaves no rows and its job is reclaimed within the lease; a job
  failing ten times is `failed`, logged once, retried on `trail processing
  retry`; `chooseNext` unit tests as above; the migration moves every row
  of `processing_queue` (the migration-upgrade test records queue rows
  before and expects jobs after).
- **T6.** `/metrics` parses with a Prometheus text parser in a unit test;
  every metric of §4.7 is present after one pass; the minute line carries
  the queue counts; no coordinate or tile key above debug level
  (`processingLog.test.ts` extended).
- **T7.** A version bump creates one run and supersedes an open one; pause
  stops passes within one pass; `done_points` and the ETA move; the admin
  page renders counts only (a test scans the answer for uuids of devices,
  names and timestamps of jobs); non-administrators get 404; `trail
  reprocess` returns within seconds and `--wait` ends when the run does.
- **T8.** Daily statistics after an upload appear within one live pass;
  the recovered alert within 60 s of the upload; the silent-device check
  runs in the worker only; with `all` everything runs once; the API's
  outbound calls are none (a test counts `fetch` calls through an injected
  `fetch`).
- **T9.** `db` starts with the settings (`SHOW shared_buffers` in a
  compose-level test on the Mac); pool sizes in the config; two replicas
  start and share the queue (a manual check on the preview).
- **T10.** Every section a task touched is up to date; the runbook's
  troubleshooting rows match the log lines; the README's features mention
  the worker.

Order of merges: T0, then T1 ∥ T2, T3 ∥ T4, T5, T6 ∥ T7, T8 ∥ T9, T10.
Phase 1 and 2 (T1–T4) make the next release; T5–T9 the one after.
