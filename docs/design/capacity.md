# Trail — load test and capacity targets

The target: about 1 000 people sending their location through the day, served
by one node — the Windows laptop that runs Launchway. This document sizes that
workload, sets the targets one node has to meet, plans the storage, reviews
the ingest hot path, designs the load-test harness in `tools/load/` and
breaks the work into milestones. It assumes three parallel design streams
land and says what each must achieve: processing in a worker container of its
own, map data from a local OpenStreetMap extract, and a browser cache with
delta sync. Sections refer to [architecture.md](../architecture.md) by `§`.

Every number below is derived in the open, from the apps' real settings
(§6.3–6.6), from production today (one device, 1.27 M points in 28 days,
45 400 points a day; uploads of about 30 points at 28 ms median, 900 points
at 76 ms, §8.2) and from the node's hardware. Where a number is a guess it
says so; milestone 0 (§7) replaces the guesses with measurements.

**What the arithmetic says, in short**

| | |
|---|---|
| Points | 3.1 M a day (36/s mean, 51/s at the morning peak), 95 M a month |
| Requests | 483 000 a day: 5.6/s mean, 9.4/s at the peak hour, 12/s in the worst ten seconds of it |
| Bytes in | 1.9 GB a day, 22 kB/s — the phones' uploads are small |
| Who sends what | the 50 phones on Overland's high-resolution preset send 72 % of all points; the 600 one-point-per-request phones send 83 % of all requests |
| CPU | ingest is under 2 % of the app's core; one API process stays enough to about 5 000 devices |
| Database | 63 GB a month as people would choose their presets (scenario A), 35 GB with the presets steered (B); the node's 181 GB free holds 3 to 5 months |
| What breaks first | the processing worker as written (it rewrites a 1 Hz phone's whole night every minute), the daily statistics (a whole day re-read per upload), then the disk, then backups by `pg_dump` |
| The decision that matters most | a disk: a 2 TB SSD for the database volume and another place for the backups. Without it 1 000 people are a six-month experiment |

---

## 1. The node and its budget

| | i7-9750H laptop, 16 GB, Docker Desktop on WSL 2 (VM: 12 CPUs, 8.25 GB), consumer SSD, 181 GB free |
|---|---|
| `app` | 1 CPU, 1 GiB (`mem_limit`), V8 heap 640 MB |
| `worker` (the processing stream) | 1 CPU, 1 GiB, heap 640 MB — a second Node process; the map pieces of up to 250 MB live here, not in the API |
| `db` (Postgres 18) | 2 GiB today; this plan asks for 3 GiB and 2 CPUs (§4.6) |
| `backup` | 512 MiB, 1 CPU, busy about an hour a day (§4.7) |
| Launchway's checks | one at a time, 3 GiB, 6 CPUs, 25 minutes per commit |
| Launchway, its edge (TLS, routing), media containers | 1–2 GiB together |

The VM's 8.25 GB is over-committed once a check runs beside Trail (3 + 1 + 1 +
3 + 0.5 + 1.5 = 10 GB): the VM swaps, and the laptop's 16 GB with Windows
needs about 4 GB for itself. Two settings are part of this plan: the VM at
11 GB (`.wslconfig`, `memory=11GB`), and the checks at 2.5 GiB, which the test
suites were sized for (§16, 1.9 GiB at the peak). CPU is not the constraint:
the laptop's six cores are idle most of the day; what limits them is heat
(§8).

The numbers below are for the node. The Mac that runs the daily load tests
(§6) is 1.5–2× faster per core; §6.5 calibrates the two once.

## 2. Workload model

### 2.1 Who moves when

A thousand people, three behaviours. The share moving at any moment follows
the day: 2 % at night, 17 % at the morning peak, 10 % over the waking day —
the "10–20 % moving" the target names.

| Behaviour | Share | Moving per day | Pattern |
|---|---|---|---|
| Commuters | 50 % | 90 min | two moves on weekdays (07–09, 16–18), errands at noon and in the evening, a long trip at the weekend |
| Drivers | 15 % | 240 min | on the road through the working day, a stop every half hour |
| Mostly stationary | 35 % | 30 min | one short errand, long stays at home |

Weighted: 0.5 × 90 + 0.15 × 240 + 0.35 × 30 = **91.5 moving minutes a day per
person**, 1 348 still. The hourly weights of the moving minutes (sum 24, so
the mean weight is 1): 0.1 from 00 to 05 h, 0.6 at 06, 2.2 at 07, **2.6 at
08**, 1.4, 1.0, 1.0, 1.3 at noon, 1.1, 1.0, 1.2, 1.9 at 16, **2.5 at 17**, 2.0
at 18, 1.2, 0.8, 0.6, 0.4, 0.2 at 23 h (then scaled to sum 24: the peak is
2.64, the trough 0.10).

### 2.2 What each app sends

Per device and day, from the settings Trail hands the phones (§6.3, §6.5,
§6.6) and the apps' own behaviour, at 91.5 moving minutes. "Still" points are
the ones a phone records while it lies somewhere; they do not follow the hourly
weights, they are uniform through the day — and they decide the night load.

| App and setting | Devices | Points while moving | Points while still | Points/day | Uploads/day | Points/upload | Wire, kB/day |
|---|---|---|---|---|---|---|---|
| Overland balanced (`min_time` 5 s, `min_distance` 10 m, pauses) | 250 | 10/min | 0 (+180 before each pause) | 1 100 | 22 | 50 | 665 |
| Overland balanced-plus (1 Hz, `min_distance` off, pauses) | 50 | 60/min | 0 (+1 080 before pauses) | 6 570 | 22 | 300 | 3 950 |
| Overland high-resolution (1 Hz, never pauses) | 50 | 60/min | 1 Hz | 42 000 (production: 45 400) | 1 440 | 29 | 25 800 |
| Overland battery-saver (significant changes) | 50 | 0.4/min | 0 | 150 | 37 | 4 | 100 |
| OwnTracks iOS move (30 m, at least every 60 s) | 50 | 12/min | 1/min | 2 450 | 2 450 | 1 | 1 710 |
| OwnTracks iOS significant | 100 | 0.4/min | 0.05/min | 100 | 100 | 1 | 75 |
| OwnTracks Android (15 s, 25 m, high accuracy) | 100 | 3/min | 0 | 300 | 300 | 1 | 210 |
| Traccar Client (30 s, 30 m, 30°, stop detection) | 200 | 2/min | 0 | 200 | 200 | 1 | 110 |
| OsmAnd (live tracking every 5 s while recording) | 50 | 12/min | 0 | 1 100 | 1 100 | 1 | 715 |
| GPSLogger (every 60 s, no distance filter) | 100 | 1/min | 1/min | 1 440 | 1 440 | 1 | 1 010 |

Wire sizes: an Overland feature is 609 bytes in the repository's fixture
(tracking stats included), an OwnTracks message about 350, a Traccar form
250, a GPSLogger or OsmAnd `GET` 500–650 with its headers; a request's
headers are about 350 bytes. TLS ends at Launchway's edge, so these are what
the app sees.

Visits, trips and events are a small share: Overland reports about eight
visits (each twice), four trips and twenty log events a day, OwnTracks a few
region transitions, Traccar Client none unless the heartbeat is on — about
16 000 rows a day for the fleet, **0.5 % of the point rows**.

### 2.3 The fleet

| | Points/day | Requests/day | Mean | Peak hour (08 h) | Night (02 h) | Worst 10 s at the peak |
|---|---|---|---|---|---|---|
| Points | **3 118 000** | | 36.1/s | 51.4/s | 27.8/s | — |
| Requests | | **482 600** | 5.59/s | 9.42/s | 3.49/s | 11.7/s |
| Bytes | 1.93 GB | | 22.3 kB/s | 33 kB/s | 16 kB/s | |

How: 26 % of the points and 42 % of the requests follow the hourly weights
(moving), the rest is uniform; the peak hour is 2.64 × the moving share plus
the uniform one. The worst ten seconds are Poisson around the peak-hour mean
(λ = 94 in 10 s; p99 = λ + 2.33 √λ = 117 → 11.7/s): phones' timers are not
synchronised, so bursts are statistical, not structural. **Two structural
bursts are not in that table** and the targets (§3) name them:

- **The deploy.** A release restarts `app` (10–30 s). Every phone that
  uploads in that window retries — Overland at its next interval, OwnTracks
  Android with backoff, Traccar Client at its next fix — so about 300
  requests and 10 000 points (the 1 Hz phones bring two minutes each) arrive
  again over the next 1–5 minutes: half as much again as the peak rate for a
  minute.
- **The morning after.** The node slept, was updated or lost its line for
  eight hours: 1.04 M queued points (a third of a day) arrive as fast as the
  phones can send them. Overland sends batches of 200–500 back to back, the
  high-resolution phones 58 batches of 500 each; the one-point-per-request
  apps send one at a time, in order. The per-device limits (300 batches and
  1 200 single points a minute) and the server's own speed pace that flood;
  at 7 000 points/s of batch ingest (§5.1) the database side needs about
  150 s, and the whole flush is over in under ten minutes.

Two scenarios run through the rest of the document. **A** is the table above,
people choosing freely. **B** steers the presets: high-resolution for ten
phones (an administrator's choice), the forty others on balanced-plus →
1.70 M points a day (3.12 − 40 × 42 000 + 40 × 6 570), 52 M a month, requests
unchanged. The server does not thin points — recorded data is recorded (§2 of
the architecture) — so the preset is the only lever on the point volume, and
B is the recommended default: iOS's own pause after a quarter of an hour still
costs the high-resolution phone nothing it would see (the 1 Hz points of a
phone on a desk).

### 2.4 The dashboard, tokens, shares

| | Model | Load |
|---|---|---|
| Opens | 60 % of people open Trail daily, 2.5 times: 1 500 opens a day, 12 % of them in the evening peak hour (3 a minute) | an open is 9 requests (session, config, devices, people, shares, today's tracks at the account's level, the timeline, day statistics, activity) and one SSE stream: 0.45 requests/s at the peak |
| Browsing | a visit lasts 4 minutes: 2 History day views, 0.3 heatmap views, 0.2 Insights, 0.1 access log | 0.15 requests/s at the peak; each History day of a 1 Hz phone is a 45 000-row read (§5.4) |
| SSE streams | 10 % keep a tab open: 100 streams, 150 at the peak; each pings every 20 s and re-checks its session then | 7.5 session lookups a second at the peak — point reads, 0.1 ms each |
| Live refreshes | an open tab refetches its tracks 20 s after an upload (`trackRefreshDelayMs`) and its activity every 5 min | a 1 Hz phone with its tab open: a 45 000-row track read every minute until the delta-sync stream lands (§5.4) |
| API tokens and MCP | 10 % hold a token; an agent makes 20 calls a day | 2 000 calls a day, each under the 10 s read-only timeout; nothing at the peak worth noting |
| Shares | 30 % share with two people: 600 shares; 2 % of recipients watch at any moment | a `person` event per upload of a shared device whose recipient has a stream: about 1 a second at the peak, each a few point reads |
| Public links | 50 a day, 10 views each | negligible |

The dashboard is a rounding error next to ingest in requests and in Node CPU;
it is not one in Postgres reads, because of heap locality (§5.4).

## 3. Targets (SLOs) for one node

All measured on the node (not the Mac), at scenario A's peak hour with the
backlog flush of §2.3 played once an hour and the worker busy with a backfill.
Latencies are server-side, which `ingest_log.duration_ms` records for every
upload — so the ingest targets are checked in production every day, no
harness needed.

### 3.1 Ingest

| Batch | p50 | p95 | p99 | Why |
|---|---|---|---|---|
| 1 point (OwnTracks, Traccar, OsmAnd, GPSLogger) | ≤ 12 ms | ≤ 40 ms | ≤ 100 ms | the fixed cost of an upload: the device lock, six cell upserts, the device update, the log row, one fsync (§5.1); production's 28 ms median for 30 points holds a fsync of 5–15 ms on this SSD |
| 30–60 points (1 Hz every minute) | ≤ 30 ms | ≤ 80 ms | ≤ 200 ms | production 28 ms, +40 % for level 20, +50 % for a thousand devices' index and cache pressure |
| 200–300 points (balanced, balanced-plus) | ≤ 60 ms | ≤ 150 ms | ≤ 300 ms | 0.07 ms a point marginal (76 ms for 900 points) |
| 500 points (the backlog flush) | ≤ 100 ms | ≤ 250 ms | ≤ 500 ms | |
| 1 000 points | ≤ 180 ms | ≤ 400 ms | ≤ 800 ms | 120–151 ms measured with six levels in the development container |

**Error budget: zero data loss.** The apps keep what Trail has not
acknowledged, so an upload may be refused only with a status that the app
retries on — and the rules differ (§6): Overland retries any answer but
`{"result":"ok"}` at its next interval; OwnTracks Android retries a non-2xx up
to 100 000 times (backing off to two minutes); OwnTracks iOS keeps a message on
a 5xx and **drops it on a 4xx**; Traccar Client keeps its queue in order;
OsmAnd buffers for its configured hour; GPSLogger drops a point after three
failed tries, minutes apart. Hence:

- ingest availability ≥ 99.9 % a month (43 minutes down), the deploy's
  30 s included, so that GPSLogger's three tries are never all spent;
- 5xx on a valid upload only as `503` with `Retry-After` while the database is
  away, never from a bug: ≤ 0.01 % of requests a month;
- `429`/`503` from the per-device limits ≤ 0.1 % of requests in a normal day,
  ≤ 2 % during a backlog flush (that is what the limits are for);
- a body over the limit (`413`), a compressed one (`415`) and an invalid record
  (dead letter, acknowledged) are not errors of the server.

### 3.2 API, SSE, processing

| Target | Value at the peak, worker busy | Why |
|---|---|---|
| `GET /api/devices`, people, shares, session | p95 ≤ 100 ms | cached columns and small index scans; today's count of a 1 Hz phone is a 45 000-entry index range (§5.3 makes it O(1)) |
| timeline (`/api/v1/segments`, a day) | p95 ≤ 200 ms | a `(device_id, ended_at)` range of 20–60 rows |
| today's tracks, one device, 1 Hz | p95 ≤ 400 ms | a 45 000-row read plus RDP: ~70 ms of CPU on the event loop |
| History, one day of one device | p95 ≤ 800 ms warm, ≤ 3 s cold | the heap-locality problem of §5.4; the cold number is what one page read per row costs on this SSD |
| heatmap viewport | p95 ≤ 150 ms | measured under 10 ms on 1.2 M points; a thousand devices' cells are summed per request, 20 000 at most |
| Insights, a month | p95 ≤ 1 s | segment aggregates by local day |
| export | ≥ 20 000 points/s streamed | pages of 20 000 with backpressure |
| per-IP API limit | no `429` for an office of 50 people | 600/min/IP ≈ 50 people × 12 requests a minute; §5.5 keys signed-in requests by session |
| SSE delivery lag | commit → browser p95 ≤ 1 s, p99 ≤ 3 s | `ingest` is published right after the response; the worker's `segments` event crosses processes through Postgres (§5.6) |
| SSE capacity | 300 streams at once, 1 MB of unsent data each at worst | 300 MB of buffers is the ceiling inside 1 GiB; the bus is a `Map` of sets |
| processing queue age (upload → segments) | p95 ≤ 5 min quiet, ≤ 15 min at the peak, never > 1 h for new data | new data goes before the backfill; one pass per device per 5 min (§5.2) |
| processing throughput | ≥ 1 500 points/s end to end (read, pipeline, write) | the pipeline is 7 µs a point (150 ms for 21 000, §17.3); the database is the rest |
| backfill | ≥ 600 device-days an hour from the averaged level, ≥ 2 000 from the inferred level | a fleet-wide averaged backfill (365 000 device-days) is then 25 days: backfills are scoped, never fleet-wide and unannounced |
| event loop | p99 delay ≤ 50 ms over any minute, ≤ 200 ms ever | above it, SSE pings slip and uploads queue behind track simplification |

### 3.3 Memory, CPU, Postgres, disk, backups, start-up

| | Target | Why |
|---|---|---|
| `app` RSS | ≤ 700 MB at the peak, heap ≤ 450 MB | 150 streams × ≤ 1 MB, bodies ≤ 5 MB × a few in flight, pool of 10 |
| `worker` RSS | ≤ 850 MB, heap ≤ 640 MB | one map piece of ≤ 250 MB at a time |
| `db` | 3 GiB, `shared_buffers` 768 MB, ≤ 50 connections | §4.6 |
| CPU | `app` ≤ 30 % of its core at the peak, `worker` ≤ 70 % averaged over an hour, `db` ≤ 1 core sustained | 3× headroom on the API, room for a backfill on the worker, one core left for the checks and the media containers |
| Postgres | cache hit ≥ 98 %; checkpoints timed, never requested; dead tuples ≤ 20 % on `devices` and `heat_cells`; HOT share of their updates ≥ 90 %; no statement over 5 s outside backfills and exports; lock waits on a device row ≤ 1 s | §4.4, §4.6 |
| WAL | ≤ 15 GB a day with `wal_compression = zstd` | §4.3 |
| disk growth | ≤ 1.2 GB a day (scenario B) on the database volume, 2 GB (A) | §4.1 |
| retention | raw points: 12 months live, then archived, not deleted (§4.5); logs: `ingest_log` 14 days, access log 90 days | |
| backup | daily increment ≤ 10 GB and ≤ 20 min; weekly full ≤ 3 h; restore of a month rehearsed quarterly | §4.7 |
| start-up | migrations no-op and listening ≤ 20 s; `fillHeatLevels` ≤ 60 s for 1 000 devices (one query each); a migration touching more than a million rows is two-phase and never runs on boot (§4.2) | |
| deploy downtime | ≤ 30 s; streams reconnect within 5 s and resync once | |

## 4. Storage and database plan

### 4.1 Growth per month at 1 000 devices

Row sizes are estimates from the columns (§5 of the architecture, tuple header
and alignment included) plus the index entries; milestone 0 measures them
(`pg_total_relation_size / count(*)` on production: 1.27 M points, so the
locations figure is known within a day).

| Table | Rows/month (A) | Bytes/row (heap + indexes) | GB/month (A) | GB/month (B) | Notes |
|---|---|---|---|---|---|
| `locations` | 94.8 M | ~430 (Overland with tracking stats ~450, OwnTracks ~380, Traccar ~300; PK entry 52 at 65 % fill) | **40.8** | 22 | append-only; the BRIN on `received_at` is negligible |
| `processed_points` | 94.8 M | ~225 (`path_map` empty for 1 Hz points) | **21.3** | 11.6 | written once per point, rewritten by every pass over its window (§5.2) |
| `heat_cells` | 10 M in month 1 (10 000 a device: 36 000 for a driver on 1 Hz — production's 28 035 at level 20 and 6 350 at 18 — 3 000 for a commuter), +25 % a month after | ~120 | 1.2, then 0.3 | 1.0, then 0.25 | updated in place: fillfactor and vacuum (§4.4) |
| `segments` | 600 000 (20 a device a day) | ~700 (`features` ~300) | 0.4 | 0.4 | |
| `visits`, `trips`, `device_events` | 480 000 | ~250 | 0.12 | 0.12 | |
| `ingest_log` | 14.5 M (483 000 a day) | ~190 | 2.75 a month → **8.3 GB at 90 days**, 1.3 GB at 14 days | same | the one-point apps make a row per point: the log is a fifth of the points' size (§5.3) |
| `data_access_events` | 2.1 M (70 rows a person a day: 30 an hour of browsing, live positions per recipient, device and hour) | ~300 (fillfactor 70) | 0.63 a month → 7.7 GB at 365 days, 1.9 GB at 90 | same | |
| `ingest_rejects`, `processing_queue`, `daily_stats`, the rest | | | < 0.05 | | |
| OSM cache (`osm_ways` etc.) | by area, not devices: Belgium is 13 000 z14 tiles, ~1 GB | | once | | replaced by the extract stream's own files (~0.5 GB for Belgium) |
| **Total** | | | **≈ 63 GB a month, 750 GB a year** | **≈ 35 GB a month, 420 GB a year** | plus ~10 GB of steady-state logs |

So 181 GB free is 2.6 months of A or 5 months of B, before backups. **A disk
is the first purchase**: a 2 TB SSD (USB 3.2 or Thunderbolt enclosure, about
€ 100–150) holding the Docker data root or just the `trail-db` volume, and the
backups on another device (the NAS that `BACKUP_DIR` already syncs to, or a
second external disk). With 12 months of raw points live and the older ones
archived (§4.5), the live database stops growing at about 450 GB (B) or
770 GB (A), and the archive adds 12 (B) or 23 (A) GB a year: a 2 TB disk holds
either for the foreseeable future; the free 181 GB holds neither.

Writes wear the SSD at about 1.5 kB a point (heap, index, WAL): 4.7 GB a day
in A, 1.7 TB a year — 0.15 % of a 2 TB consumer drive's rated endurance. Wear
is no concern; throughput and fsync latency are (§8).

### 4.2 Partitioning (migration)

`locations` and `processed_points` become partitioned tables, **range by
month on `recorded_at`**, each month a partition. Not by device hash: the
retention, the archive and the backups all work in time, and a device's rows
in a monthly partition are still one contiguous range of the primary key.

Why partition at all, at this size: `DROP`/`DETACH` of a month in
milliseconds instead of deleting 95 M rows (§4.5); autovacuum over the active
month only (the insert-triggered vacuum that sets the visibility map runs on
40 GB a month instead of a growing 750 GB); `CLUSTER` of a closed month on its
primary key, which gives History its locality back (§5.4); and backups that
treat closed months as the immutable files they are (§4.7). The insert path
does not need it: a thousand devices insert at a thousand rightmost leaves, a
hot set of 8 MB in any size of index.

- **Drizzle.** drizzle-kit does not generate partitioned tables, so the
  migration is written by hand at the end of a generated file (a statement
  written there is kept when the migration is generated again, §2 of the
  architecture): `CREATE TABLE locations_new (LIKE locations INCLUDING ALL)
  PARTITION BY RANGE (recorded_at)`, the partitions, `INSERT … SELECT` in
  one transaction for a preview's empty database — and **never on boot for a
  database of a billion rows**. Production migrates in two phases: the
  migration creates the partitioned table and a view-free swap of names in a
  maintenance window of under a second; the rows move by a job in slices of
  one day, oldest first, under the same advisory lock the server uses,
  resumable, and the old table is dropped when it is empty. The schema files
  (`locations.ts`, `processedPoints.ts`) keep the same columns and indexes:
  the ORM reads the partitioned parent as the table, and an index declared
  on it is created on every partition. `migrationUpgrade.test.ts` requires
  every row unchanged after the move — it already does, for a small
  database; a second case plays the two-phase move on 10 000 rows.
- **The foreign key** `processed_points → locations` goes: a partition of a
  referenced table cannot be detached while rows still reference it, so the
  derived month would have to go first every time and the detach would scan
  for references; without the key the two tables partition and archive
  independently. The two delete paths (`POST /api/locations/delete`,
  deleting a device) already run in one transaction and delete the derived
  rows there. An orphan check joins the
  nightly prune (a count, logged) and a test.
- **Partitions.** The hourly job keeps partitions three months ahead
  (`CREATE TABLE IF NOT EXISTS locations_2027_01 PARTITION OF locations FOR
  VALUES FROM ('2027-01-01') TO ('2027-02-01')`), plus one partition for
  everything before the first month (phones with a reset clock send 1990, and
  the planned history import sends years) and a default partition that must
  stay empty (a warning in the log when it does not). No `pg_partman`: the
  Alpine image does not ship it, and the job is thirty lines.
- **Keys.** The primary key stays `(device_id, recorded_at)`; the partition
  key is part of it, as Postgres requires. `ingest_log` and
  `data_access_events` are not partitioned: their retention deletes
  500 000 and 70 000 rows a day in hourly slices, which is fine.

### 4.3 Indexes and write amplification on the hot path

Per point, today: the `locations` heap row (~380 bytes), its primary-key
entry (52), the BRIN summary (nothing), six `heat_cells` upserts for the
batch's distinct cells — a 1 Hz drive touches ~35 cells at level 20 a minute,
one at level 15, so ~45 cell rows per upload, a still phone 6 —, one
`devices` update per upload, one `ingest_log` row and its index entry, and
after processing a `processed_points` row (~170) with its key (52). WAL
carries all of it, plus the first write of every page after a checkpoint as a
full page: a thousand devices' twenty hot pages each (their PK leaves, heap
pages, cell rows, the device row, the log) are 20 000 full-page writes per
checkpoint — 1.9 M a day at a 15-minute checkpoint, 15 GB uncompressed. Hence
`wal_compression = zstd` and `checkpoint_timeout = 30min` (§4.6), and the
WAL target of ≤ 15 GB a day.

| Index | Verdict |
|---|---|
| `locations_pkey (device_id, recorded_at)` | stays; it is the History range, the dedupe and the partition's clustering key. Add `INCLUDE (lat, lon, speed, horizontal_accuracy, altitude)` **only if** the browser cache does not take the repeat reads away (§5.4): it makes a History day an index-only scan of 20 pages instead of 3 000 heap pages, for +40 bytes a point (+10 % of the table) |
| `locations_received_at_brin` | stays (activity chart, export by arrival); BRIN is 1 page per 128 — the right kind for an append-only column |
| `processed_points_pkey` | stays |
| `heat_cells_pkey (device_id, z, x, y)` | stays; the upsert's probe. The table is update-heavy: `fillfactor = 85` so the `count` update stays a heap-only tuple (no indexed column changes) |
| `ingest_log (device_id, received_at DESC)` | stays, but the table shrinks (§5.3) |
| `segments` unique `(device_id, started_at)` + `(device_id, ended_at)` | stay |
| a second index on `locations` for the activity chart | **no** — the chart reads an hourly rollup instead (§5.3) |
| BRIN on `locations (recorded_at)` | **no**: inserts arrive in time order per device but interleaved across devices and with backlogs; the PK already covers the range per device, and BRIN on a partitioned-by-month table buys nothing |

### 4.4 Autovacuum and fillfactor (migration where a table changes, config otherwise)

| Table | Pattern | Setting |
|---|---|---|
| `devices` | 1 000 rows, **483 000 updates a day** (`last_seen_at`, cache, `points_total`): the hottest table by far | `fillfactor = 50` (migration), `autovacuum_vacuum_scale_factor = 0`, `autovacuum_vacuum_threshold = 500`, `autovacuum_vacuum_cost_delay = 0` (per-table storage parameters, migration); HOT updates keep it at one page per ~10 devices |
| `heat_cells` | upserts, ~45 rows per batch upload, 6 per single point: ~5 M updates a day | `fillfactor = 85`, scale factor 0.05 |
| `processed_points` | upserted per pass | `fillfactor = 90`; its partitions get the insert-triggered vacuum like `locations` |
| `locations` | append-only | `autovacuum_vacuum_insert_scale_factor = 0.02` on the active partitions, so the visibility map is set soon after the pages fill (index-only scans and the counts of §5.3 need it); closed months are vacuumed (`VACUUM (FREEZE)`) and clustered once by the job |
| `data_access_events` | already `fillfactor = 70` | keep |
| `ingest_log` | insert + hourly deletes | default; an hourly `DELETE` of 20 000 rows is nothing |
| global | | `autovacuum_naptime = 30s`, `autovacuum_max_workers = 3`, `autovacuum_vacuum_cost_limit = 1000` |

### 4.5 Retention, archive and export (policy; migration for the job)

The house rule stands: recorded data is never changed, and Trail never deletes
it on its own. What changes is *where* it lives.

- **Logs are not recorded data.** `ingest_log` keeps 14 days of rows
  (`INGEST_LOG_RETENTION_DAYS`, new, default 14; today 90 is hard-coded) and
  the activity chart reads the hourly rollup (§5.3), which is kept for a year
  (1 000 devices × 24 × 365 × 60 bytes = 0.5 GB). `DATA_ACCESS_RETENTION_DAYS`
  defaults to 90 for a new install of this size; the owner of a one-person
  server keeps 365.
- **Raw points live for 12 months, then move to the archive.** The monthly
  job (the partition job's other half) takes the partition of the month that
  turned 12 months old, streams it with `COPY (SELECT …) TO STDOUT`
  (`pg-copy-streams`, MIT) through Node's `zlib.createZstdCompress` into
  `ARCHIVE_DIR/locations/2026-01.csv.zst` — a bind mount of the worker, like
  `BACKUP_DIR` (timestamps a second apart and the coordinates of a still phone
  compress to about 20 bytes a point: 1.9 GB for a month of A, 20× smaller
  than the live rows) —, verifies the row count by reading the file back,
  stores the file's SHA-256 and count in a new `archived_partitions` table,
  and only then detaches and drops the partition. `processed_points` of the
  same month are dropped without an archive: they are derived. A History
  view of an archived month answers `404` with a message that says the month
  is archived; `trail restore-month 2026-01` attaches it again from the file
  (a few minutes). The heat cells, daily statistics, segments and Insights of
  archived months stay: they are small and they are what people look at a year
  later.
- **Per account.** `ARCHIVE_AFTER_MONTHS` is server-wide (0 = never; the
  default on a one-person server). An administrator may keep an account's
  months live longer (`users.keep_months`): the job then skips its rows by
  moving them to the next partition before dropping — rare, and an
  explicit choice. Deleting an account deletes its archived rows too: the
  files are per month, so the job rewrites the file without the account
  (count and hash updated).
- **Export** stays as it is for live months and reads the archive files for
  archived ones, streaming — slower, but complete. A person who leaves gets
  the whole history.

What this does *not* do: down-sample. A 1 Hz phone's year stays a year of
1 Hz points, in a file. Down-sampling was considered (a point every 5 s or
10 m beyond 12 months would cut A's archive to a tenth) and refused: it would
change recorded data, the archive is cheap enough, and the preset — not the
server — is where the density is chosen (§2.3).

### 4.6 Postgres configuration for a 3 GiB container (config: `command:` in `deploy/compose.yaml`)

```
shared_buffers = 768MB            # a quarter of the container; the hot set (leaves, cells, devices, the current month's tail) is far smaller
effective_cache_size = 2GB        # what the VM's page cache can hold for us beside the others
work_mem = 16MB                   # hash aggregates of the heatmap, 20 000-row sorts; 50 connections × a few × 16 MB stays inside 3 GiB
maintenance_work_mem = 256MB      # CLUSTER and index builds of a closed month, the partition move
max_connections = 50              # app 10, worker 5, backup 2, operator 3; each backend is 5–10 MB
wal_compression = zstd            # full-page writes are the WAL (§4.3)
wal_buffers = 32MB
checkpoint_timeout = 30min
checkpoint_completion_target = 0.9
max_wal_size = 4GB                # 30 minutes at 10 GB/day is 200 MB; 4 GB keeps a backlog flush from forcing a checkpoint
min_wal_size = 1GB
synchronous_commit = on           # an acknowledged upload is on disk; the phone has deleted it
random_page_cost = 1.1            # SSD
effective_io_concurrency = 100
io_method = worker                # Postgres 18's asynchronous reads and its default; io_uring needs syscalls that Docker's default seccomp profile denies
jit = off                         # short OLTP statements; JIT only adds latency to the heatmap's aggregate
max_parallel_workers_per_gather = 2
shared_preload_libraries = pg_stat_statements   # in the Alpine image's contrib
pg_stat_statements.track = top
track_io_timing = on
log_min_duration_statement = 1000
idle_in_transaction_session_timeout = 60000     # the client sets it too
```

The `shm_size` of the container goes to 512 MB (parallel workers, the
`CLUSTER` of a month). Data checksums are on: Postgres 18's `initdb` enables
them by default, and `POSTGRES_INITDB_ARGS` keeps them (an existing cluster
has whatever it was created with; `pg_checksums` can enable them offline).

**Connections.** The API keeps its pool of 10 (`createPool`): at 10 requests
a second of 25 ms a quarter of a connection is busy on average; ten absorb a
burst of a few hundred a second.
The worker gets a pool of 5 of its own (one window at a time, the fetcher, the
queue reads, the statistics). PgBouncer is not needed: two long-lived
processes with persistent pools, no connection churn; it would be needed only
for many short-lived processes, which Trail has none of. The worker's
transaction sets `SET LOCAL synchronous_commit = off`: its rows are derived
and rebuildable, and the fsync per pass was a tenth of its time.

### 4.7 Backups at this size

`pg_dump -Fc` of 450 GB takes 2–4 hours at the 40–60 MB/s that gzip or zstd
on one core delivers, yields 120–180 GB a day, and 14 dailies are 2 TB: the
present `backup` sidecar does not survive the first year. Two changes:

1. **Incremental base backups** (Postgres 17+): `summarize_wal = on` on the
   server, a replication role for the sidecar, a weekly `pg_basebackup
   --format=tar --compress=client-zstd:5` (450 GB → ~180 GB in about 3 h at
   the SSD's pace) and a daily `pg_basebackup --incremental` against the last
   manifest (the day's changed blocks: 1.2–2 GB of new rows plus the hot
   pages — ~3–5 GB, 10–20 minutes). `pg_combinebackup` builds a full one for
   a restore; `pg_verifybackup` checks every file. Retention: two weekly
   chains (14 days), a monthly full for 12 months, a yearly for ever — the
   current policy's shape, with the same variables. The sidecar is still a
   POSIX `sh` loop from a Compose config; a restore drill is written into
   `docs/operations.md` and rehearsed on the Mac from a real backup every
   quarter.
2. **Archives are backups too.** A month's archive file (§4.5) is written
   once, verified, copied to the backup location by the same job and never
   touched again; a weekly `sha256sum --check` over them is cheap.

The tables that change by hand (users, devices, shares, tokens, the grid key)
keep a daily `pg_dump --exclude-table-data` of the large tables as a
human-readable safety net: a few MB, seconds.

## 5. Hot path review

### 5.1 One upload, as it runs today (§6.2)

| Step | Where | Cost, single point | Cost, 60 points | Cost, 500 points |
|---|---|---|---|---|
| token shape check, SHA-256, `devices` lookup by `token_hash` | Node + 1 round trip | 0.3 ms | 0.3 ms | 0.3 ms |
| failed-token and per-device limiters (in memory) | Node | 10 µs | 10 µs | 10 µs |
| body read and parse (`express.json` 5 MB / `express.raw`), `withoutSecrets`, normalisation | Node | 0.1 ms | 0.5 ms (36 kB of JSON) | 4 ms (300 kB) |
| `BEGIN`, device row `FOR UPDATE` | 2 round trips | 0.6 ms | 0.6 ms | 0.6 ms |
| `INSERT … ON CONFLICT DO NOTHING RETURNING` + the heat-cell CTE at six levels | 1 statement | 1.5 ms (1 row, 6 cell probes) | 8 ms | 40–60 ms |
| visits, trips, events, rejects | up to 4 statements, skipped when empty | 0 | 0–1 ms | 0–1 ms |
| device update | 1 statement | 0.4 ms | 0.4 ms | 0.4 ms |
| `ingest_log` insert | 1 statement | 0.3 ms | 0.3 ms | 0.3 ms |
| `COMMIT` (fsync) | 1 round trip + disk | **3–15 ms** on this SSD through WSL 2 | same | same |
| response, log line | Node | 0.1 ms | 0.1 ms | 0.1 ms |
| after the response: `ingest` SSE event, `publishDeviceLater` (a summary query when a stream is open), `publishPeopleLater`, daily-stats scheduling, `enqueueWindow` (1 statement), the recovery alert | Node + 1–2 statements | 0.5 ms + 1 query | 0.5 ms + 1 query | 1 ms (500 points serialised for SSE) + 1 query |
| **Total, server side** | | **≈ 8–20 ms** | **≈ 15–30 ms** | **≈ 60–90 ms** |

Node's share is 0.5 ms for a single point and 1.5–6 ms for a batch; at the
peak's 9.4 requests a second that is 1–2 % of the core. Postgres' share is
the fsync and, for batches, the six-level cell upsert. So the ingest capacity
of one API process is a few hundred single-point uploads a second (pool of
10, ~10 ms each, fsyncs grouped by Postgres) and about 7 000 points a second
in batches of 500 — 30× the peak and enough to drain the morning backlog in
minutes.
Nothing on the request path needs batching across requests: per-request
latency is what the phones see, and it is low. What needs to move is the
work *after* the response.

### 5.2 What ingest hands to the worker (the processing stream's contract)

Today, after an upload, `afterIngest` queues the new points' span ± 30 min
and the worker takes it within 3 s, grows it to whole segments (two days at
most on each side), re-averages, re-maps and re-infers every point in it and
**upserts every `processed_points` row of the window** (`persistWindow`).
For a phone that records while still, that is the problem:

| Phone | Uploads/day | Points per window | Rows rewritten a day | Share of the fleet |
|---|---|---|---|---|
| high-resolution, 1 Hz, every minute | 1 440 | 3 660 (61 min) at least; the whole night or working day's stop once the window meets it: up to 36 000 | 5.3 M – 52 M | 50 phones: 0.26–2.6 G rows a day, **3 000–30 000 rows a second** |
| GPSLogger, every minute | 1 440 | 61, growing to a 480-point night | 90 000–700 000 | 100 phones: 9–70 M a day |
| OwnTracks iOS move, every minute while still | 2 450 | 61 + the stop | similar | 50 phones |
| balanced-plus, every 5 min while moving | 22 | 300 + 3 600 (±30 min at 1 Hz) | 86 000 (13×) | fine |
| balanced, Traccar, Android | 22–300 | tens | ≤ 10 000 | fine |

The worker as written would spend its day rewriting the 1 Hz phones' nights
and never reach the queue's end. The worker stream must deliver, and the
harness checks:

1. **One pass per device per 5 minutes** for `ingest` windows (the queue row
   widens meanwhile, as it does today), so a 1-minute uploader costs 288
   passes a day, not 1 440. Work from the `processing_queue` table as now; the
   API wakes the worker through Postgres (`NOTIFY processing`, payload the
   device id), and the worker polls every minute as a safety net.
2. **Rows written = rows changed.** A pass writes the rows whose averaged or
   mapped values, `kept` or `version` differ from what is stored (the window's
   stored rows are read anyway for the inferred-level path; comparing them is
   microseconds a row), and the segments that changed. A still phone's night
   then costs its ~60 new rows and the few at the moving edges, not 36 000.
   Amplification target: **≤ 4 `processed_points` writes per point over its
   life** (the harness counts `n_tup_ins + n_tup_upd` against the points).
3. **Bounded growth for ingest windows.** A stop that began more than two
   hours before an `ingest` window is not re-run from its start: the window
   keeps the stop's identity and extends its end (its centroid, spread and
   last point are prefix sums already, §17.3). The two-day reach stays for
   `backfill`, `reprocess`, `delete` and `override` windows, where
   correctness over whole days is the point.
4. **The daily statistics move to the worker** and become incremental
   (§5.3): the API records the touched `(device, day)` pairs in the queue row
   (`days text[]`), nothing else.
5. **`SET LOCAL synchronous_commit = off`** in the worker's transaction,
   `work_mem` 64 MB for its session.
6. **Map data from the extract** loads a Belgian commute's tiles in ≤ 200 ms
   and ≤ 100 MB (the map-data stream's own target); the Overpass fetcher's
   daily budget and the 2-second pacing disappear from the critical path.
7. **Throughput** ≥ 1 500 points/s end to end, backfill ≥ 600 device-days an
   hour (§3.2), measured by `tools/load/backfill.mjs` on a month of synthetic
   history.
8. **Cross-process events.** The worker's `segments` event reaches the API's
   SSE streams through `NOTIFY trail_events` (payload ≤ 8 000 bytes: a
   `segments` event is 150 bytes). This is the same mechanism that N API
   processes would need (§5.6), built once.

### 5.3 Work after the response that stays in the API

- **Daily statistics** (`recomputeDailyStats`) re-read every point of each
  touched day, 10 s after an upload, in the API: a 1 Hz phone's day is read
  1 440 times, 22 500 rows on average — 32 M rows a day per phone, 1.6 G for
  fifty, 18 000 rows a second through the Node driver and its result parser
  on the event loop (a 45 000-row result is ~150 ms of blocked loop). The
  fix is in the worker (§5.2) and incremental: `daily_stats` keeps the
  distance accumulator's anchor (last counted point, its accuracy, the last
  point seen) per `(device, day)`, and a pass adds the new points to it; a
  rebuild (`trail recompute`, a deleted range) still scans the day. Points
  today's count (`loadDeviceSummaries`, 45 000 index entries for a 1 Hz
  phone, run per upload while a stream is open) comes from the same row.
- **The hourly rollup** `device_hours (device_id, hour, points, uploads)`,
  upserted by the ingest transaction (one more statement, `count = count +
  excluded.count`, HOT like `heat_cells`), is what `findActivity` reads: 168
  rows per device instead of 315 000 for a 1 Hz phone's week, every 5 minutes
  per open tab. `ingest_log` then keeps 14 days of rows for the upload feed
  and the per-upload latency (§3.1). Migration: the table, the statement, the
  chart's query; `ingest_log`'s retention becomes a variable.
- **`publishDeviceLater`** keeps its query (it only runs while a stream is
  open) but reads today's count from `daily_stats` once that is incremental.
- **`publishPeopleLater`** is fine: it checks for open streams before any
  query.
- **The data access recorder** is fine: in memory, batched at 2 s / 500 rows.
  Its folding limits are per process, which is correct for one API process.

### 5.4 Reads: heap locality and the browser cache's contract

A device's day is contiguous in the primary key but **scattered in the heap**:
with a thousand devices inserting at once, a page of 24 rows holds rows of ~24
devices, so a 1 Hz phone's day (45 000 rows) touches up to 45 000 pages —
350 MB of reads for 20 MB of data, 1–4 s cold on this SSD, and the cache
cannot keep 1 000 devices' days warm. Three remedies, in the order to try:

1. **The browser cache with delta sync** (its own stream) must make repeated
   reads rare: a day viewed before costs the server nothing unless an upload
   touched it, today's track grows from `ingest.points` without a refetch
   (the 20-second `trackRefreshDelayMs` refetch goes), and a reconnect resyncs
   through `?since=`, not by reloading the day. Target: **≤ 1 full-day read
   per device per day per person**, the rest deltas of ≤ 5 kB.
2. **`CLUSTER` closed months** on the primary key (the partition job, one
   month at a time, `maintenance_work_mem` 256 MB, 20–40 minutes for 40 GB,
   on a Sunday night): every month but the current one reads at one page per
   24 rows of the same device.
3. **The covering primary key** (`INCLUDE`, §4.3) if the current month's
   reads still miss the target after 1 and 2.

Track simplification (`rdpImportance`, O(n log n)) is 50–80 ms of event-loop
time for a 45 000-point day; the level tracks' JSON of 20 000 points is
~1 MB. Both are per request and bounded by `maxPoints`; the targets of §3.2
hold with one process as long as the browser cache takes the repeats away.

### 5.5 Limits at 1 000 devices (config)

| Limit | Today | At 1 000 devices | Change |
|---|---|---|---|
| `RATE_LIMIT_INGEST_PER_MINUTE` (Overland batches, per device) | 300 | a high-resolution phone sends 1 a minute, a backlog flush up to 5 a second | keep |
| `RATE_LIMIT_INGEST_SINGLE_PER_MINUTE` (per device) | 1 200 | OwnTracks iOS move sends ≤ 30 a minute while driving; a 1 350-point night's backlog at 20 a second is 68 s, and the `503` keeps iOS's messages | keep; it is per device, so a thousand devices do not add up |
| `RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES` (per IP) | 30 | a carrier's NAT puts hundreds of phones on one address; one phone with a rotated token retries at most every 2 min (OwnTracks) | keep; a valid token never counts |
| `RATE_LIMIT_API_PER_MINUTE` (per IP) | 600 | an office or a family NAT with 50 people at 12 requests a minute | key signed-in requests by session (600/min/session) and keep 600/min/IP for the rest (code, small) |
| `RATE_LIMIT_TOKEN_PER_MINUTE` | 600 | | keep |
| SSE streams per user | 10 | | keep |
| body limits (5 MB / 256 kB / 64 kB) | | a 1 000-point batch is 600 kB | keep; compression stays refused (§12), the edge may compress responses but not `/api/events` |
| the per-process memory of `express-rate-limit`'s stores | 1 000 devices + the IPs | ~1 MB | nothing |

### 5.6 One API process, or several

Node's budget at the peak: ingest 1–2 %, SSE fan-out and pings 1 %, dashboard
reads 5 % (with the browser cache), logging 0.1 %, the daily statistics 0 once
they are in the worker: **≤ 10 % of one core**, 20 % without the browser
cache. One process is enough to about 5 000 devices; the criterion to revisit
is event-loop p99 above 50 ms over a minute at the peak, or the core above
60 %. Prefer N containers behind the edge over `cluster`/PM2 if it comes: the
edge already balances, each container keeps its 1 GiB, and a crash is one
container. What must leave process memory then — most of it moves anyway with
the worker:

| State | Today | With N processes |
|---|---|---|
| `EventBus` | a `Map` per process | `LISTEN/NOTIFY trail_events` from every publisher (the worker already, §5.2); `ingest` events carry at most 100 points on the wire between processes (the 8 000-byte payload), each process fans out to its own streams |
| `express-rate-limit` stores | memory | per-process budgets of limit ÷ N (the failed-token and per-IP limits tolerate it) or a Postgres store (`rate-limit-postgresql`, MIT) for the per-device ones |
| `SharingState` (one-minute cache) | memory | keep, invalidated by `NOTIFY` on share changes |
| `DailyStatsScheduler`, `ProcessingService.notify` | memory | gone to the worker |
| `DataAccessRecorder` pending rows | memory | per process is fine (folding limits per process) |
| `fillHeatLevels`, the jobs (§10) | "single instance" | leader election with `pg_try_advisory_lock` at start-up; the worker takes the jobs |
| `publishDeviceLater` | per process | per process is fine |

## 6. Load-test harness (`tools/load/`)

### 6.1 Tool

**k6** (Grafana k6, 1.x, AGPL-3.0, a Go binary and the `grafana/k6` image).
Why over the others: it models an *open* system — `constant-arrival-rate` and
`ramping-arrival-rate` executors send at the rate the phones would, whether or
not the server keeps up, which is the only honest way to find the point where
latency climbs; scenarios, tags and thresholds are code, so pass/fail lives in
the script; it is light enough that the Mac can run 1 000 virtual phones
beside the capped stack; `handleSummary` writes the report, `--out json` the
samples, and `-o experimental-prometheus-rw` exists if a Grafana ever appears.
**autocannon** (8.x, MIT) hammers one URL from Node as fast as it can — a
closed model, no fleets, no thresholds; it is the right tool for a
five-minute micro-benchmark of one endpoint and nothing more. **Artillery**
(2.x, MPL-2.0) has scenarios in YAML but costs several times k6's CPU per
virtual user, which matters when the system under test shares the machine.
**Locust** (2.x, MIT) is Python, and **Gatling** (3.x, Apache-2.0) a JVM;
neither belongs in a Node repository.

k6 does not read Server-Sent Events. A small Node probe does
(`tools/load/sse-probe.mjs`): it opens N streams with `fetch` and parses the
`text/event-stream` body, uploads one marked point a second through a device
of its own and measures the lag from that upload's response to the `ingest`
event's arrival, and from the `segments` event to the upload. The LTS Node,
no dependency.

### 6.2 Scripts

```
tools/load/
├── README.md               how to run, the scenarios, the thresholds, where reports go
├── compose.yaml            the Mac's capped stack: deploy/compose.yaml + cpus/mem_limit as on the node, a k6 service, no edge
├── fleet-setup.mjs         creates the fleet through `trail load-fleet` and writes fleet.json (tokens, sessions, profiles)
├── fleet.js                k6: the phones — three protocols, ten profiles, the daily schedule, seeded
├── dashboard.js            k6: people — opens, History days, Heat, the timeline, Insights, with session cookies
├── backlog.js              k6: the morning after — every device's queued points, as fast as the apps send them
├── sse-probe.mjs           N streams, delivery lag, reconnect and resync
├── backfill.mjs            synthetic history: months of points straight into Postgres (COPY), then recompute and reprocess
├── routes.json             ~300 recorded routes over Belgian roads and rails, generated once from the OSM extract
├── generate-routes.mjs     builds routes.json from the extract (the map-data stream's reader), seeded
├── collect.mjs             samples docker stats, pg_stat_*, the app's load line every 10 s into a CSV
├── report.mjs              k6 summary + collector CSV + thresholds → docs/perf/<date>-<commit>-<scenario>.md
└── lib/                    the protocols' encoders (Overland batch, OwnTracks message, OsmAnd form/query), mulberry32, the day's schedule
```

- **The fleet.** `trail load-fleet --people 1000 --profiles default` (a new
  CLI command) creates people, devices and tokens directly, and sessions for
  the dashboard scenario (rows in `sessions` from secrets it prints; the
  dashboard's requests then carry a real cookie and the CSRF `Origin`). It
  **refuses to run** unless all three hold: `LOAD_TEST=true` in the
  environment, `LAUNCHWAY_ENVIRONMENT` is not `production`, and the database
  holds no passkey (nobody real has ever signed in). Production data and
  load data can never share a database.
- **The phones** (`fleet.js`): each virtual device has a profile from §2.2,
  a home, a workplace and a set of routes from `routes.json`, and plays the
  day's schedule (§2.1) compressed or in real time (`DAY_SECONDS`, 86 400
  for the soak, 3 600 for a daily run with the same peaks). Points are
  sampled along the route at the mode's speed with GPS noise (σ from the
  accuracy), the still phones drift as iOS does, and each app's encoder sends
  exactly what the app sends (the integration tests' samples are the
  reference): Overland's batches with `current`, `trip`, visits and tracking
  stats; OwnTracks' `location` with `t`, `tid`, `conn`; Traccar Client 10's
  form; OsmAnd's and GPSLogger's URLs. Retries follow the apps' rules
  (Overland keeps the batch, OwnTracks iOS drops on 4xx — the script counts
  that as data loss). A mulberry32 seed makes a run reproducible. Routes come
  from the extract once (`generate-routes.mjs`: random pairs of places, a
  shortest path over the way graph the map-data stream already builds, by
  car, bike, foot and rail, written as polylines with per-leg speeds); the
  file is checked in (a few MB) so a run needs no extract.
- **The people** (`dashboard.js`): opens at the rate of §2.4, each a
  session's nine requests, then History days and Heat viewports over the
  fleet's own history, with the browser cache's `?since=` deltas once it
  lands.
- **The backlog** (`backlog.js`): after `fleet.js` ran for a while against a
  stopped `app`, every device sends its queue as its app would — back to back,
  in order, 500 a batch — and the script measures the drain time and the
  share of `429`/`503`.
- **History** (`backfill.mjs`): N months for the fleet from the same
  profiles, written with `COPY` at a million rows in ten seconds, then `trail
  recompute` and a scoped `trail reprocess` — the backfill-throughput
  measurement of §3.2 comes free.

### 6.3 Metrics and thresholds

Three sources, one collector:

- **k6**: per endpoint and batch-size tag, `http_req_duration` percentiles,
  `http_req_failed`, data-loss and retry counters, iteration rates; thresholds
  in the scripts, for example
  `'http_req_duration{endpoint:overland,batch:500}': ['p(95)<250', 'p(99)<500']`,
  `'http_req_failed{endpoint:ingest}': ['rate<0.0001']`,
  `'dropped_points': ['count==0']`. A run exits non-zero when a threshold
  fails.
- **The app's load line**: the API and the worker log `load` once a minute
  at `info` — event-loop p50/p99 (`perf_hooks.monitorEventLoopDelay`), pool
  waiting and idle, open streams, background tasks pending, uploads and
  points in the minute, RSS and heap, and for the worker the queue's age
  (how long the oldest ready new-data row has waited since it was queued, its
  `enqueued_at` — not its `next_at`, which a deliberate delay before the pass
  would hide), passes, points and rows written. The SSE probe measures the
  same age end to end, from an upload to the `segments` event of the window
  that covers it, and the report holds §3.2's queue-age target to that.
  No metrics endpoint and no new threat model: the line is for `docker logs`,
  and the collector parses it. (A `/metrics` for Prometheus — `prom-client`,
  Apache-2.0 — is a later step if a Grafana appears; the line's fields are
  its future gauges.)
- **Postgres and Docker** (`collect.mjs`, every 10 s): `pg_stat_database`
  (hits, reads, commits, temp bytes, deadlocks), `pg_stat_user_tables`
  (`n_tup_ins/upd/hot_upd`, dead tuples, last autovacuum) for the hot
  tables, `pg_stat_wal`, `pg_stat_checkpointer`, `pg_stat_activity` waits,
  the top 20 of `pg_stat_statements` by total time at the end, table and
  index sizes before and after; `docker stats --no-stream --format json` for
  CPU, memory and block I/O per container.

`report.mjs` turns the three into one markdown file per run under
`docs/perf/` (`2026-11-20-abc1234-fleet-1000.md`): the scenario and seed, the
commit, the machine, a table of every target of §3 with the measured value
and pass/fail, the k6 percentiles per endpoint, the load lines' peaks, the
Postgres deltas (rows, WAL bytes, HOT share, checkpoints), sizes, and the
collector's CSV next to it. `docs/perf/README.md` indexes the runs. A run that
fails a threshold is still reported — that is the point.

### 6.4 Where it runs

- **Daily, on the Mac**: `tools/load/compose.yaml` runs the production stack
  (the GHCR image of the branch or a local build) with the node's caps —
  `app` 1 CPU / 1 GiB, `worker` 1 / 1 GiB, `db` 2 / 3 GiB — and k6 in a
  container of its own on the same network, no edge (the edge's own cost is
  measured once on the node). `npm run load -- fleet-1000` runs setup, the
  fleet for one compressed day, the backlog, the dashboard scenario and the
  probe, collects and reports, about 90 minutes; `load -- soak` is the
  24-hour real-time run before a milestone. Docker Desktop on the Mac honours
  `cpus` and `mem_limit`, and the M2 Pro's cores are 1.5–2× the node's:
  §6.5 fixes the factor.
- **Occasionally, on the node**: a Launchway preview deployment is a staging
  stack by construction — its own project, volume and host name, no backup,
  no production variables (§13.3). The procedure: open the pull request that
  carries the change (or a `load/` branch with none), set `LOAD_TEST=true`
  and the capped resources in the preview's variables, wait for the preview,
  `docker exec launchway-trail-pr-<n>-app-1 trail load-fleet …`, then run k6
  **from the Mac against the preview's host name** — through the edge, with
  TLS, 22 kB/s of uplink — while `watch.mjs` polls production's
  `/api/health` every 5 s and aborts the run (stops k6, then the preview's
  `app` container) if production's p95 goes over 1 s or any check fails. Rules: never
  against `trail.jenspenneman.com`; not between 02:30 and 04:00 (the backup);
  not while a check runs, except the one run that measures that interference
  on purpose; the preview is removed with the pull request, and the fleet's
  data with it; the node's phones are real and keep uploading to production
  throughout — their `ingest_log.duration_ms` is the production-side
  measurement of the run.
- **Not in the checks.** The node's checks take 25 minutes and 6 CPUs at
  3 GiB; a load check beside them would measure the other checks. A load run
  is manual, or scheduled on the Mac on Sunday nights (`launchd`, when the Mac
  is awake); it is a Launchway "Run checks" only if Launchway grows a
  manual-check kind.

### 6.5 Calibration

The same `fleet-100` run on the Mac and on a preview of the node, twice,
gives the factor per metric (latency, CPU, WAL): expect 1.5–2.0 on CPU-bound
numbers and 1–3 on fsync-bound ones (WSL 2's disk path). The factors go into
`docs/perf/README.md`, and the Mac's thresholds are the node's targets
divided by them. Re-calibrate after a Docker Desktop or Windows change.

## 7. Rollout and milestones

Measurable steps; each ends with a report in `docs/perf/`. At most two Trail
development containers run on the Mac at once, so the builders' tasks pair
up as shown. Builders get a task's section of this document, the files
named, and the acceptance criteria as written.

| Milestone | Devices | What it shows | Done when |
|---|---|---|---|
| **M0 — measure** | production, 1 | row sizes, the upload latency histogram from `ingest_log`, `pg_stat_statements` on, the WAL rate, today's `persistWindow` amplification on the 1 Hz phone | the numbers of §4.1 and §5.2 replaced by measured ones in this document |
| **M1 — harness** | 10 | the scripts run end to end on the Mac, all protocols, a report lands | `npm run load -- fleet-10` green with the targets of §3 |
| **M2 — a hundred** | 100, one day compressed, then a 24 h soak | the worker's new contract (§5.2), the statistics and rollup (§5.3), the Postgres settings (§4.4, §4.6) | amplification ≤ 4, queue age p95 ≤ 5 min, WAL/day on track, event loop p99 ≤ 50 ms |
| **M3 — a thousand on the Mac** | 1 000 + 3 months of history | partitioning (§4.2), the backlog flush, 150 streams, the dashboard at the peak with the worker backfilling a month | every target of §3 at the Mac's calibrated thresholds; the disk growth of §4.1 |
| **M4 — a thousand on the node** | 1 000, preview, 24 h | the node itself, through the edge, beside production and one check | §3 on the node; production's own uploads unharmed (`duration_ms` p95 unchanged) |
| **M5 — ready** | production | the disk, the incremental backups and a restore drill, the two-phase partition move rehearsed on a copy of production, the archive job on a synthetic old month, `ARCHIVE_AFTER_MONTHS` and the retention variables set, `docs/operations.md` updated | a release note that says 1 000 |

Order of the fixes, from §5 — each a pull request with its migration, tests
and documentation:

1. the worker's contract (coalescing, changed-rows-only writes, bounded
   growth, `synchronous_commit` off, `NOTIFY`) — the processing stream;
2. incremental daily statistics in the worker and the hourly rollup
   (`device_hours`), the activity chart on it, `ingest_log` to 14 days;
3. storage parameters: `devices` and `heat_cells` fillfactor and vacuum,
   the Postgres `command:` of §4.6, the container at 3 GiB;
4. the load harness (`tools/load/`, `trail load-fleet`, the load line, the
   report) — in parallel with 1–3, on fixtures until they land;
5. partitioning of `locations` and `processed_points`, the partition job,
   the foreign key's removal, the two-phase move;
6. the archive job, `archived_partitions`, `trail restore-month`, export over
   archives, `ARCHIVE_AFTER_MONTHS`;
7. incremental backups in the sidecar, the restore drill in the runbook;
8. the per-session API limit; History's locality (cluster closed months,
   then the covering key only if needed) — after the browser cache lands.

| Task | Builder | Needs | Acceptance |
|---|---|---|---|
| T1 harness: `tools/load/` scripts, `trail load-fleet`, the load line, `collect.mjs`, `report.mjs`, `docs/perf/README.md` | A | nothing; fixtures for routes until T6 | `fleet-10` and `fleet-100` run on the Mac, thresholds encoded, a report committed; `load-fleet` refused without its three conditions (tests); no token or coordinate in any log line |
| T2 worker contract | B (the processing stream) | §5.2 | `processing.test.ts` extended: one pass per device per 5 min, changed rows only, a 1 Hz night stop extended not re-run; amplification ≤ 4 counted in a test over a synthetic week; `segments` events across processes |
| T3 statistics and rollup | A, after T1 | T2's queue contract | `daily_stats` incremental with the anchor columns, equal to a rebuild to the metre on the journeys; `device_hours` maintained by the ingest statement, the activity chart equal to today's for the fixture; `ingest_log` retention a variable |
| T4 storage parameters | B, after T2 | — | a migration with the per-table parameters; `deploy/compose.yaml` with the `command:`; `docs/operations.md`; the M2 soak shows HOT ≥ 90 % on `devices` and `heat_cells` |
| T5 partitioning | A, after T3 | T2 (no foreign key) | migration-upgrade test green, the two-phase move on 10 000 rows in a test, the partition job tested across a year boundary and with a 1990 timestamp, an empty default partition asserted |
| T6 routes from the extract, the backlog and dashboard scenarios, calibration | B, after T4 | the map-data stream's reader | `routes.json` reproducible from a seed; the `fleet-1000` run on the Mac and the preview run on the node, both reported |
| T7 archive and restore | A, after T5 | — | a month archived, verified, dropped and restored in a test; export over an archived month byte-equal to export before it; account deletion rewrites the file |
| T8 incremental backups | B, after T6 | — | the sidecar takes a full and an incremental on the Mac stack, `pg_verifybackup` passes, a restore drill script in the runbook, retention tested with faked dates |
| T9 per-session limit, cluster job, History locality | either, last | the browser-cache stream | History day p95 within target on M3's data with the cache; the covering key only with a measured need |

## 8. Risks and open questions

| Risk | What it does | Recommendation |
|---|---|---|
| **The disk** | 181 GB free is 3–5 months; the database volume grows 1.2–2 GB a day | a 2 TB SSD before M5; backups on another device; scenario B's presets as the default; `ARCHIVE_AFTER_MONTHS=12` |
| **Thermal throttling** | the i7-9750H holds its all-core clocks for a minute, then settles 30 % lower; the morning backlog, a check and a backfill coincide at 08:00 | laptop on a stand with air; the check queue is what it is; the targets of §3 are set at the throttled clocks (M4 measures them so) |
| **WSL 2 disk path** | fsync 3–15 ms through the VHDX on NTFS; Docker Desktop's volumes live there | the SSD helps; `synchronous_commit` stays on for ingest; the worker's commits are asynchronous; measure the fsync in M0 (`pg_test_fsync` in the `db` container) |
| **Windows sleep and updates** | a sleeping node is the eight-hour backlog of §2.3; an update reboots at night | power settings never sleep on mains, active hours set, the morning flush is a tested scenario (`backlog.js`) and drains in minutes |
| **VM memory** | 8.25 GB over-committed with a check beside Trail | `.wslconfig` `memory=11GB`, the checks at 2.5 GiB; swap inside the VM only as the last resort |
| **GPSLogger drops points** after three failed tries | an outage longer than its retries loses data at the phone, not in Trail | the deploy stays under 30 s; `docs/trackers.md` says that GPSLogger is the one app that can lose points when the server is away for long, and suggests OwnTracks or Traccar Client for people who care |
| **OwnTracks iOS drops on 4xx** | a bug that answers 4xx to a valid upload loses data | the ingest tests already cover every 4xx; the harness counts drops as loss; the error budget is zero |
| **The edge** | Launchway's edge sits in front: its request body limit, idle timeout and buffering decide whether a 600 kB batch, a 100 s silent SSE stream and the `/api/events` route without compression work at 1 000 devices | verify in M4 (a 5 MB upload, a 20-minute stream); document the edge's settings in the runbook |
| **Carrier NAT** | hundreds of phones behind one address: the per-IP limits must never touch valid tokens | they do not (consulted after the lookup); keep it that way in reviews |
| **One node, no replica** | an outage loses nothing (phones queue) but the dashboard; a disk failure loses the data since the last backup | incremental backups daily, the archive files on another device, a restore drill a quarter; a replica is out of scope for one node |
| **Backfills at fleet scale** | a processing version bump queues 365 000 device-days: 25 days of worker time | version bumps ship with a scope (`--from-level inferred` at 2 000 device-days an hour: 7 days) and an announcement in the release notes; new data goes first regardless |
| **Measured, not modelled** | the row sizes, the fsync, the per-upload fixed cost and the extract's map loading are estimates | M0 and M2 replace them; every table above names its basis |

Open questions for the owner:

1. The disk: a 2 TB external SSD for the Docker data root (everything, simple)
   or only the `trail-db` volume (a bind-mounted directory, Launchway's
   trusted-app bind mounts allow it)?
2. Presets: is high-resolution an administrator's grant (scenario B), or do
   people choose freely (A, twice the disk)? Should the high-resolution
   preset keep `pause_automatically` on with a 100 m geofence, which cuts a
   phone on a desk from 45 000 to about 8 000 points a day and changes
   nothing a person would see on the map?
3. Retention: 12 months live, then archived files — agreed as the server-wide
   default, with 0 (never) for a one-person server?
4. Launchway: can a second service (`worker`) take `cpus`/`mem_limit` of its
   own, and can a preview be given the capped resources through its
   variables? Is there room for a manual, scheduled check kind?
5. The budget for accounts: with 1 000 people, who invites, and does Trail
   need a per-account device cap (today: unlimited devices per person)?
