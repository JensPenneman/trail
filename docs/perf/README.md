# Load tests and their reports

This folder holds the reports of Trail's load tests: one markdown file per
run, with the collector's samples as a CSV next to it. The harness that makes
them lives in `tools/load/`; what it measures against is the capacity design,
[docs/design/capacity.md](../design/capacity.md) (§ below), whose target is
about 1 000 people on one node. A run that misses a target is reported all the
same — that is the point.

- [Run a load test](#run-a-load-test)
- [How the fleet is shaped](#how-the-fleet-is-shaped)
- [What a run does](#what-a-run-does)
- [Read a report](#read-a-report)
- [The thresholds and where they come from](#the-thresholds-and-where-they-come-from)
- [Production's baseline (M0) and the Mac](#productions-baseline-m0-and-the-mac)
- [Safety](#safety)
- [What the harness cannot measure yet](#what-the-harness-cannot-measure-yet)
- [Runs](#runs)

## Run a load test

On the Mac, with Docker Desktop running and the working tree at the commit
to measure:

```sh
npm run load -- fleet-10      # ten phones, one of each profile: about 40 minutes
npm run load -- fleet-100     # a hundred phones, the design's mix: about 80 minutes
```

| Scenario | Phones | The day in | History | Backlog | SSE streams | Probe | For |
|---|---|---|---|---|---|---|---|
| `fleet-10` | 10, one per profile | 1 800 s | 2 days | 8 h | 1 + the probe's | a point every 5 s | the harness end to end, every protocol (M1) |
| `fleet-100` | 100, the mix of §2.2 | 3 600 s | 2 days | 8 h | 15 + the probe's | every second | M1's measured run; M2's compressed day |
| `fleet-1000` | 1 000 | 3 600 s | — | 8 h | 150 + the probe's | every second | M3 (with partitioning and three months of history) |
| `soak-100` | 100 | 86 400 s (real time) | 7 days | 8 h | 15 + the probe's | every second | M2's 24-hour soak |

Options: `--quiet` waits until the Mac is quiet — the other containers below
half a CPU and the load average below the number of cores, three minutes in a
row, for at most 45 minutes —
which is how the runs below were made (a busy Mac measures itself: the first
smoke runs beside other worktrees' test suites, at a load average of 20, had
event-loop stalls of a second and k6 itself falling behind); `--keep` leaves
the stack running afterwards (`docker compose -p trail-load down -v` removes it), `--image <tag>` measures an image built
before instead of building one, `--seed <n>` plays another fleet (default
1), `--port <n>` publishes the app on another loopback port (default 18787),
`--routes <file>` takes other routes (below), `--tmp <dir>` puts the run's
folder elsewhere (default the system's temporary folder; it is named
`trailload-<scenario>-…`).

**At most two Trail stacks run on this Mac at a time** (16 GB; it went down
once under four). The capped stack counts as one: its app container is named
`trail-load-dev-1`, like the development containers, so that
`docker ps --format '{{.Names}}' | grep -c '^trail-.*-dev-1$'` sees it. The
runner waits while two others run, refuses to start while a `trail-load`
stack exists, and removes the stack and its volume when it ends, also after
a failure. Run `fleet-100` once at a time and off-peak: it keeps the Mac
busy for an hour.

## How the fleet is shaped

The phones are the ten profiles of §2.2, in the shares a thousand people would
choose them (scenario A; `trail load-fleet --mix steered` gives scenario B),
each with one of the three behaviours of §2.1 — commuters (half, 90 moving
minutes a day), drivers (15 %, 240), people who mostly stay home (35 %, 30).
A phone's moves start at hours drawn from §2.1's hourly weights, and while it
moves or lies still it records at its app's real rates, uploads as its app
does and retries as its app does (§3.1's list: Overland keeps its batch,
OwnTracks for iOS drops a message on a 4xx and keeps it on a 5xx, GPSLogger
drops a point after three tries…). Every number comes from a seed
(`tools/load/lib/random.js`), so a run can be played again.

| Profile | App, endpoint | While moving | While still | Uploads |
|---|---|---|---|---|
| `overland-balanced` | Overland, `/api/overland` | 10 a minute | the minutes before iOS pauses | a batch every 5 min |
| `overland-balanced-plus` | Overland | 60 a minute | the minutes before iOS pauses | a batch every 5 min |
| `overland-high-resolution` | Overland | 60 a minute | 27 a minute (iOS's fixes of a phone on a desk) | a batch every minute |
| `overland-battery-saver` | Overland | 0.4 a minute | 0.08 a minute | ~37 wake-ups a day |
| `owntracks-ios-move` | OwnTracks for iOS, `/api/owntracks` (bearer) | 12 a minute | 1 a minute | every point, and region events |
| `owntracks-ios-significant` | OwnTracks for iOS | 0.4 a minute | 0.05 a minute | every point, and region events |
| `owntracks-android` | OwnTracks for Android (HTTP Basic) | 3 a minute | — | every point |
| `traccar` | Traccar Client 10, `/api/osmand` (form) | 2 a minute | — | every point |
| `osmand` | OsmAnd, `/api/osmand?token=…` | 12 a minute | — | every point |
| `gpslogger` | GPSLogger, `/api/osmand` (bearer) | 1 a minute | 1 a minute | every point |

What each app sends is what the integration tests' samples hold
(`apps/api/tests/support/trackerSamples.ts`, built from the apps' sources)
and the repository's Overland fixture: Overland's features with their
tracking stats, `current`, the trip in progress and iOS's visits; OwnTracks'
messages of either platform with their extended data; Traccar Client's form
with speed in knots; OsmAnd's address with the time in milliseconds;
GPSLogger's with ISO times and the token in a header
(`tools/load/lib/encoders.js`; `tools/load/test/encoders.test.mjs` compares
them).

Played over a real day, a thousand phones send what §2.3 computes — the
harness's tests hold the generator to it (`tools/load/test/schedule.test.mjs`,
within 5 to 15 %):

| A thousand phones, a day | §2.3 | The generator |
|---|---|---|
| points | 3 118 000 | 3 153 000 |
| requests | 482 600 | 479 000 |
| points/s, mean · 08 h · 02 h | 36.1 · 51.4 · 27.8 | 36.5 · 53.1 · 25.9 |
| requests/s, mean · 08 h · 02 h | 5.59 · 9.42 · 3.49 | 5.54 · 8.72 · 3.61 |
| requests in the worst 10 s | 117 (p99 around the peak) | 106 |
| an 8-hour backlog | 1.04 M points | 1.02 M points |

**A compressed day.** A run plays one day in `daySeconds`: the share of
phones moving at every moment is that of the hour of the day it stands for,
and a phone records and sends at its real rates, so the day's rates and peaks
come in less time (36 points/s at a thousand phones either way). What shrinks
with the day are the moves and stops: the five-minute senders (balanced,
balanced-plus) send smaller batches more often (+10 % requests), a batch
sent minutes after a move lands an hour or two later in the day's terms (the
morning peak smears into 09 h), and processing windows are shorter than a
real day's. The 24-hour soak (`soak-100`) keeps all of it.

**Routes.** Every phone goes back and forth along a recorded route: until the
map-data stream's extract reader exists (`generate-routes.mjs` of §6.2), the
route source is the recorded Overland fixture,
`apps/api/tests/fixtures/overland-batch.json` (a 13.7 km bicycle ride out of
Ghent). The source is pluggable: `--routes <file>` takes another Overland
batch, or a file of routes, `{ "routes": [{ "name": …, "coordinates": [[lon,
lat], …] }] }`, which is what the extract will write.

## What a run does

1. Builds the image of the working tree (`trail-load:<commit>`) with the
   production Dockerfile.
2. Starts the capped stack as Compose project `trail-load`: the production
   file (`deploy/compose.yaml`) with `tools/load/compose.load.yaml` over it —
   `app` at 1 CPU and 1 GiB, `db` at 2 GiB (and 2 CPUs) as on the node, a
   database volume of its own, no backup service, no edge, the app on
   `127.0.0.1:18787` for the probe, `LOAD_TEST=true`, no map data. When
   `deploy/compose.yaml` gains the worker service, `compose.load.yaml` caps
   it at 1 CPU and 1 GiB too.
3. Measures the database volume's fsync (`pg_test_fsync`).
4. Creates the fleet: `docker compose exec -T app trail load-fleet --people
   <n> --probe > fleet.json` — synthetic people at the `.invalid` domain, a
   phone and a device token each, a session each, shares among them (30 %
   share with the next two), and the probe's own person and phone.
5. Writes the history (`tools/load/backfill.mjs`): the days before, as the
   profiles record them, straight into `locations` with `COPY` through `psql`
   in the database container, then `trail recompute` and `trail reprocess`
   over them, timed.
6. Plays the day: k6 runs `day.js` in its container — the phones
   (`fleet.js`) and the people (`dashboard.js`) at once — while the SSE probe
   (`sse-probe.mjs`) and the collector (`collect.mjs`) run on the host.
7. Plays the backlog (`backlog.js`): every phone sends the 8 hours it
   recorded while the node was away, as its app does.
8. Waits a minute for the last load line, stops the probe and the collector,
   checks that every acknowledged point is stored, and writes the report into
   this folder (`report.mjs`).
9. Removes the stack and its volume, and the fleet's secrets from the run's
   folder; the rest of the folder stays for a look.

**k6.** Grafana k6 2.2.0 from its official image, pinned by digest in
`compose.load.yaml`; k6 is AGPL-3.0 and never vendored, built or copied into
this repository. Its usage report to Grafana is off (`K6_NO_USAGE_REPORT`).
The phones are an open model: a `constant-arrival-rate` executor starts an
iteration every tenth of a second, whether or not the server keeps up, and
each sends the uploads that fall in its tenth, so the arrivals are the
schedule's, bursts included; a slow server makes k6 start more virtual users,
and what it could not start counts as `dropped_iterations` (a gate: the run
is only valid without).

**The load line.** The API logs a line `"msg":"load"` once a minute at
`info`, in production too: the minute's event-loop delay (p50, p99, max),
the pool (connections, idle, waiting), open SSE streams, background tasks,
device-days waiting for their daily statistics, uploads, points,
duplicates and rejects, RSS and heap, and the processing queue (rows, new
windows ready, how long the oldest has waited since it became ready).
Numbers only — no id, name, token or coordinate (a test holds it to that).
`docker logs launchway-trail-app-1 2>&1 | grep '"msg":"load"'` shows it on
the node.

**A run's folder** (temporary): `compose.env` (the stack's variables, a random
database password), `fleet.json` (the fleet's ids and secrets, mode 0600,
deleted at the end), `routes.json`, `config.json` (what k6 reads),
`day.summary.json` and `backlog.summary.json` (k6's summaries),
`probe.result.json`, `collector.csv` and `collector.json`, `checks.json`
(what the database recorded) and `run.json`.

## Read a report

A report is named `<date>-<commit>-<scenario>.md`. From the top:

- **The table**: scenario and seed, commit and image, what else the Mac did
  meanwhile (its load average and the other containers' CPU; the CSV has them
  every 10 s), machine, the caps, the database volume's fsync against the
  node's, and the verdict.
- **Targets**: every target of §3 — the measured value, pass or **FAIL**, and
  whether it is *gated* (milestone 1 holds a run to it: the verdict and the
  exit code follow it) or *tracked* (reported now, held once the work that
  moves it has landed: the worker's contract for amplification and queue
  age, the storage parameters for HOT and dead tuples, partitioning and the
  backups for disk and WAL, the node for CPU). "no samples" means the run
  had nothing of that kind (no batch of 1 000 points, say).
- **Workload as run**: what the phones sent per profile, scaled to a day,
  against §2.2's day; the fleet's rates against §2.3 at this size.
- **Ingest, client side**: k6's latencies per batch class — what a phone
  waits for, the COMMIT and the network hop included — and the acknowledged,
  retried, dropped and unsent uploads.
- **Ingest, server side, against production**: `ingest_log.duration_ms` in
  production's classes, beside M0. The column ends before the COMMIT, so it
  leaves out the fsync; compare like with like.
- **Dashboard**: every request of an open and of a visit, p50 to max.
- **Live events**: the SSE probe's lags (below).
- **The app and the containers**: the load lines' peaks and docker stats.
- **Postgres**: rows written per table, HOT shares, WAL, size, checkpoints,
  cache hits, bytes per row against production's, the top statements.
- **History and backfill**: the COPY, `trail recompute` and `trail
  reprocess`, with the throughput of §3.2.
- **What this run cannot tell.**

The probe's lags: *delivery* is from sending its marked upload to that
upload's `ingest` event on its own stream (§3.2's SSE target); *after the
answer* from the upload's acknowledgement to the event; *fan-out* from the
server's `receivedAt` of every upload to its event on every stream (the k6
phones' uploads); *processing* from the upload to the `segments` event of the
window that covers it.

## The thresholds and where they come from

Every threshold is a target of §3, written once in `tools/load/lib/targets.js`
for both the k6 scripts and the report:

| Target | Value | Where it comes from |
|---|---|---|
| upload of 1 point | p50 ≤ 12 ms, p95 ≤ 40, p99 ≤ 100 | §3.1: the fixed cost of an upload — the device lock, six cell upserts, the device update, the log row, one fsync |
| upload of 2–99 points | ≤ 30 / 80 / 200 ms | §3.1's 30–60 row (a 1 Hz phone every minute) |
| upload of 100–399 points | ≤ 60 / 150 / 300 ms | §3.1's 200–300 row (balanced, balanced-plus) |
| upload of 400–699 points | ≤ 100 / 250 / 500 ms | §3.1's 500 row (the backlog flush) |
| upload of 700 points or more | ≤ 180 / 400 / 800 ms | §3.1's 1 000 row |
| failed valid uploads | ≤ 0.01 % | §3.1's error budget: 5xx only as 503 while the database is away |
| 429/503 of the per-device limits | ≤ 0.1 % a normal day, ≤ 2 % in a backlog flush | §3.1 |
| data loss | 0 points dropped by an app, 0 acknowledged points missing | §3.1: zero |
| devices, people, shares, session, configuration | p95 ≤ 100 ms | §3.2 |
| the timeline of a day | p95 ≤ 200 ms | §3.2 |
| today's tracks | p95 ≤ 400 ms | §3.2 |
| History, a day of a device | p95 ≤ 800 ms (warm) | §3.2 |
| heatmap viewport | p95 ≤ 150 ms | §3.2 |
| Insights, a month | p95 ≤ 1 s | §3.2 |
| SSE delivery | p95 ≤ 1 s, p99 ≤ 3 s | §3.2 |
| event loop | p99 ≤ 50 ms over any minute, ≤ 200 ms ever | §3.2 |
| app memory | RSS ≤ 700 MB, heap ≤ 450 MB | §3.3 |
| processing queue age, throughput, backfill | p95 ≤ 5 min quiet, ≤ 15 at the peak, never > 1 h; ≥ 1 500 points/s; ≥ 600 device-days/h | §3.2 (tracked until the worker's contract) |
| CPU, Postgres, WAL, disk, amplification | §3.3, §5.2 | tracked |

**Client side and server side.** §3 defines the ingest targets server-side,
as `ingest_log.duration_ms` records them in production every day; §6.3 has k6
hold them on its own `http_req_duration`. The gates are k6's, the stricter of
the two: what the phone waits for, the COMMIT, the response and the hop
included, while `duration_ms` ends before the COMMIT. Every report shows the
server side as well, in §3.1's classes and in production's.

A batch is held to the row of the next larger size §3.1 names. The
day-statistics and activity requests and the access log have no target in
§3.2: their percentiles are reported, not judged. The dashboard's failed
requests must stay under 0.1 %.

**Gates.** Milestone 1 holds a run to the ingest latencies, the error budget
and data loss, the dashboard's targets, SSE delivery, the event loop, memory
and the generator's own health (`dropped_iterations`). The rest is tracked:
it needs work of later milestones (§7) and is gated from there on.

**Calibration (§6.5).** The targets are the node's; on the Mac a threshold is
the target divided by the calibration factor of the metric
(`calibration` in `targets.js`), which is 1 until the same `fleet-100` has run
on a preview of the node twice (task T6). With the factor at 1 the Mac's
gates are lenient: the Mac is faster per core and its disk syncs faster
(below), so a Mac run that passes is necessary, not sufficient.

## Production's baseline (M0) and the Mac

Measured on production (the node, one phone, Postgres 18 in the `db`
container) on 28 October 2026:

| | Production (M0) |
|---|---|
| uploads of < 10 records | p50 8 ms, p95 13 |
| 10–99 records | n 195: p50 12 ms, p95 19, p99 28, max 248 |
| 100–499 records | n 1 225: p50 27 ms, p95 52, p99 82, max 382 |
| 500 records or more | n 7: p50 70 ms, p95 231, p99 253 |
| volume | 100–280 uploads and 23 000–76 000 points a day |
| row sizes | `locations` 256 B a row (table and indexes), `processed_points` 320 B |
| WAL | 16 GB since 23 October, ≈ 3.2 GB a day for one phone — the processing's rewrites, the amplification §5.2 predicts |
| database | 780 MB |
| fsync (`pg_test_fsync`, one 8 kB write) | open_datasync 797 ops/s (1.26 ms), fdatasync 837 ops/s (1.20 ms) |
| HOT share of updates | `devices` 100 %, `daily_stats` 100 %, `heat_cells` 92 % |
| settings | Postgres defaults: `shared_buffers` 128 MB, `work_mem` 4 MB, `max_connections` 100, `wal_compression` off, `checkpoint_timeout` 300 s, `synchronous_commit` on, `random_page_cost` 4; `pg_stat_statements` not installed |

The upload latencies are `ingest_log.duration_ms` over 7 days, which ends
before the COMMIT: production's fsync of about 1.2 ms comes on top of them.
Every report sets the Mac's own `ingest_log` latencies in the same classes
and its volume's fsync beside these, which gives a first Mac-to-node ratio
for ingest at low load; the calibration of §6.5 replaces it once the node has
run the same scenario. The capped stack runs Postgres with its defaults too,
plus `pg_stat_statements` and `track_io_timing` for the report (§4.6 brings
both to production).

The first comparison, from the reports of 28 October 2026 below:

<!-- calibration:start -->

| | Production (the node, M0) | Mac, `fleet-10` | Mac, `fleet-100` |
|---|---|---|---|
| fsync, fdatasync (one 8 kB write) | 837 ops/s (1.20 ms) | 14 966 ops/s | 16 334 ops/s (0.06 ms) |
| `ingest_log` p95, < 10 records | 13 ms | 9.1 ms (0.70 ×) | 8.0 ms (0.62 ×) |
| `ingest_log` p95, 10–99 records | 19 ms | 17.6 ms (0.93 ×) | 16.2 ms (0.86 ×) |
| `ingest_log` p95, 100–499 records | 52 ms | — | 59.1 ms (n 7; 1.14 ×) |
| `locations`, bytes a row | 256 | 259 | 261 |
| `processed_points`, bytes a row | 320 | 178 | 217 |
| WAL a point | ≈ 70 kB (3.2 GB a day, 45 000 points) | 5.8 kB | 14.1 kB |

The Mac's volume syncs about twenty times faster than the node's, yet a small
upload takes 0.6–0.9 times production's time on the server: an upload is
round trips to Postgres and Node's work more than its fsync, and the Mac
shared its cores with Spotlight and other worktrees during both runs (load
averages up to 30–38). Rows weigh what they weigh in production
(`locations` 256 against 259–261 bytes). WAL is where a compressed day
misleads: production writes about 70 kB of WAL a point for its one
high-resolution phone, whose whole night the processing rewrites every
minute (§5.2), while a compressed day's stops last minutes and its runs
write 6–14 kB a point — the 24-hour soak (`soak-100`, M2) is where the
amplification and the WAL target are measured. The calibration factor of
§6.5 (expected 1.5–2 on CPU-bound numbers, 1–3 on fsync-bound ones) still
needs the same scenario on the node.

<!-- calibration:end -->

## Safety

Load data and real data never share a database.

- **`trail load-fleet` refuses** unless all of these hold: `LOAD_TEST=true`
  in the app's environment; `LAUNCHWAY_ENVIRONMENT` is not `production`
  (Launchway names every deployment `production` or `preview`, and
  `deploy/compose.yaml` passes that one variable of Launchway's to the app
  for this check); the database holds no passkey (nobody has ever signed in
  there) and no account but the load test's own. It checks the environment
  before it opens the database, the database before the CLI would migrate it
  (so a wrong `DATABASE_URL` is never touched), and both again under the
  sign-up lock in the one transaction that writes the fleet, so nobody signs
  up in between and a refusal or a failure leaves nothing behind. It refuses
  to write the fleet's secrets into a terminal; `docker exec` without `-t`
  hides the terminal from it, so redirect its output to a file there too.
  The integration tests try each condition alone
  (`apps/api/tests/integration/loadFleet.test.ts`).
- **No production path.** The runner drives only the stack it started on
  this machine: it has no option for another address, refuses a Docker
  context or `DOCKER_HOST` that is not a local socket, and hands Compose only
  the variables Docker needs, so that nothing exported in the shell (a
  `TRAIL_DB_VOLUME`, a `TRAIL_IMAGE`) reaches the stack. Ctrl-C removes the
  stack and the fleet's secrets as the end of a run does. Its synthetic
  accounts are at `load.invalid`, a domain that cannot exist (RFC 2606).
- **Nothing secret or personal in a log line or a report.** The app's load
  line holds numbers only; `trail load-fleet` prints counts on stderr and its
  secrets only on stdout, into the file; the runner redacts k6's and
  Compose's output a whole line at a time before it shows it (device tokens,
  sessions, the Basic credentials of OwnTracks for Android, the accounts'
  addresses, positions in a URL, a form or JSON — OsmAnd's address carries
  its token, and k6 names a URL in its warnings), and k6 tags every request
  with a name, never its URL; the collector follows the app's log and keeps
  numbers of it, never a line;
  `report.mjs` refuses to write a report that would hold a token, a session,
  an address, a position or any of the fleet's secrets. The harness's tests
  hold each of these.
- **On the node** (§6.4, later): a load test there is a preview with
  `LOAD_TEST=true` in its variables — never production, never
  `trail.jenspenneman.com` — and the preview, its database and the fleet go
  with the pull request.

## What the harness cannot measure yet

- **The node.** These are the Mac's numbers until a preview of the node has
  run the same scenario (§6.4, §6.5; task T6): CPU, the WSL 2 disk path and
  thermal throttling are the node's own.
- **Map matching.** The stack has no map data (a load test never asks the
  public Overpass instance), so the mapped level degrades to averaged and the
  processing does less than in production, until the map-data stream's
  extract is there.
- **Real routes.** Every phone rides the one recorded fixture route until
  `generate-routes.mjs` reads the extract.
- **The worker as a process of its own**, `NOTIFY` across processes, the
  incremental statistics and the hourly rollup: processing runs in the app's
  process and is measured there (tasks T2, T3).
- **A real day's moves and stops** in a compressed run (above); the soak has
  them.
- **The edge, the deploy's restart burst, export throughput, archives and
  backups**: not part of a Mac run.
- **Short lock waits**: seen only when a 10-second sample catches them.

## Runs

<!-- runs:start -->
| Run | Date | Commit | Scenario | Gates |
| --- | --- | --- | --- | --- |
| [2026-10-28-ad9e5d5-fleet-100](2026-10-28-ad9e5d5-fleet-100.md) | 2026-10-28 | `ad9e5d5` | fleet-100 | fail |
| [2026-10-28-0d99ed5-fleet-10](2026-10-28-0d99ed5-fleet-10.md) | 2026-10-28 | `0d99ed5` | fleet-10 | fail |
<!-- runs:end -->
