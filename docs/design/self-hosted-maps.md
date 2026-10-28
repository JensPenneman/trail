# Design: self-hosted map data and basemap

Status: proposal, October 2026. Task 0 (§8.5) is done: the first version of
`scripts/mapdata/build.sh` and of the workflow that runs it
(`.github/workflows/mapdata.yml`) exist, the Monaco fixture is committed, and
the sizes and times in this document are the measured ones of §10 (the few
still extrapolated say so). Nothing else is built yet; the sections of
`docs/architecture.md` it names (§4, §5, §12, §13, §14, §17) change with the
pull requests that build it, not with this document.

Trail reads two things from other people's servers today: the roads and
railways its map matching snaps points to (OpenStreetMap through the public
Overpass instance, §17.3) and the basemap the dashboard draws under its
tracks (OpenFreeMap's styles, tiles, fonts and sprites, §14). This design
brings both home: a local copy of the OpenStreetMap ways of the regions the
server's people live in, and a basemap built from the same extracts, served
by Trail itself. Overpass and OpenFreeMap stay available as fallbacks behind
flags and end up off by default.

Related work, assumed rather than designed here: a worker container that
runs processing apart from the API and owns every map-data job (the
processing-service design), browser-side caching of the map (its own
design), and a load test that validates the numbers of §6 at 1000 devices.

## 0. Decisions in short

| Question | Decision |
|---|---|
| Source of the ways | Geofabrik regional extracts (`belgium` by default, a configurable list), refreshed monthly by full replacement |
| Who turns an extract into Trail's tables | `osmium-tool` filters it to the ways and stops Trail keeps, in GitHub Actions or by hand; a Node loader in the worker streams the result into Postgres. No native tool in the runtime image |
| Where the ways live | The existing `osm_ways`, `osm_tile_ways`, `osm_pois` tables, with a `source` per row and a compact geometry column; the z14 tile index stays the key. No PostGIS |
| What "covered" means | A z14 tile each of whose four corners lies inside the polygon of a ready region, any of them (the union, so that neighbouring regions cover their shared border, §2.5). Outside: Overpass when configured, else the move stays unmapped and the API and UI say why |
| Basemap | Vector tiles in the OpenMapTiles schema, built with Planetiler from the same extract into one PMTiles file per region, plus a world overview at z0–6 for the map abroad, so the current OpenFreeMap styles keep working with their source URL swapped |
| Fonts and sprites | Fetched at image build time with pinned checksums and shipped in the image; the styles are vendored in the repository |
| Serving | The API serves `/map/*`: styles, tiles read from the PMTiles file, fonts, sprites; public, cacheable, same origin, so the CSP's map origins become `'self'` |
| Distribution | A monthly GitHub Actions workflow publishes one OCI artefact per region to GHCR (ways file + basemap + polygon + manifest); the worker pulls by tag, verifies every blob's SHA-256, and imports |
| What stays external | Nothing in the hot path. Overpass for tiles outside the regions and OpenFreeMap for the basemap are opt-in fallbacks, off by default once phase 3 ships |
| Privacy | No coordinate, tile or bounding box leaves the node any more; the only outbound requests are a registry pull per month (and ntfy) |

## 1. Today, and why it changes

- Map matching needs every z14 tile (about 1.5 km square at 51° N) a move
  touches. A tile Trail has not seen is one Overpass query: one request at a
  time, at most one every 2 s, answers of 30–50 s, intermittent 502s, retried
  with backoff, 300 MB a day. A new area, a trip, or a release that queues
  the whole history (the 0.5.0 backfill) means hundreds of tiles, hours of
  waiting, and windows that stay unmapped meanwhile: after the 0.5.0 deploy
  55 missing tiles held a 12-day window for hours.
- Every query tells the Overpass operator which squares the devices passed
  through and when, from the server's address (§12). The policy of the
  public instance also caps what Trail may ask.
- The basemap is OpenFreeMap: style JSON, vector tiles, glyphs and sprites
  from `tiles.openfreemap.org`, which the CSP allows as a map origin. A
  browser that opens Trail tells OpenFreeMap which areas it looks at, and the
  map is blank when they are down or when the server has no route out.
- At 1000 devices (the target of the load test) the Overpass path cannot
  work at all: a day of a thousand commuters touches thousands of tiles.

Goals: map matching that never waits for a network inside the regions the
server covers; a basemap that works on a server without internet access;
no user positions leaving the node; boring tools; a node of this size (6
cores, 16 GB, 181 GB free, Docker Desktop with 8.25 GB) that carries Belgium
with room to spare and Benelux comfortably.

Non-goals: a planet-wide map; routing or geocoding; satellite imagery
(stays as it is, §14); a change to the matching algorithm (the mapped level
keeps its version: the same ways, the same matcher).

## 2. Map data for matching

### 2.1 Source: Geofabrik extracts

[Geofabrik](https://download.geofabrik.de) publishes a daily `.osm.pbf` per
country and sub-region under the ODbL, free, over HTTPS, with an `.md5` next
to each file and a `.poly` with the region's polygon. The regions are named
by their path, `europe/belgium`; Trail's configuration takes the last part
(`belgium`, `netherlands`, `luxembourg`, `germany`, `france`, `europe`). A
region's PBF header carries `osmosis_replication_timestamp`, the extract's
date, which the artefact's manifest records.

| Region | PBF | Highway/railway/ferry ways | Node references | z14 tiles inside the polygon |
|---|---|---|---|---|
| `luxembourg` | 0.05 GB | 0.14 M | 1.15 M | 957 |
| `belgium` | 0.70 GB | 1.53 M | 10.8 M | 13 203 |
| `netherlands` | 1.41 GB | 2.86 M | 18.1 M | 25 007 |
| `benelux` (the three merged) | *2.15 GB* | *4.54 M* | *30.0 M* | 39 445 |
| `germany` | 4.87 GB | 16.6 M | 111 M | 165 776 |
| `france` | 5.11 GB | 12.6 M | 123 M | 276 286 |
| `europe` | 35.3 GB | *80–100 M* | *650–800 M* | — |

Measured in task 0 (§10) on Geofabrik's extracts of 27 October 2026; the
tiles are those whose four corners lie in the polygon (§2.5), which
Geofabrik draws around territorial waters too, and Benelux's count is that
of the three polygons together. *Italics* are extrapolated: Benelux sums
its parts (a merged extract would hold the ways on the borders once), and
Europe scales the measured countries by its extract's size. The estimate
this table replaces had Belgium at 0.5 GB with 15 M node references.
Default: `MAP_DATA_REGIONS=belgium`. A Benelux household sets `benelux`;
a region is one artefact (§4.2), and several may be listed. Monaco
(0.7 MB) is the test fixture (§4.4).

Cadence: Geofabrik rebuilds daily; Trail refreshes monthly
(`MAP_DATA_REFRESH_DAYS=30`). Roads change slowly, and a refresh never
reprocesses history (§2.6). Daily diffs (`belgium-updates/`, applied with
`osmium apply-changes`) would cut the monthly download from 0.7 GB to about
100 MB for Belgium, but need the previous full file and a rewrite of it; not
worth it below Europe (§9).

Alternatives considered: the planet file (96 GB on 19 October 2026, no);
BBBike's custom extracts (hand-drawn areas, weekly, no polygons to test
coverage against); Overpass itself for a one-off area download (the thing
this design leaves); OpenStreetMap's own servers (no extracts).

### 2.2 Importer

Four ways to turn a PBF into Trail's tables were compared for the node
(12 vCPU Docker VM, 8.25 GB, laptop SSD):

| Option | Belgium | Europe | RAM | Disk | Fit |
|---|---|---|---|---|---|
| Node parser on `pbf` 5.x (BSD-3; the two OSM `.proto` files compiled with its generator), two passes, node locations in typed arrays | ~ 3 min | impossible in RAM (900 M node references need a disk-backed store: external sorting written by hand) | 15 M references × 16 B = 240 MB; Benelux 0.8 GB | the PBF | pure Node, no tool; caps at Benelux-sized regions |
| `osm-pbf-parser` 2.3 (MIT), `osm-read` (BSD-2) | as above | as above | as above | — | unmaintained since 2018 and 2016 |
| **`osmium-tool`** (1.16 from Ubuntu 24.04 on the runner, 1.18 in Debian 13; GPL-3.0-or-later, Jochen Topf; `libosmium` is Boost-licensed) as a subprocess at build time: `tags-filter`, `add-locations-to-ways`, `cat -f opl`, `export` | 1 min 15 s, measured on the runner (§10) | ~ 45 min with `--index-type=sparse_file_array` (14 GB index file), not measured | 2.0 GB for `tags-filter`, whose id sets span the whole OSM id space (Luxembourg needs as much, Monaco 1.3 GB); 0.3 GB for `add-locations-to-ways` | 2× the filtered file | the reference implementation; a native binary, so it runs where the artefacts are built, never in the runtime image |
| `osm2pgsql` 2.x (GPL-2.0) or `imposm3` (Apache-2.0) | ~ 5 min | ~ 3 h | 2–8 GB | PostGIS tables | both need PostGIS (§2.4); their tables are not Trail's |
| Planetiler 0.10 custom profile (Apache-2.0, Java) | ~ 3 min | hours | 3–16 GB | tiles | writes vector tiles, which clip ways at tile edges and drop node ids: the graph needs both |

Only the osmium row is measured; the others are the comparison's estimates
of options that were not built.

Decision: `osmium-tool` does the heavy lifting where the artefacts are built
(GitHub Actions, or a machine with the tool for big regions, §4), and a
Node loader in the worker streams the result into Postgres. The runtime
image stays pure JavaScript (§13.1 forbids native addons; a `RUN apk add`
in the final stage would need QEMU for the arm64 build), the GPL binary is
only ever executed as a separate process at build time, and the loader is
small: a line parser and `COPY`.

The build step (`scripts/mapdata/build.sh <region>`, run by the workflow of
§4.1 or by hand):

```sh
# the ways Trail keeps (overpassQuery.ts, the same filter), with the nodes they
# reference; --remove-tags strips those nodes of their own tags, so that adding
# the locations to the ways drops them
osmium tags-filter --remove-tags "$pbf" -o ways.osm.pbf \
  'w/highway!=proposed,construction,abandoned,razed,disused,planned' \
  w/railway=rail,light_rail,tram,subway,narrow_gauge,funicular w/route=ferry
osmium add-locations-to-ways ways.osm.pbf -o ways-located.osm.pbf
# one line per way: id, tags, node ids with coordinates; keep-tags.awk keeps
# the tags Trail reads (keptTags of parseOverpassResponse.ts)
osmium cat -t way -f opl,add_metadata=false,locations_on_ways=true ways-located.osm.pbf \
  | awk -f keep-tags.awk | gzip -6n > ways.opl.gz
# the stops and airports (classifyPoi.ts): points, and aerodromes mapped as
# areas, which osmium writes as MultiPolygon features (every area is one)
osmium tags-filter --remove-tags "$pbf" -o pois.osm.pbf \
  n/railway=station,halt,tram_stop n/highway=bus_stop n/amenity=ferry_terminal nwr/aeroway=aerodrome
# pois-export.json: areas only for aeroway=aerodrome, no linestrings, the
# classifying tags and the name, @type and @id
osmium export -c pois-export.json -f geojsonseq --geometry-types=point,polygon \
  --add-unique-id=type_id pois.osm.pbf | gzip -6n > pois.geojsonseq.gz
```

Three details the first build settled. OPL carries the coordinates of a
way's nodes only with the format option `locations_on_ways=true`; without
it the line has the node ids alone. `add_metadata=false` drops version,
changeset, time and user, which Trail never reads. And osmium's own feature
id gives an area an `a` and an area number (way id × 2, relation id × 2 + 1),
so the loader takes `@type` and `@id` instead.

OPL is osmium's line format, UTF-8 with a space, `,`, `=`, `@`, `%` and the
characters above U+05FF in keys and values written as `%<hex>%`. A line of
the Monaco fixture (no metadata, the trailing zeros of the coordinates
dropped, shortened here):

```text
w4224972 Thighway=residential,name=Avenue%20%des%20%Papalins,oneway=yes Nn25177418x7.4174924y43.7296303,n4939779378x7.4174638y43.7296727,…
```

The output is deterministic: osmium 1.16 on the runner and 1.18 on Debian
wrote the same `ways.opl.gz` byte for byte. The loader
(`apps/api/src/mapdata/loadWays.ts`) streams `ways.opl.gz` through `zlib`,
classifies every way with `classifyWay` (the kept tags of
`parseOverpassResponse`, the same `kind`; `null` drops it), computes its
bounding box and the z14 tiles its segments pass through (`forEachCell` of
`wayIndex.ts` in tile space), and writes batches of 5 000 rows with
`COPY … FROM STDIN` (`pg-copy-streams` 7.x, MIT, pure JavaScript; today's
`jsonb_to_recordset` inserts are three to five times slower at this volume).
`pois.geojsonseq.gz` goes the same way: a `Point` keeps its position; an
aerodrome mapped as an area is a `MultiPolygon` (osmium writes every area as
one, a closed way included: Belgium has 43 of them beside 62 337 points) and
becomes the centre of the bounding box over all its rings (what Overpass's
`out center` gives, rather than the centroid, so that the mapped level does
not change); the parser accepts a `Polygon` the same way. The id is `n…`,
`w…` or `r…` from `@type` and `@id` (large airports are often multipolygon
relations).

Memory: the loader holds one batch and the region's polygon; the tile
membership of a way is computed from its own geometry, so nothing
accumulates. Measured with the prototype (§10): 272 MB for Belgium, 88 MB
for Monaco, most of it Node and the garbage collector's slack rather than
data; a loader that streams the stops in batches as well (the prototype
holds them all, 62 k for Belgium) stays there for Europe, which is why the
loader can run in the worker beside processing (§5.4). Time, measured on a
Postgres limited to 2 CPUs and 2 GB: Belgium's first import 46 s (26 s of
parsing and `COPY` at 58 500 ways a second, of which the parsing itself is
4 s and Postgres most of the rest; 15 s of keys and indexes with
`SET maintenance_work_mem = '512MB'` for the session; 5 s of
`VACUUM ANALYZE`), plus the download of the artefact. Extrapolated by way
count (*not measured*): Benelux about 2¼ min, Germany about 8 min, France
about 6 min, Europe 40–50 min. A refresh takes three to four times as long
as a first import as §2.6 describes it, which is one more reason for its
partitions.

### 2.3 What is extracted

Exactly what `overpassQuery.ts` asks for, classified by the same code, so
the mapped level's version does not change:

- ways: every `highway=*` except the lifecycle values (`classifyWay` drops
  `proposed|construction|abandoned|razed|disused|planned` and maps the
  rest to `WayKind`, `other` included), `railway` in
  `rail|light_rail|tram|subway|narrow_gauge|funicular`, `route=ferry`; the
  kept tags `highway, railway, service, maxspeed, name, route,
  public_transport, oneway`; the node ids in order (the graph connects ways
  at shared nodes, `wayGraph.ts`); the coordinates of every node.
- stops: `railway=station|halt|tram_stop` nodes (subway stations by
  `station=subway` or `subway=yes`), `highway=bus_stop` nodes,
  `amenity=ferry_terminal` nodes, `aeroway=aerodrome` nodes, ways and
  relations with their centre.

A way whose node count and coordinate count differ, or with fewer than two
nodes, is dropped and counted (`malformed`), never written: the strictness
of `parseOverpassResponse` applies, per way rather than per tile, since a
region's file is not a tile that can be refused whole.

### 2.4 Storage model

Three options for "the ways within this area":

| Option | Query | Cost | Verdict |
|---|---|---|---|
| **Tile index** (today's `osm_tile_ways`): membership rows per z14 tile, computed at import | PK lookups per tile, as `loadMapData` does now | 1.73 M rows for Belgium at 166 B each, measured (§10); *90–115 M* for Europe | keeps `planPieces`, `pieceMaxTiles`, `missing_tiles`, `FixtureWaySource` and every test as they are |
| Plain Postgres `box` column with a GiST index (built in, no extension) | `bbox && box(...)` per piece | one index, long ways over-selected | fewer rows, but every caller changes and the fetcher's tile bookkeeping stays anyway |
| PostGIS 3.6 (`postgis/postgis:18-3.6-alpine`), `geometry(LineString)`, `ST_Intersects` | one spatial query per piece | a new database image, `CREATE EXTENSION` in a migration, PostGIS in the dev container and the test databases, bigger dumps, a second thing to upgrade with Postgres majors | real geometry Trail does not need: it reads whole ways by area and does the rest in memory (`wayIndex.ts` has its own 100 m grid) |

Decision: the tile index, in plain Postgres. PostGIS would buy a spatial
query Trail has no other use for, at the price of the database image and
every environment that runs tests. Changes to the tables (one migration,
§8.3):

- `osm_ways`: `source text not null` (`overpass`, or `region:<name>@<build>`,
  the artefact's build id); `geometry bytea` instead of jsonb: big-endian
  `int32` pairs of lon and lat in 1e-7 degrees — OSM's own precision, what
  Overpass's JSON carries in 7 decimals — read with a `DataView`, 8 bytes a
  vertex instead of about 22. `nodes bigint[]` and the kept `tags jsonb`
  stay. An index on `(source)`.
- `osm_tile_ways`: `source` joins the primary key `(z, x, y, way_id, source)`.
  `loadMapData` already reads `DISTINCT`, so a way that two sources hold
  (a border tile fetched from Overpass before the region arrived) is one
  way.
- `osm_pois`: `source`, and an index on it.
- `osm_regions` (new): `name` (PK, `belgium`), `build_id`, `digest`,
  `extract_timestamp`, `polygon jsonb` (the `.poly` rings), `bbox`, `status`
  (`importing|ready|failed`), `error`, `way_count`, `poi_count`,
  `imported_at`, `updated_at`.
- `osm_tiles` stays what it is: the cache bookkeeping of the Overpass
  fallback. A region writes no rows into it; coverage comes from polygons
  (§2.5).

Sizes, measured on a first import of Belgium with the loader prototype
(§10): 329 B per way (`osm_ways`, 299 B of row and 30 B of primary key),
166 B per membership row (`osm_tile_ways`, 77 B of row and 89 B of the two
indexes: the text `source` in the primary key costs 34 B a row; a `smallint`
source id would make it 132 B), 196 B per stop; Belgium's 1.53 M ways,
1.73 M memberships (1.13 tiles a way) and 62 k stops take 0.80 GB.
Extrapolated by way count from the extracts of §2.1: the Netherlands 1.5 GB,
France 6.6 GB, Germany 8.7 GB, Europe about 45 GB. A refresh as §2.6
describes it doubles that on disk (measured there). Today's cache tables
hold a few thousand tiles, so the migration converts them in place (a
statement at its end; the cache is rebuildable either way).

Backups: `pg_dump` of §13.4 takes every table; from Belgium on, the map
tables would be most of the dump. The backup script gets
`--exclude-table-data='osm_*'` (schema kept, rows left out), and the
restore runbook ends with `trail map import` (§8.4). Derived data was
always rebuildable; this makes it the first table family a dump leaves out.

### 2.5 Coverage semantics

Today a move is mapped only when all its tiles are cached (`cachedTiles`,
§17.3). With regions:

- A z14 tile is **covered** when all four of its corners lie inside the
  polygon of a region whose status is `ready`. Corners rather than the
  centre: Geofabrik extracts hold the ways inside the polygon and complete
  the ways that cross it, so a border tile is half empty; matching a move
  onto half a map would snap it to nothing where the other half is. A
  household near a border lists the neighbour. Measured on Geofabrik's
  polygons, which include territorial waters: Belgium covers 13 203 tiles of
  the 14 185 its polygon touches, and of the 14 012 tiles that hold Belgian
  ways 1 511 are not covered (the border strip, with the outer parts of the
  complete ways that cross it: 2.3 % of the memberships). Two consequences
  task 3 must take: with neighbours listed as regions of their own, a corner
  should count as inside when it lies in *any* ready region's polygon, not
  all four in the same one; per polygon, `belgium,netherlands,luxembourg`
  covers 39 159 tiles, by their union 39 445, and the 286 tiles in between
  are exactly the border crossings the neighbour was listed for. And Monaco,
  whose polygon follows its land border, has one covered tile of the six
  that hold its streets (§4.4).
- `cachedTiles(tx, keys, before)` becomes `tileAvailability(tx, coverage,
  keys, before)`: covered tiles are available and never stale; the rest are
  looked up in `osm_tiles` as today. `loadMapData` does not change: the
  membership rows of a covered tile come from the region's import, those of
  a fetched tile from the Overpass cache.
- A move whose tiles are not all covered or cached:
  - with Overpass configured, the window waits for the uncovered tiles in
    `missing_tiles`, exactly as today, and the fetcher asks Overpass for
    them only (never for a covered tile: `tilesToFetch` filters through the
    coverage index);
  - without, the window finishes at once, the move is stored unmapped
    (`lat_map` null, the inference without map evidence, as a window with
    `PROCESSING_OVERPASS_URL` empty is today), and nothing waits.
- A region in status `importing` (its first import; a refresh swaps sources
  without passing through it, §2.6) counts as not covered; windows wait as
  for missing tiles and are re-armed when it becomes `ready`
  (`rearmWindows` gains the polygon test, run in the worker, since the
  test is JavaScript, not SQL).
- The coverage index (`apps/api/src/mapdata/coverage.ts`): the `ready`
  regions' polygons in memory, a ray-casting point-in-polygon on the four
  corners, a per-tile memo. Reloaded when `osm_regions.updated_at` changes
  (checked once a minute by the worker and the API).

The reason reaches the API and the UI. A move's `features` gains
`map: { source: "region" | "overpass" | "none", reason: null |
"outside_regions" | "waiting" | "off" }` — what the move was judged on,
where everything else of that kind lives. The tracks and timeline answers
(`GET /api/v1/tracks`, `/segments`, §17.6) expose it on moves as
`map: { covered, reason }`; `GET /api/v1/map/coverage` (new, `history:read`,
no positions) lists the regions with their names, extract dates, bounding
boxes and status. The level control's "what is missing" line, the move
dialog and the Insights notices say which: "No map data here: outside this
server's map regions (Belgium)", "waiting for map data", "map data is
switched off". `availableLevel` keeps degrading to `averaged` as today.

### 2.6 Refresh

- Monthly, full replacement. The worker checks the registry tag of each
  region every `MAP_DATA_REFRESH_DAYS` days (and on `trail map refresh`);
  a changed digest is downloaded and verified (§4.3), then imported under a
  new source id `region:belgium@<build>` beside the old one. When the load
  is complete, one transaction sets `osm_regions.build_id` to the new build
  (and with it the region's source id), after which the old source's
  membership and POI rows are
  deleted and ways no membership row references any more are dropped (the
  orphan rule of `saveTile`). Windows never see a half-imported region;
  the price is twice a region's disk during the swap (§2.7).
- Measured with the prototype on Belgium (§10), a refresh to identical
  data takes 2 min 38 s: 22 s of `COPY` into staging tables, 33 s to upsert
  the ways, 81 s to add the new memberships beside the old ones (a
  five-column text key and the foreign key checked row by row), 6 s to
  drop the old memberships and the orphans, 13 s of `VACUUM ANALYZE`. And
  it does not give the space back: every way row is rewritten (its `source`
  carries the build id, so no row is unchanged), every membership row is
  new, and after the vacuum `osm_ways` is 2.0 times and `osm_tile_ways`
  2.3 times their size after the first import (0.80 GB → 1.68 GB in all);
  the next refresh reuses the freed pages (Monaco: 2.0 times after the
  first refresh and after the second), so a region costs about twice its
  import for good, not only during the swap. Task 1 should rather give
  each build partitions of its own (the three tables partitioned by list
  on `source` and keyed by source and id, a new build's partitions loaded
  without indexes, indexed, then attached; the swap detaches and drops
  the old build's partitions, which frees the space at once), or at least
  keep the build id out of the rows that do not change
  (`source = 'region:belgium'`, an upsert that skips unchanged ways with
  `WHERE … IS DISTINCT FROM`, memberships replaced by difference).
- No reprocessing after a refresh. The ways a move was matched to a month
  ago are still right; `processed_points.way_id` keeps pointing at OSM ids
  that may have changed, which nothing reads back. `trail reprocess
  --from-level mapped [--from --to]` is the way to redo a period on new
  data when someone wants it (a road that opened).
- The first import of a region re-arms every waiting window whose tiles it
  covers: the backlog of §1 clears itself.
- `PROCESSING_OSM_TTL_DAYS` (90) keeps its meaning for the Overpass cache
  only. A region's age is `extract_timestamp`; `trail map status` and
  `/api/v1/map/coverage` show it, and a region older than
  `3 × MAP_DATA_REFRESH_DAYS` logs a warning (the refresh is failing).
- A failed download or import keeps the old build serving and logs
  `map region refresh failed` with the reason (never a URL with a
  position in it; there is none); the next check tries again.

### 2.7 Disk and RAM budgets

On the volume `trail-map` (a Compose volume of the project, rebuildable from
the registry) and in the database, from the measurements of §10:

| Regions | One build's artefact | Database after an import | Peak during a refresh | Steady |
|---|---|---|---|---|
| `belgium` | 0.56 GB | 0.80 GB | 4.2 GB | 2.8 GB (1.9 GB with partitions) |
| `benelux` | 1.51 GB | *2.4 GB* | *12 GB* | *8.0 GB (5.4 GB)* |
| `belgium,germany` | *4.8 GB* | *9.5 GB* | *44 GB* | *30 GB (19 GB)* |
| `europe` | *about 31 GB* | *about 45 GB* | *about 230 GB* | *about 160 GB (107 GB)* |

The volume keeps two builds (the old one serves open maps until the next
refresh, §3.5) and holds a third while a new one downloads; the database
holds the region's tables (twice their import size for good with the refresh
of §2.6, once with partitions per build), and during a refresh a staging
copy and up to 1 GB of write-ahead log besides. So Belgium: 1.1 GB on the
volume and 1.7 GB of tables steady (0.8 GB with partitions); 1.7 GB and
about 2.5 GB at the peak. *Italics* are extrapolated from Belgium's bytes
per way. Europe does not fit this node with the refresh of §2.6 (about
230 GB at the peak against 181 GB free) and fits it narrowly with partitions
per build and the previous build deleted before a download (about 150 GB);
it is supported on a bigger disk, not the default, and §9 says what it costs
in time. RAM: the loader 300 MB in the worker (272 MB measured); the API's
tile serving a few MB (the PMTiles directory cache, §3.4); Postgres
unchanged at 2 GB (`shared_buffers` of the image's default serves the hot
tiles; `osm_tile_ways` of Belgium is 287 MB).

### 2.8 The `WaySource` interface

Today a source is a pull per tile: `fetchTile(tile, signal)`. A local
region cannot fetch and never fails for a tile; coverage is a property of
the source. The interface grows a question and the fetcher asks it:

```ts
export type TileState = "ready" | "fetchable" | "none";

export interface WaySource {
  readonly name: string;
  /** What this source can do for each tile now: serve it from the local tables, fetch it, or nothing. */
  states(tiles: Iterable<TileKey>): Promise<Map<TileKey, TileState>>;
  /** Only for tiles it reported `fetchable`. */
  fetchTile(tile: TileAddress, signal: AbortSignal): Promise<TileData>;
}
```

- `RegionWaySource` answers `ready` for covered tiles (§2.5), `none` for the
  rest; its `fetchTile` throws `TileFetchError("unavailable")`.
- `OverpassWaySource` keeps its `fetchTile` and answers `fetchable` for
  everything (it is the one that knows about the daily budget and the
  politeness rules).
- `CompositeWaySource([region, overpass?])` takes the first source that is
  not `none` for a tile; `TileFetcher` fetches only `fetchable` tiles and
  `tileAvailability` treats `ready` tiles as cached and fresh.
- `FixtureWaySource` (tests) answers `fetchable` and stays as it is; a new
  `FixtureRegionSource` wraps the synthetic world as a region with a
  polygon, for the coverage tests.

`TileFetchReason` gains nothing: a tile outside every region is not an
error, it is a `none` the window records as `outside_regions`.

## 3. Basemap self-hosting

### 3.1 Tiles: OpenMapTiles schema from Planetiler, or Protomaps

| | Planetiler → OpenMapTiles schema PMTiles | Protomaps basemap PMTiles |
|---|---|---|
| Build | Planetiler 0.10.2 (Apache-2.0, Java 21 or later; the workflow runs the runner image's Temurin 21) with its bundled `planetiler-openmaptiles` profile (Apache-2.0; the schema is OpenMapTiles 3.16, CC-BY 4.0): one run per region, `--output=basemap.pmtiles`, z0–14 by default | none: `pmtiles extract https://build.protomaps.com/<date>.pmtiles --bbox=…` (go-pmtiles 1.2x, BSD-3) pulls the region's tiles from their daily planet build with range requests |
| Belgium | measured: 7 min 49 s on the runner (1 min of it the first download of the sources), `-Xmx3g` of which 2.0 GB in use, 427 MB | 3 min, no RAM, 250 MB (maxzoom 15); not measured |
| Europe | not measured; extrapolated from France about 5 h on 4 vCPU, 8–16 GB of heap and 140 GB of temporary files, so not on a GitHub runner | about an hour, bandwidth-bound, 13 GB; not measured |
| Styles | the current ones: OpenFreeMap's `liberty` and `dark` work unchanged with their source pointed at Trail — and the same style serves the OpenFreeMap fallback | `@protomaps/basemaps` (BSD-3) flavours `light` and `dark`: a different look, a second style set for the fallback, the heat and track layer placement tests redone |
| Attribution | `© OpenMapTiles © OpenStreetMap contributors` | `© Protomaps © OpenStreetMap contributors` |
| Build-time downloads | Geofabrik, Natural Earth, OSM water polygons and lake centrelines (1.45 GB: 434 MB, 932 MB, 81 MB; fetched once a month into the Actions cache, restored in 10–15 s) | the planet build (served by Protomaps) |

Decision: Planetiler and the OpenMapTiles schema. Keeping one style set for
the self-hosted tiles and the fallback is what makes the fallback a flag
rather than a second map, and the screenshots, the heat placement
(`heatLayerPlacement.ts`, tested on both OpenFreeMap styles as served) and
the contrast numbers of §14 stay valid. Protomaps is the way out if the
Planetiler build ever becomes a burden, and the answer for a Europe basemap
without a build machine (§9).

Build numbers on a GitHub runner (4 vCPU, 16 GB, 84 GB free disk, 6 h
per job), measured in task 0 (§10):

| Region | Planetiler time | Heap (`-Xmx` / in use) | Temp disk | `basemap.pmtiles` |
|---|---|---|---|---|
| `luxembourg` | 1 min 4 s | 2 GB / 1.4 GB | 0.8 GB | 36 MB |
| `belgium` | 6 min 47 s (7 min 49 s with the month's first download of the sources) | 3 GB / 2.0 GB | 2.8 GB | 427 MB |
| `netherlands` | 7 min 1 s | 4 GB / 2.3 GB | 5.1 GB | 679 MB |
| `benelux` (`osmium merge` first) | *15 min* | *4–5 GB* | *9 GB* | *1.14 GB* |
| `germany` | 23 min 55 s (task 2's build; the first was cancelled at the job's first limit of 2 h) | 8 GB / 3.7 GB | 19.4 GB | 3.13 GB |
| `france` | 41 min 43 s | 8 GB / 4.2 GB | 20.6 GB | 3.47 GB |
| `europe` | not on the runner | | | *about 22 GB* |

Planetiler's time is half a minute of reading Natural Earth and the water
polygons, then the passes over the OSM data and the writing of the tiles:
2 min 19 s and 3 min 43 s for Belgium, 2 min 21 s and 4 min 2 s for the
Netherlands, the same time for an extract twice the size, so the map's
detail counts more than the file's size; France takes 18 min and 21 min,
Germany takes 24 min in all. The basemap is half to three
quarters of the extract's size (Belgium 427 MB for 0.70 GB, France 3.47 GB
for 5.11 GB); the profile alone needs about 1.1 GB of heap (§10.2).
*Italics* are extrapolated: Benelux from its three parts, Europe from the
measured countries by its extract's size.

Zoom 14 is the schema's native maximum (OpenFreeMap serves z0–14 too);
MapLibre overzooms to 19 from there, as it does today.

**Outside the region.** Planetiler writes tiles for the extract's bounding
box only, at every zoom: a Belgian archive has nothing for a holiday in
Spain, and the map there would be Trail's tracks on a plain background.
Two measures:

- a **world overview**, one archive for every region set,
  `trail-mapdata:world`, built in the same workflow with Planetiler from the
  Monaco extract and `--bounds=world --maxzoom=6` (the region `world` of
  `scripts/mapdata/regions.json`). Measured in task 0 (§10): 5.3 MB, 5 083
  tiles of which 3 713 distinct, built in 82 s. What the profile fills
  without OSM data, from Natural Earth and the OSM water polygons: `water`
  (the oceans at z0–6 everywhere, Natural Earth's lakes at z0–5),
  `landcover` (glaciers and ice shelves, z0–6), `boundary` (country and
  state borders at **z0–4 only**: from z5 the profile draws boundaries from
  OSM relations, which the Monaco extract does not have), `landuse` (urban
  areas, z4–5) and `waterway` (rivers, z3–5). There is no `place` layer
  abroad (labels come from OSM place nodes: the overview names Monaco and
  nothing else), no `transportation` and no `water_name`. So abroad the map
  shows coastlines, ice and rivers, country borders up to z4 and no names;
  at z5–6 the land is blank but for rivers at z5. That is less than
  "countries and coastlines": names and borders at z5–6 need a world-wide
  OSM input (the `admin_level=2` boundaries and the
  `place=country|state|city` nodes of the planet, which neither Geofabrik
  offers nor the runner's 84 GB of disk can cut from a 96 GB planet file
  next to its own output) or the Protomaps planet build at z0–6 (§9).

  **The tile router's rule** (decided here; §3.3 and §9 refer to it): a tile
  of z ≤ 4 comes from the world archive (from the region archive while a
  node has no world archive yet); a tile of z ≥ 5 from the region archive,
  else the world archive, else 204. Task 0 found why the low zooms must not
  come from the region: a region archive covers the extract's bounding box
  at every zoom, so it has the tiles 0/0/0, 2/2/1 and 4/8/5 for Belgium, but
  Planetiler keeps in them only the features that touch that box (Belgium's
  z0 tile has Belgium's borders and label and no other country's; the world
  archive's has them all). From z5 the region's tiles are the better ones:
  at z5–6 they carry Belgium's OSM borders, motorways and city names, which
  the overview lacks. Region archives keep their z0–4 tiles, so that each
  stays usable on its own; that costs at most 341 duplicate tiles per
  archive. The fallback flag of §3.5 is for whoever wants OpenFreeMap's
  detail everywhere.
- the styles' second source, `ne2_shaded` — Natural Earth II shaded relief
  as raster tiles from OpenFreeMap, drawn under everything at the world
  zooms — is removed from the vendored styles with its one layer. The
  world zooms lose their relief shading, nothing else; a self-hosted
  raster set of it is an open question (§9).

### 3.2 Styles, fonts, sprites

- **Styles** are vendored: `apps/api/map/styles/liberty.json` and
  `dark.json`, fetched once from `tiles.openfreemap.org/styles/liberty` and
  `/styles/dark`. OpenFreeMap's style repository is MIT; `liberty` is its
  fork of OSM Liberty (BSD) and `dark` of OpenMapTiles' Dark Matter (BSD),
  both with their fonts set to Noto Sans. The files carry no name, licence
  or attribution of their own, so the vendored copies get a `metadata`
  block naming the origin, the commit and the licences, and
  `docs/licences.md` repeats them. Three fields are rewritten when served:
  `sources.openmaptiles` becomes `{ type: "vector", tiles:
  ["/map/tiles/<build>/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 14,
  attribution: "© OpenMapTiles © OpenStreetMap contributors" }` — the
  attribution OpenFreeMap's TileJSON supplies today, which MapLibre's
  control shows —, `glyphs` becomes
  `/map/assets/<hash>/fonts/{fontstack}/{range}.pbf`, `sprite`
  `/map/assets/<hash>/sprites/ofm`. Relative URLs keep the map same-origin
  on every allowed origin (`PUBLIC_URL`, `ADDITIONAL_ORIGINS`, a preview);
  MapLibre's worker, which fetches the tiles, resolves them against its own
  same-origin script (task 4 checks this in the dev server and the build;
  the fallback is to render them absolute from the request's origin). An
  update of the vendored styles is a pull request of its own, read in the
  diff, like a Biome release (§2 house rules). `apps/web/tests/support/
  basemapLayers.ts` imports the vendored files, so the placement tests and
  the styles can no longer drift apart.
- **Fonts**: the glyph PBFs of the font stacks the two styles name (`Noto
  Sans Regular`, `Bold` and `Italic` in `liberty`, `Regular` alone in
  `dark`; the build reads `text-font` from the vendored files and fails on
  a stack it has no glyphs for), 256 ranges each, about 10 MB a stack, from
  the releases of `openmaptiles/fonts` (Noto Sans is SIL OFL 1.1).
  **Sprites**: the sheet both styles name, `sprites/ofm_f384/ofm`
  (`.json`, `.png`, `@2x`, about 1.5 MB), as OpenFreeMap serves it: OSM
  Liberty's icon set, Maki (CC0) for most of it; the sheet's own licence is
  confirmed at vendoring and recorded with it.
- Both are **fetched at image build time** by `scripts/map-assets.mjs`
  from URLs pinned with SHA-256 in `scripts/map-assets.json`, into
  `apps/web/dist/map-assets/<hash>/`, where `<hash>` is the SHA-256 of
  that JSON file. A Docker layer keyed on the JSON caches the download; the
  image grows by about 35 MB. Shipping them in the image rather than with
  the tiles keeps a style and its glyphs in one commit, gives previews
  labels without a bundle, and spares the registry a second artefact. The
  trade-off, 35 MB on every `sha-<commit>` image, is accepted.

### 3.3 Serving

The API serves everything under `/map/`, public, without a session: the
basemap is open data and the public share page draws it too. Rate limit
`RATE_LIMIT_MAP_PER_MINUTE` (3000 per IP, its own limiter: a fast pan asks
for a few hundred tiles a minute; `/map` never counts against the `/api`
budget). Compression is skipped for the whole prefix (tiles arrive
compressed; glyphs and sprites hardly compress).

| Route | Answer | Caching |
|---|---|---|
| `GET /map/styles/light.json`, `dark.json` | the vendored style rendered for the active bundle and asset hash; without a bundle, a 404 or the fallback (§3.5) | `Cache-Control: no-cache`, ETag of build + hash |
| `GET /map/tiles/<build>/{z}/{x}/{y}.pbf` | the tile read from `basemap.pmtiles` with the `pmtiles` package 4.x (BSD-3; a `Source` over `fs.promises.FileHandle.read`, its directory cache sized to about 10 MB); `Content-Type: application/x-protobuf`, `Content-Encoding: gzip` passed through as Planetiler wrote it; z ≤ 4 from the world archive, z ≥ 5 from the region archive, else the world archive, else 204 (the rule of §3.1); 404 for a build that is not active | `public, max-age=31536000, immutable` (the build id is in the path) |
| `GET /map/assets/<hash>/fonts/{stack}/{range}.pbf`, `…/sprites/ofm(.json|.png|@2x.png|@2x.json)` | static files of the image | immutable, as `/assets/*` |
| `GET /api/config` | `mapStyles.light` and `.dark` become the paths above (the contract allows a path, not only a URL) | as today |

A `tileRouter` of about 150 lines: open the active bundle's file on start
and on a change of `map_bundles` (polled once a minute, since the API and
the worker are separate processes), validate `z/x/y` (0–14, in range),
cap a tile at 2 MB. Reads are a few hundred microseconds; the file stays in
the page cache. The alternatives: the browser reading the PMTiles file with
range requests through the `pmtiles` protocol (`express.static` ranges;
one more library in the map chunk, partial responses the browser caches
poorly, and the browser-caching design would have to key on byte ranges),
and Martin (`ghcr.io/maplibre/martin`, Apache-2.0/MIT, which serves PMTiles,
fonts and sprites by itself) as a second routed service, which Launchway's
one route per app and the CSP's `'self'` argue against.

CSP (§12): with a bundle active the map origins are `'self'`;
`MAP_CONNECT_SRC` stays for satellite imagery and the fallback.

### 3.4 Light, dark, satellite, raster

Light and dark stay the two vendored styles; Auto keeps following the
system (§14). Satellite is untouched (`MAP_STYLE_SATELLITE`, external by
nature). There is no raster basemap: MapLibre draws vector and raster with
the same renderer, a self-hosted raster set would need a renderer of its
own (tileserver-gl, 10 GB for Belgium at z0–18), and the case it would
cover — a browser without WebGL — already shows the page's text instead of
a map. What a server without a bundle shows is in §3.5.

### 3.5 Updates, and what stays external

- The bundle refreshes with the region (§2.6): the same artefact, the same
  month. The API switches builds at the next poll; open maps keep loading
  tiles of the old build until they reload (the old file stays on the
  volume until the next refresh, so a `404` never hits a map that is open).
- `MAP_BASEMAP_FALLBACK=true|false`: without an active bundle, `true`
  serves `MAP_STYLE_LIGHT` and `MAP_STYLE_DARK` as today (OpenFreeMap by
  default, external) and keeps their origins in the CSP; `false` serves a
  style with a plain background in the page's colours and Trail's layers on
  it, and the map says "Basemap not installed yet" (the state previews are
  in for their first minutes). Phase 2 defaults to `true`, phase 3 to
  `false`.
- Nothing in the hot path is external: a dashboard session, a share page,
  a tile, a glyph, a sprite, a tile for matching inside the regions — all
  from the node.

## 4. Build and distribution pipeline

### 4.1 Where things are built

A workflow `.github/workflows/mapdata.yml`, monthly (the 1st at 04:00 UTC)
and on dispatch with a region input, one job per region of a matrix read
from `scripts/mapdata/regions.json` (`monaco`, `luxembourg`, `belgium`,
`netherlands`, `germany`, `france`, `world`; `benelux` needs the
`osmium merge` of task 2; the node's regions must be in it or come from a
hand build). Since task 2 it runs on the 1st of every month and on
dispatch (`region`: names or `all`; `extract`: a dated Geofabrik extract),
and on Monaco in pull requests that change the pipeline; each region's
build hands its artefact to the publishing job as an artefact of the run
(7 days). Each build job, on `ubuntu-24.04` (named rather than
`ubuntu-latest`, so that the `osmium` package the manifests record changes
on purpose):

1. downloads the region's PBF and `.poly` (`curl`, HTTPS, no redirect
   followed), checks the `.md5`, and reads the extract's timestamp with
   `osmium fileinfo -e`, whose UTC day is the build id (`yyyymmdd`; an
   extract without a timestamp is refused). It takes the dated file of the
   newest extract (`belgium-261027.osm.pbf`), whose `.md5` cannot change
   during the download: `-latest` redirects to it on `download.geofabrik.de`.
   Germany and Europe Geofabrik sends to one mirror instead,
   `ftp5.gwdg.de` (pinned in the script), which serves their `-latest` file
   only and no checksum: the script downloads that file from the mirror and
   checks it against the `.md5` of the dated file on Geofabrik with the same
   size and `Last-Modified` (the mirror's copy of it; the last four days are
   tried), and once more when the mirror rolled over to the next day during
   the download. `--extract yymmdd` takes a dated file from Geofabrik
   instead;
2. runs the `osmium` steps of §2.2 (Ubuntu's `osmium-tool` package);
3. runs Planetiler 0.10.2's release jar (its SHA-256 pinned in `build.sh`)
   on the runner image's Temurin 21 with `--osm_path` and the paths of its
   three sources, which `build.sh` fetches into a monthly Actions cache
   itself: Natural Earth's package and the lake centrelines' release asset
   pinned by SHA-256, the water polygons (regenerated upstream every day)
   recorded in the manifest only; Planetiler downloads nothing;
4. writes `manifest.json` (the build id, and the size and SHA-256 of every
   file and of every chunk of a file over 1 GiB, cut by `chunks.sh`) and
   `SHA256SUMS`; the publishing job pushes the artefact (§4.2) with
   `scripts/mapdata/publish.sh` and `oras push` (ORAS 1.3.6, Apache-2.0, its
   archive pinned by SHA-256), then attests it with `actions/attest` (build
   provenance), as the image is (§13.2);
5. the publishing job deletes the region's builds beyond the newest three,
   with their attestations (`scripts/mapdata/retain.sh`).

One build of a region runs at a time, and one publication of a region (a
`concurrency` group each, which cancels nothing in progress: one runs, the
next waits, and a third run of the same region cancels the waiting one). The
publishing lives in a job of its own that never runs for
`pull_request` (dispatch and the schedule only), and only that job gets
`packages: write`, `id-token: write` and `attestations: write`; the build
jobs keep the read-only token, so a pull request, a fork's included, can
build a region but never publish one. A run on `main` (the schedule's, or a
dispatch) publishes every region it built; a dispatch on another branch
publishes only the test region (`"fixture": true` in `regions.json`:
Monaco) and builds the others without publishing them, since `<region>` is
the tag every server follows and a branch nobody reviewed must not move it
(task 2's choice, like the image's `latest`, which only `main` gets). That
rule guards against mistakes, not against a collaborator: the workflow and
`regions.json` are read from the dispatched ref, so a branch can change
both. The identity that can be enforced is the attestation's signer,
`.github/workflows/mapdata.yml` at `refs/heads/main`, which servers do not
verify yet (§4.3).

Budget, measured (§10), whole jobs on the runner: Monaco 1 min, Luxembourg
2½ min, Belgium 15 min, the Netherlands 18 min, France 1 h 45 min, Germany
34 min. Germany's first build, which took its dated file from Geofabrik
itself, ran into the job's first limit of 2 h (70 min of download alone);
from the mirror (step 1) the 4.87 GB took 28 s, and the job's limit of
4 h stays as a margin. Benelux *about 35 min* (its parts, extrapolated).
The download from Geofabrik's own server is a third to a half of the other
jobs: 2–3 MB/s for Belgium and the Netherlands, 1.7 MB/s for France. All
inside the runner's disk (84 GB free; France left 73 GB, Germany 73 GB)
and the 6 h limit. Europe (35 GB) is not built
here: too long and too much disk (§3.1). `scripts/mapdata/build.sh` is the
same script the workflow runs, for a machine with `osmium-tool`, Java and
about 200 GB free (the extract, Planetiler's 140 GB of temporary files and
the output, by extrapolation; the author's Mac, `brew install osmium-tool`,
4–8 h by estimate, not measured), and `oras push` from there.

### 4.2 Artefacts

One OCI artefact per region on GHCR, `ghcr.io/jenspenneman/trail-mapdata`,
tags `<region>` (moving, the newest) and `<region>-<yyyymmdd>` (immutable),
public, so the pull is anonymous (the image is pulled the same way):

| Layer | Media type | Belgium (measured) | Europe (*extrapolated*) |
|---|---|---|---|
| `manifest.json` | `application/vnd.trail.mapdata.manifest.v1+json` | 3 KB | *3 KB* |
| `region.poly` | `application/vnd.trail.mapdata.poly.v1` | 14 KB | *200 KB* |
| `ways.opl.gz` (chunks of 1 GB, `.000`, `.001` …) | `application/vnd.trail.mapdata.ways.v1+gzip` | 134 MB | *8–10 GB* |
| `pois.geojsonseq.gz` | `application/vnd.trail.mapdata.pois.v1+gzip` | 1.6 MB | *50 MB* |
| `basemap.pmtiles` (chunks of 1 GB) | `application/vnd.trail.mapdata.basemap.v1` | 427 MB | *about 22 GB* |

The Belgian artefact is 563 MB, three quarters of it the basemap. The
first build's files are deterministic: osmium wrote the same
`ways.opl.gz` on Ubuntu (1.16) and Debian (1.18), and two runs of the
workflow wrote the same Monaco files byte for byte (only the manifest's
build time and commit differ), so an unchanged extract gives unchanged
blobs, and a node that compares blob digests downloads only the manifest.

`trail-mapdata:world` is a sixth artefact, the world overview of §3.1
(`manifest.json` and `basemap.pmtiles`, 5.3 MB), rebuilt in the same run
and pulled by every node with at least one region.

The manifest: region, Geofabrik path and extract timestamp, build time, the
building commit of Trail, tool versions, the files with sizes and SHA-256
(whole files and chunks), the attribution strings the bundle requires, the
build-time download URLs with their checksums. GHCR documents no hard
layer limit; chunks of 1 GB keep a retry cheap and stay far from any.
GitHub release assets (2 GB a file) would do for Belgium only, so they are
not used. Public packages cost nothing in storage or bandwidth.

### 4.3 How the node fetches and verifies

The worker's registry client (`apps/api/src/mapdata/registry.ts` and the
seven modules beside it that check and pull a build, about 1 500 lines with
their comments, `fetch` only): an anonymous token from `ghcr.io/token`, the
manifest by tag with the OCI media type, each blob by digest — GHCR
answers blob requests with a redirect to
`pkg-containers.githubusercontent.com`, the only redirect it follows —
streamed to `MAP_DATA_DIR/tmp/` while a SHA-256 runs over it, compared with
the digest in the manifest and the manifest's own hash, then renamed into
`MAP_DATA_DIR/regions/<region>/<build>/`. Anything else aborts the refresh,
deletes the temporary files and keeps the old build. The digest the worker
resolved is recorded in `osm_regions.digest`; `trail map status` shows it,
and an operator can compare it with the workflow's attestation on GitHub.

As built in task 2: the manifest's digest identifies a build, since the same
extract can be built twice (the dated tag then moves to the rebuild), so a
build's directory is `<yyyymmdd>-<first 8 hex of the digest>` and holds the
registry's manifest itself as `oci-manifest.json` beside build.sh's files
(no `SHA256SUMS`; `manifest.json` lists every file's and chunk's SHA-256).
The manifest's annotations `com.jenspenneman.trail.mapdata.region` and
`…build` let the client decide before it downloads anything: it pulls a
build the volume lacks when it is not older than the newest there, and
refuses a manifest over 256 KB, layers that are not the artefact's known
files (whole or in consecutive chunks; no name from a manifest becomes a
path) and more bytes than `MAP_DATA_MAX_GB` or the free space. With the
loader's tables to ask, the volume keeps the build to serve and the one
served before it; without, its two newest. The node verifies integrity —
that every byte is what the manifest the registry served says, by digest —
and not provenance: it does not fetch or check the Sigstore bundle of the
build's attestation, so `gh attestation verify` by an operator is the only
authenticity check today, and anyone who can push to the package can move
`<region>` for every server. Verifying the bundle in the worker (the
signer `.github/workflows/mapdata.yml@refs/heads/main`, the subject the
build's digest) is a task of its own.
Bandwidth, from the measured artefacts (§10): Belgium 0.56 GB a month and
the world overview's 5 MB, Benelux 1.5 GB (Belgium, the Netherlands
0.90 GB and Luxembourg 0.05 GB), Europe *about 31 GB* (extrapolated); a
preview downloads its region once per deployment (§9).

Hosts the worker speaks to: `ghcr.io`, `pkg-containers.githubusercontent.com`
(and `overpass-api.de` while the fallback is on, and ntfy). The old direct
path — the worker downloading from Geofabrik and running osmium — is not
offered: it would put a native tool in the runtime image for the one
region set the workflow cannot build, which a hand build covers.

### 4.4 The dev container and tests

- **Fixture**: `apps/api/tests/fixtures/mapdata/monaco/` holds the files of
  the Monaco artefact the workflow built in task 0, committed as built
  (670 KB: `ways.opl.gz` 241 KB with 3 677 ways and 20 535 node references,
  `pois.geojsonseq.gz` 3 KB with 117 bus stops, the station and the cruise
  terminal, `region.poly`, `basemap.pmtiles` 421 KB with 246 tiles at z0–14,
  `manifest.json`, `SHA256SUMS`), with its ODbL notice in a README. Monaco
  has a railway station, bus stops, a ferry terminal, no tram and no
  aerodrome; the aerodrome's centre is tested on a hand-made `MultiPolygon`
  feature, the shape osmium writes for every area. Its polygon follows the
  land border, so of the six z14 tiles that hold its streets only one,
  14/8530/5974, has all four corners inside (§2.5): a test journey that is
  to map without a network stays in that tile (lon 7.4268–7.4487, lat
  43.7235–43.7394), and one that crosses into the other five checks
  `outside_regions`. 36 tiles are covered in all; the other 35 are sea.
- **Unit**: the OPL and GeoJSON-seq parsers on hand-made lines and on the
  fixture (counts, kinds, a known way's node ids and geometry, the
  aerodrome's centre over all rings of a `MultiPolygon`), the tile
  membership of a way against `tileCover.ts`, the polygon test with corners
  on the border, the composite source's states, the geometry encoding round
  trip.
- **Integration**: `trail map import <dir>` on the fixture into
  `trail_test` (rows, sources, the swap, orphan deletion, a second import
  with a changed file), a journey through Monaco's streets built with
  `syntheticWorld`'s tooling over the real ways, mapped without a network;
  a window outside the polygon unmapped with `outside_regions`, waiting
  with the fixture Overpass source, re-armed by an import; the registry
  client against an in-process HTTP server that plays GHCR (token,
  manifest, redirected blobs, a wrong digest, a truncated blob, a chunk);
  the tile router on the fixture's PMTiles (headers, 204, 404, limits).
- **End to end**: the suite's server gets `MAP_DATA_DIR` pointed at the
  fixture and a bundle row, so the map loads real tiles, glyphs and
  sprites from the app's origin with no network; `stubMapStyles` keeps
  refusing every other origin, which is what proves it. The fallback is
  tested once with the stub as today.
- The dev container needs nothing new: `osmium-tool`, Java and Planetiler
  only ever run in the workflow or on a build machine. `scripts/devc.sh`
  gains nothing; the Launchway checks run as they do.

## 5. Processing integration

### 5.1 Reading ways by area

Piece planning stays as it is: `planPieces` groups moves up to 256 tiles,
`piecesToMap` keeps the moves whose tiles are available, `loadMapData`
reads the piece's ways and stops by tile. The tiles are a view over the
local tables: for a covered tile the membership rows came from the import,
for a fetched one from the cache, and `WayIndex` and the graphs are built
per piece as today. Nothing in `runPipeline.ts`, `matchToWays.ts`,
`wayIndex.ts` or `wayGraph.ts` changes; the mapped version does not bump.

### 5.2 The queue

`processWindow` asks `tileAvailability` instead of `cachedTiles`; a window
with uncovered, unfetched tiles waits only when a fetchable source exists
for them, else it finishes with those moves unmapped and the reason in
their features. `awaitTiles`, `rearmWindows`, `tilesToFetch` keep their
SQL for the Overpass cache and gain the coverage filter in JavaScript. The
15-minute pass re-arms windows a region import covered.

### 5.3 Performance targets

A commuter's window (a 30 km train or car move, 25–60 tiles, 40–90 k ways)
today: `loadMapData` 80–150 ms, the index 100–200 ms, matching 50 ms. The
read, not the matching, dominates, and the same tiles are read again every
morning. Phase 2 adds a tile cache in the worker: parsed ways and stops per
tile, an LRU of `MAP_CACHE_MB` (256) keyed by tile and source id (a refresh
invalidates by changing the id). Targets, for the load test: a window's
p50 under 300 ms and p95 under 2 s at one window a second with the cache
warm; a cold piece of 256 city tiles under 3 s; no window inside the
regions ever waits.

### 5.4 Memory

The worker: the loader 300 MB (272 MB measured on Belgium, §10), the tile
cache 256 MB, a piece up to 250 MB (the note on `NODE_OPTIONS` in
`deploy/compose.yaml`), the rest of the pipeline under 100 MB — a
container of 1.5 GB with `--max-old-space-size=1024`, and the import never
runs while a piece of 256 tiles is held (the loader waits for the window
in progress, then takes the import lock; windows resume after it). The
API: the PMTiles directory cache 10 MB (the whole directory of Belgium's
archive is 50 KB) and one open file per active bundle.

### 5.5 From the `osm_tiles` cache to regions

The cache stays as the fallback's bookkeeping (§2.4) and loses nothing in
the migration: existing rows get `source = 'overpass'`, and a window that
needed a fetched tile yesterday finds it covered today once the region is
in. When the fallback is off (phase 3), `osm_tiles` is only ever read; a
pull request after the rollout may drop it with `PROCESSING_OVERPASS_URL`
if nobody has turned the fallback on in two releases (§9).

## 6. Capacity at 1000 devices

Assumptions (the load test's parameters): 1000 devices, each about 6 moves
and 30 uploads a day, 2 h on the move, Overland's defaults; 400 people, 3
dashboard sessions a day each; Belgium imported, Overpass off.

| Quantity | Value | Note |
|---|---|---|
| Windows a day | 30 000 (0.35/s, peaks of 1/s at commute hours) | one per upload after the 3 s debounce; overlapping windows of a device merge |
| Tiles read a day | 1.5 M tile reads, 50 per window | 90 % hits in the worker's cache for commuters |
| Way rows read a day | 75 M (cold) / 8 M (warm) | about 30 B of row per way over the socket |
| Worker CPU | 0.4 s a window → 3.3 h a day, 14 % of a core, 40 % at peak | one worker suffices; the matching itself is 150 ms for 21 000 points |
| Database, map tables | 0.80 GB (Belgium, measured): `osm_ways` 505 MB (45 MB of it the key), `osm_tile_ways` 287 MB (154 MB of it the two indexes), `osm_pois` 12 MB; 1.68 GB on disk after a refresh as §2.6 describes it | the live 0.8 GB in the page cache beside a 2 GB `mem_limit` |
| Import per refresh | Belgium 46 s as a first import, 2 min 38 s as a refresh (measured, §10); Benelux *2¼ and 8 min* (extrapolated by way count) | the worker keeps processing between batches |
| Basemap requests | 72 000 tiles a day, under 1/s, bursts of 20/s | 0.3 ms a read (not measured yet, task 4); Belgium's tiles are 13 KB at the median, 56 KB at p95 and 439 KB at most (central Brussels at z14, its POIs) |
| Outbound traffic | 0.57 GB a month | the artefact (563 MB) and the world overview (5 MB); nothing per move |

What the load test should measure, besides the targets of §5.3: windows
per second until the queue grows, p95 of `loadMapData` cold and warm, the
worker's RSS over a day, Postgres buffer hits on `osm_tile_ways`, the tile
router's p95 under a burst of 100 requests, and the import's effect on the
windows processed meanwhile.

## 7. Security and privacy

- **No user coordinate leaves the node.** Today every uncached tile is a
  bounding box posted to Overpass with the server's address — the squares
  the devices passed through and when. With regions, the worker's only
  outbound requests are a registry manifest and blobs once a month, which
  tell GitHub that this node is interested in Belgium. This is worth
  stating in §12 and in `docs/transport.md` where the Overpass caveat is
  today.
- **Supply chain.** Geofabrik is reached by the workflow only, over HTTPS
  with the host pinned, the `.md5` checked (an integrity check, not a
  signature: Geofabrik signs nothing). What the workflow produces is
  attested; the node pulls by tag, verifies every blob's SHA-256 against the
  manifest and the manifest's digest, follows one known redirect, and
  refuses anything else. The build-time downloads are pinned by URL and
  SHA-256 in the repository where the file is fixed: the Planetiler jar,
  Natural Earth's package and the lake centrelines' release asset
  (`scripts/mapdata/build.sh`, which checks them before Planetiler runs),
  and the fonts and sprites (`scripts/map-assets.json`, task 4). The OSM
  water polygons are regenerated upstream every day, so their URL is fixed
  and their SHA-256 is recorded in each manifest, not pinned. The GPL tool
  runs at build time as a process; nothing of it is linked or shipped.
- **Parsing untrusted bytes.** The loader and the tile router treat the
  files as data: bounded line length (1 MB), bounded nodes per way (10 000,
  as `parseOverpassResponse`), a tile capped at 2 MB, the PMTiles header
  and directories validated by the library and the archive's tile type
  checked to be MVT.
- **Exposure.** `/map/*` is public like `/assets/*`: open data, no session,
  its own rate limit, no path traversal (routes are typed, no file name
  from the request). The CSP tightens: the map origins drop to `'self'`.
- **Logs.** A region's name and counts are logged; no tile, no position.
  The registry's URLs carry none.
- **Licences.** ODbL for the data: `© OpenStreetMap contributors` on every
  map (the style's source attribution, which MapLibre's control shows),
  `© OpenMapTiles` for the schema, in Settings › About and in the README's
  credits; a `docs/licences.md` lists the styles (MIT over BSD upstreams),
  the fonts (OFL), the sprites (CC0 icons), the tools (Apache-2.0, GPL-3.0
  at build time, BSD-3) and the data (ODbL, and Natural Earth's public
  domain for the world overview). Serving tiles to the instance's own
  users is a produced work with attribution; Trail publishes no database.

## 8. Rollout

### 8.1 Phases

1. **Regions for matching, Overpass as the fallback.** The migration, the
   loader, the registry client, `trail map`, the composite source, the
   coverage semantics, the reasons in the API and UI, the workflow for the
   regions of `regions.json`. Defaults: `MAP_DATA_REGIONS=belgium`,
   `PROCESSING_OVERPASS_URL` unchanged. After the deploy the worker pulls
   Belgium and the waiting windows clear; abroad, Overpass as before.
2. **The basemap.** Vendored styles, assets in the image, the tile router,
   the config contract, `MAP_BASEMAP_FALLBACK=true` by default, the e2e
   fixture, the worker's tile cache.
3. **Off by default.** `PROCESSING_OVERPASS_URL` defaults to empty,
   `MAP_BASEMAP_FALLBACK` to `false`, `MAP_CONNECT_SRC` to empty; the
   backup excludes the map tables; `docs/transport.md`, §12 and the README
   say what no longer leaves the node.

### 8.2 Configuration

New variables (§4 of the architecture, `envSchema.ts`, `loadConfig.ts`,
`deploy/.env.example`, `deploy/compose.yaml`, `serverEnvironment.ts`):

| Variable | Default | Meaning |
|---|---|---|
| `MAP_DATA_REGIONS` | `belgium` | Regions to keep imported, comma-separated; empty: none (fallbacks only) |
| `MAP_DATA_REGISTRY` | `ghcr.io/jenspenneman/trail-mapdata` | Where the artefacts come from; a mirror or a private registry (with the registry's credentials in `MAP_DATA_REGISTRY_TOKEN`) |
| `MAP_DATA_DIR` | `/var/lib/trail/map` | The volume `trail-map`: read-write in the worker, read-only in the API |
| `MAP_DATA_REFRESH_DAYS` | `30` | How often the worker looks for a newer build |
| `MAP_DATA_MAX_GB` | `10` | The largest build the worker downloads (added in task 2; Europe needs about 31) |
| `MAP_BASEMAP_REGION` | the first of `MAP_DATA_REGIONS` | Whose `basemap.pmtiles` the map draws |
| `MAP_BASEMAP_FALLBACK` | `true` (phase 2), `false` (phase 3) | Serve `MAP_STYLE_LIGHT`/`DARK` while no bundle is active |
| `MAP_CACHE_MB` | `256` | The worker's tile cache |
| `RATE_LIMIT_MAP_PER_MINUTE` | `3000` | `/map/*`, per IP |
| `PROCESSING_OVERPASS_URL` | unchanged, then empty (phase 3) | Tiles outside the regions only |

`MAP_STYLE_LIGHT`, `MAP_STYLE_DARK`, `MAP_CONNECT_SRC`,
`PROCESSING_OVERPASS_DAILY_MB` and `PROCESSING_OSM_TTL_DAYS` keep their
meaning for the fallbacks. `deploy/compose.yaml` adds the volume
`trail-map` to `worker` and `app` and gives `worker` the `default` network
(the way out) besides `backend`.

### 8.3 Migrations

One per pull request, in order: `osm_regions`, the `source` columns, the
compact `geometry` (with the conversion statement at the end) and the
`osm_tile_ways` key (phase 1, the first pull request); `map_bundles`
(`id`, `region`, `build_id`, `digest`, `path`, `built_at`, `active`,
`created_at`) with the tile router (phase 2). Neither touches user data;
`migrationUpgrade.test.ts` needs no new fingerprint. The conversion
statement runs over today's few thousand cached tiles in seconds.

### 8.4 The runbook (`docs/operations.md`, "Map data")

What it says, in its own words once written:

- **What runs**: the worker pulls the regions of `MAP_DATA_REGIONS` into
  the volume `trail-map` and imports them; the app serves the basemap from
  the same volume. `docker exec launchway-trail-worker-1 trail map status`
  lists every region with its build, extract date, counts, digest and
  status, and the active bundle.
- **Disk**: the table of §2.7; `du -sh` of the volume; a refresh needs the
  region twice; the database grows by the region's tables, which the daily
  dump leaves out (`--exclude-table-data='osm_*'`).
- **Refresh**: monthly by itself; `trail map refresh [<region>]` now;
  `trail map import <dir>` for a hand-built artefact (a Europe build, or a
  node without a route out: copy the directory in, import).
- **After a restore**: the map tables come back empty; run
  `trail map import` (or wait for the next refresh check, which notices
  the missing build and pulls it).
- **Changing the regions**: set `MAP_DATA_REGIONS`, redeploy; a region
  removed from the list is dropped from the tables and the volume at the
  next check; the moves that were matched on it keep their mapping.
- **Failure modes**, as troubleshooting rows: "map region refresh failed"
  (the registry unreachable, a digest mismatch, no disk: the old build
  serves on; the log names the reason); "map region import failed" (the
  loader's error; the region stays `ready` on the old build, or `failed`
  on a first import: windows inside it wait if Overpass is on, else their
  moves are unmapped with `outside_regions`); "Basemap not installed yet"
  on the map (no bundle yet: the first pull is running, or
  `MAP_DATA_REGIONS` is empty and the fallback off); the mapped level
  showing averaged lines abroad (outside the regions: add one, or turn the
  fallback on); a region older than three refresh periods (the monthly
  check keeps failing: the registry, the token, the workflow).
- **Previews**: pull their region at every deployment (Belgium 0.56 GB and a
  one-minute import); the map and the matching use the fallbacks until then
  when they are on.

### 8.5 Tasks for the builders

At most two development containers run at once on the Mac (§3), so the
work is two lanes. Every task: tests at every level that apply (§16), the
docs it touches, a threat model in the pull request, one migration at
most, and the house rules of §2 throughout.

| # | Task | Done when | Lane |
|---|---|---|---|
| 0 | **Measure.** Build the Belgium and Monaco artefacts by hand with `scripts/mapdata/build.sh` (first version); run Planetiler for Belgium on the Mac and in a throwaway workflow run; time the loader prototype on the node. Fill the tables of §2.1, §2.7, §3.1 with measured values. **Done** (§10): the script and the first version of the workflow built Monaco, Luxembourg, Belgium, the Netherlands, France and the world overview on GitHub's runner (Germany ran into the job's first time limit); Planetiler did not run on the Mac, which other agents' containers kept busy, and the loader prototype was timed there against a throwaway Postgres limited like production's (2 CPUs, 2 GB) rather than on the node | the numbers in this document are replaced by measured ones in its pull request; the Monaco fixture is committed | A (no container needed) |
| 1 | **Tables and loader.** The migration of §8.3 (phase 1), `loadWays`, `loadPois`, the geometry codec, `trail map import <dir>`, the source swap and orphan deletion | the fixture imports in under 5 s in the integration suite; counts, kinds, a known way and the aerodrome's bounding-box centre match; a second import swaps without a gap; `loadMapData` reads both sources; the conversion statement round-trips today's cache | A |
| 2 | **Workflow and registry.** `mapdata.yml` with the matrix, `oras push`, attestation, retention; the registry client with digest checks and the fake registry tests; `trail map refresh`, `status`; the refresh schedule in the worker | a dispatch run publishes `belgium`; the worker pulls it into the volume and imports it; a wrong digest and a truncated blob are refused and leave the old build; status shows the digest | B |
| 3 | **Coverage and the fallback.** `coverage.ts`, `RegionWaySource`, `CompositeWaySource`, `tileAvailability`, the queue's filters, the re-arm after an import, the reasons in features, the contracts (`map` on moves, `/api/v1/map/coverage`), the UI wording | a Monaco journey maps without a network; a move outside is unmapped with `outside_regions` and the dialog and Insights say so; with the fixture Overpass source it waits and completes; the first import re-arms waiting windows; the OpenAPI snapshot is refreshed on purpose | A, after 1 |
| 4 | **Basemap serving.** Vendored styles, `map-assets.mjs` with pinned checksums, the Dockerfile layer, `map_bundles`, the tile router, the config contract and `useMapStyle` on paths, the CSP change, `MAP_BASEMAP_FALLBACK`, the e2e fixture bundle and the suite on real tiles | the map draws Monaco from the app's origin with every other origin refused; tiles answer with the headers of §3.3; the heat placement tests import the vendored styles; a server without a bundle shows the fallback or the plain style and its notice; axe green | B, after 2 |
| 5 | **The worker's tile cache and the numbers.** The LRU, invalidation on a refresh, the load-test scenario of §6 run against a Belgium import on the node | p50/p95 of §5.3 met or the targets amended with the measured values in the docs | A, after 3 |
| 6 | **Off by default.** The defaults of phase 3, the backup's exclusion and restore step, the runbook of §8.4, §12 and `transport.md` on what no longer leaves the node, `docs/licences.md`, About's credits | a fresh install maps Belgium and draws the basemap with no outbound request but the registry; the restore drill in the runbook works on a preview | B, after 4 and 5 |

Lane A: 0 → 1 → 3 → 5. Lane B: 2 → 4 → 6. Task 2 needs the artefact
layout of task 1's loader (the OPL and GeoJSON-seq files), which task 0
fixes first, so both lanes start after task 0.

## 9. Risks and open questions

- **Europe on this node.** Extrapolated from the measured countries
  (§2.7, §10): an artefact of about 31 GB and 45 GB of tables; with the
  refresh as §2.6 measured it, about 230 GB at the peak and 160 GB steady,
  more than the node's 181 GB free; with partitions per build and the
  previous build deleted before a download, about 150 GB at the peak and
  107 GB steady. The first import takes 40–50 min, a refresh as designed
  2½ h, and the download minutes from Geofabrik's mirror (Germany's
  4.87 GB took 28 s, §10.2) rather than the 5 h from Geofabrik itself; the
  basemap cannot be built on a GitHub runner (about 5 h and 140 GB of
  temporary files). Recommendation: not now; and if Europe is wanted, build
  it by hand once a quarter and consider the Protomaps extract for its
  basemap (§3.1).
- **Border tiles.** The strict corner rule leaves a strip along every
  region border unmapped (or on Overpass). Recommendation: default to
  `belgium`, document `benelux` for anyone near the Dutch or Luxembourg
  border; a later option is the neighbour's border strip only.
- **Travel.** A trip abroad is unmapped unless Overpass is on or the
  country is listed. Recommendation: leave it to the operator; an
  automatic "add a region when a device travels there" would download a
  country because of one weekend, and §2.5's reason is honest about it.
- **Previews download 0.56 GB per deployment** (Belgium, measured).
  Launchway allows previews no shared volume (no host mounts, not
  trusted). Recommendation: accept it; `MAP_DATA_REGIONS=luxembourg`
  (51 MB) for previews where it hurts.
- **Vendored styles drift from OpenFreeMap's.** Their changes no longer
  arrive by themselves. Recommendation: that is the point (a style change
  is read in a diff); check for upstream changes when updating MapLibre.
- **The `osm_tile_ways` primary key changes** and the cache's geometry is
  rewritten: the migration touches every row of the cache. Fine today (a
  few thousand tiles); the migration is tested on a database with data
  and runs in one transaction.
- **GHCR as the only distribution path.** A node without a route out needs
  `trail map import <dir>` from a copied directory; a private fork needs a
  token. Both are documented, neither is automated.
- **Planetiler's Java and build-time downloads** in the workflow: more
  moving parts than anything else in CI, and the OpenMapTiles profile's
  own releases must be pinned. If it becomes a burden, the Protomaps
  extract is a one-line replacement for the tiles at the cost of the
  styles.
- **Fonts and sprites in the image** add 35 MB to every image; a subset of
  the glyph ranges would save most of it and lose labels abroad.
  Recommendation: ship them all; revisit if the image size ever matters.
- **Diffs instead of full downloads** for monthly refreshes: only Europe
  would notice. Recommendation: no.
- **Worker and app in one image or two** is the processing-service
  design's call; this design only needs `osmium` nowhere in the runtime
  and the volume mounted in both.
- **The world overview** rests on Planetiler filling the low zooms from
  Natural Earth and the water polygons with global bounds and a tiny OSM
  extract (§3.1). Task 0 proved half of it: 5.3 MB with oceans, ice,
  lakes and rivers everywhere, but country borders only to z4 and no
  names at all (§3.1). Recommendation: ship it as it is for phase 2 (the
  map abroad has its coastlines and, zoomed out, its borders), and route
  z0–4 to the overview even where a region archive has the tile, since a
  region's low-zoom tiles hold only what touches the region's bounding box
  (§3.1); if names and borders abroad are wanted at z5–6, the Protomaps
  planet build extracted at z0–6 (a different schema, so a few layers of
  their style for those zooms only) is the way, as planned.
- **Relief shading at the world zooms** (`ne2_shaded`) is gone from the
  vendored styles. A raster set of Natural Earth II at z0–7 is about
  100 MB and one `gdal2tiles` step; worth it only if someone misses it.
- **Dropping `osm_tiles` and the Overpass code** once the fallback has
  been off for two releases would remove 600 lines and a policy. Not
  decided; the flag stays until then.

## 10. Measured in task 0

Where the numbers of this document come from, so that the next
measurement can be compared with them.

- **Builds**: `scripts/mapdata/build.sh` in the first version of the Map
  data workflow, on GitHub's `ubuntu-24.04` runner (4 vCPU, 15.6 GiB, 84 GB
  free disk), with osmium-tool 1.16.0 (libosmium 2.20.0, Ubuntu's package),
  Planetiler 0.10.2 on Temurin 25.0.5+8 (the workflow has used the runner
  image's Temurin 21 since), from Geofabrik's extracts of
  27 October 2026 (OSM data up to 21:24 UTC), on 28 October 2026: runs
  40650464005 (Belgium and the world overview), 40652475332 (Luxembourg,
  the Netherlands, France), 40653352974 (Germany, cancelled at the job's
  first limit of two hours) and 40652466713 (Monaco); the fixture of §4.4
  comes from run 40673177968 of the final script, the same files byte for
  byte with a new manifest.
- **Loader**: a prototype of §2.2 (Node 24, `pg-copy-streams` 7.0, the
  app's `classifyWay` and `classifyPoi`, batches of 5 000 rows, `COPY` into
  the tables of §2.4, then the keys and indexes with `maintenance_work_mem`
  512 MB) on the author's Mac against a throwaway `postgres:18-alpine`
  limited to 2 CPUs and 2 GB like production's `mem_limit`, while other
  agents' test suites kept the Mac busy (load average 10–20): its times
  are an upper bound for the node. The prototype is not in the repository;
  task 1 writes the loader.

### 10.1 Extracts and the data for matching

| Region | PBF | Ways in the extract | Ways kept | Node references | Stops | `ways.opl.gz` | `pois.geojsonseq.gz` | z14 tiles covered |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `monaco` | 0.7 MB | 6.3 k | 3.7 k | 20.5 k | 119 | 241 KB | 3 KB | 36 |
| `luxembourg` | 47.8 MB | 612.0 k | 143.5 k | 1.15 M | 5 044 | 14.2 MB | 145 KB | 957 |
| `belgium` | 698 MB | 11.48 M | 1.53 M | 10.75 M | 62 380 | 134 MB | 1.6 MB | 13 203 |
| `netherlands` | 1.41 GB | 18.71 M | 2.86 M | 18.10 M | 44 530 | 217 MB | 1.1 MB | 25 007 |
| `germany` (task 2's build, §10.2) | 4.87 GB | 71.43 M | 16.63 M | 111.39 M | 428 790 | 1.38 GB | 12.0 MB | 165 776 |
| `france` | 5.11 GB | 73.61 M | 12.58 M | 123.25 M | 260 386 | 1.44 GB | 7.0 MB | 276 286 |
| `benelux` (*its parts*) | *2.15 GB* | *30.80 M* | *4.54 M* | *30.01 M* | *111 954* | *365 MB* | *2.8 MB* | 39 445 |
| `europe` (*extrapolated*) | 35.3 GB | — | *80–100 M* | *650–800 M* | *1.8 M* | *8–10 GB* | *50 MB* | — |

Ways kept are those of §2.3: 13 % of an extract's ways in Belgium, 15 % in
the Netherlands, 17 % in France, 23 % in Germany and Luxembourg (buildings
are most of the rest; the estimate was 20 %), with 6–7 node references a way
in Belgium and the Netherlands, 10 in France. Stops are mostly bus stops
(Belgium: 60 014 of 62 380; 49 aerodromes, 43 of them areas). Covered tiles
follow §2.5 on Geofabrik's polygons, which include territorial waters.
Germany's first build was cancelled before its files and counts were
written (§10.2); its row is task 2's build of the same extract (run
40679475825), 87.9 M distinct nodes for its 111 M references. *Italics* are
extrapolated: Benelux is the sum of its three parts (its own extract would
hold the ways on their borders once), Europe scales the measured countries
by its 35.3 GB extract, between France's 2.5 M kept ways a gigabyte and
Germany's 3.4 M.

### 10.2 The build on the runner

| Region | Job | Download | osmium | Planetiler | Planetiler's memory | Temporary files | `basemap.pmtiles` |
|---|---:|---:|---:|---:|---|---:|---:|
| `monaco` | 1 min 6 s | 1 s | < 1 s | 34 s | `-Xmx2g`, 1.2 GB in use, 1.8 GB resident | 0.8 GB | 421 KB |
| `luxembourg` | 2 min 34 s | 29 s | 7 s | 1 min 4 s | `-Xmx2g`, 1.4 GB in use, 2.1 GB resident | 0.8 GB | 36.1 MB |
| `belgium` | 15 min | 5 min 18 s | 1 min 15 s | 7 min 49 s | `-Xmx3g`, 2.0 GB in use, 4.7 GB resident | 2.8 GB | 427 MB |
| `netherlands` | 17 min | 7 min 58 s | 1 min 24 s | 7 min 1 s | `-Xmx4g`, 2.3 GB in use, 6.5 GB resident | 5.1 GB | 679 MB |
| `germany` | 34 min (the first build: cancelled at the 2 h limit) | 28 s from the mirror (70 min 34 s from Geofabrik) | 6 min 38 s | 23 min 55 s | `-Xmx8g`, 3.7 GB in use, 9.2 GB resident | 19.4 GB | 3.13 GB |
| `france` | 1 h 45 min | 50 min | 9 min 40 s | 41 min | `-Xmx8g`, 4.2 GB in use, 9.0 GB resident | 20.6 GB | 3.47 GB |
| `world` | 1 min 48 s | 1 s | — | 1 min 18 s | `-Xmx3g`, 1.3 GB in use, 2.2 GB resident | 0.8 GB | 5.3 MB |

The download is Geofabrik's, at 1.2–3 MB/s from the runner, except
Germany's from the mirror at about 175 MB/s (task 2's build, run
40679475825, which publishes nothing from a branch); osmium is the five
steps of §2.2 together (`tags-filter` takes 2 GB whatever the region: 17 s
for Belgium, 1 min 19 s to 2 min for France and Germany); Germany's first
job ran into the first version's limit of two hours, now four, and the
build of task 2 wrote `ways.opl.gz` in 2 chunks and `basemap.pmtiles` in 3,
an artefact of 4.5 GB. Planetiler's time includes
reading Natural Earth and the water polygons (25–30 s, from the Actions
cache; the first run of a month fetches them in about a minute) and, for
Belgium, that first fetch. Its memory is the `-Xmx` given, the most heap in
use, and the process's peak resident memory, which counts the memory-mapped
node locations and features (`--storage=mmap`, Planetiler's default). The
profile alone fills about 1.1 GB of heap even for Monaco, whose build with
`-Xmx1g` ran at a full heap; `regions.json` therefore gives the small
regions 2 GB.

### 10.3 The loader prototype on Belgium

| Step | Time | Rows | Rate |
|---|---:|---:|---:|
| parse, classify, tile membership, `COPY` (batches of 5 000) | 26.2 s | 1 534 499 ways + 1 726 829 memberships | 58 500 ways/s, 124 000 rows/s |
| … of it waiting for Postgres | 15.3 s | | |
| … parsing, classifying and tile membership alone (no database) | 4.0 s | | 385 000 ways/s |
| stops | 0.6 s | 62 380 | |
| primary keys, indexes, foreign key | 14.8 s | | |
| `VACUUM ANALYZE` | 4.5 s | | |
| first import in all | 46 s | | 72 000 rows/s |
| a refresh to identical data (§2.6) | 2 min 38 s | | |

The loader's resident memory peaked at 272 MB (92 MB without the database;
Monaco: 88 MB). Belgium's longest OPL line is 19 904 characters, its longest
way 607 nodes and 458 tiles, far inside the bounds of §7; `ways.opl.gz`
unpacks to 422 MB. Table sizes after the first import: `osm_ways` 505 MB
(329 B a way), `osm_tile_ways` 287 MB (166 B a membership; 228 MB with a
`smallint` source), `osm_pois` 12 MB; 0.80 GB in all, 1.9 GB for the whole
data directory with the write-ahead log. After one refresh and its vacuum:
1.68 GB of tables, 2.8 GB of data directory. A second refresh was cut short
when a second development container started on the Mac (the throwaway
database runs only while fewer than two do); on Monaco the second refresh
reused the freed space. Monaco itself imports in 0.3 s.

### 10.4 What the measurements changed

1. **Bigger than estimated.** Belgium's extract is 0.70 GB (0.5), its
   basemap 427 MB (250), its artefact 563 MB (400); fewer node
   references (10.8 M, not 15 M) and membership rows (1.73 M, not 2 M),
   but 166 B each (not 110 B). §2.1, §2.4, §2.7, §3.1, §4.2, §4.3, §6.
2. **The loader is fast; the refresh is not.** A first import of Belgium
   takes 46 s (the estimate was 3 min of `COPY` and indexes), a refresh
   2 min 38 s, and the refresh as designed leaves the tables at twice
   their size for good; partitions per build are the fix (§2.6).
3. **Coverage.** The four-corner rule must test corners against the union
   of the ready regions, or adjacent regions leave their shared border
   uncovered (286 tiles in Benelux); and the Monaco fixture has one
   covered street tile of six (§2.5, §4.4).
4. **The world overview** is 5.3 MB, not 80 MB, and has borders only to
   z4 and no names (§3.1); region archives' low-zoom tiles hold only
   what touches their bounding box, so the tile router serves z0–4 from
   the overview (§3.1).
5. **Geofabrik.** Germany's and Europe's `-latest` names redirect to a
   mirror and have no `.md5`; the script takes the dated file from
   Geofabrik itself (§4.1). Downloads run at 1.2–3 MB/s from the runner,
   so the big countries' jobs are long: France 1 h 45 min (50 min of
   download), Germany cancelled at the first version's limit of 2 h
   (70 min of download); the limit is now 4 h. Task 2 takes Germany's and
   Europe's file from the mirror, checked against the dated `.md5` on
   Geofabrik: 28 s for Germany, whose job then took 34 min (§4.1); Europe's
   35 GB would take minutes too, which leaves its Planetiler run as what
   no runner can do.
6. **osmium.** OPL carries way-node coordinates only with
   `locations_on_ways=true`; `tags-filter` with its referenced objects
   needs 1.3–2 GB of memory for any region; areas from `osmium export`
   get `a` ids, so the loader reads `@type` and `@id`; an aerodrome
   becomes the centre of its bounding box, as with Overpass (§2.2).
7. **Versions.** Planetiler is at 0.10.2 (OpenMapTiles 3.16), not 0.9;
   Ubuntu 24.04 packages osmium-tool 1.16, not 1.18.
8. **Europe does not fit the node** with the refresh as designed (about
   230 GB at the peak, 181 GB free); with partitions it narrowly does
   (about 150 GB). The estimate was 100 GB (§2.7, §9).
