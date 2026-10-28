# Design: self-hosted map data and basemap

Status: proposal, October 2026. Nothing here is built yet; the sections of
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
| What "covered" means | A z14 tile whose four corners lie inside an imported region's polygon. Outside: Overpass when configured, else the move stays unmapped and the API and UI say why |
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
| `luxembourg` | 0.04 GB | 0.1 M | 1 M | 1.1 k |
| `belgium` | 0.5 GB | 1.4 M | 15 M | 13 k |
| `netherlands` | 1.4 GB | 3.0 M | 35 M | 18 k |
| `benelux` (the three merged) | 2.0 GB | 4.5 M | 50 M | 32 k |
| `germany` | 4.3 GB | 12 M | 130 M | 150 k |
| `france` | 4.6 GB | 11 M | 120 M | 200 k |
| `europe` | 29 GB | 75 M | 900 M | 4.3 M |

The counts are estimates from the planet's ratios (about 20 % of OSM ways
are highways; a PBF gigabyte holds about 120 M nodes); task 0 measures
Belgium exactly. Default: `MAP_DATA_REGIONS=belgium`. A Benelux household
sets `benelux`; a region is one artefact (§4.2), and several may be listed.
Monaco (1 MB) is the test fixture (§4.5).

Cadence: Geofabrik rebuilds daily; Trail refreshes monthly
(`MAP_DATA_REFRESH_DAYS=30`). Roads change slowly, and a refresh never
reprocesses history (§2.6). Daily diffs (`belgium-updates/`, applied with
`osmium apply-changes`) would cut the monthly download from 0.5 GB to about
100 MB for Belgium, but need the previous full file and a rewrite of it; not
worth it below Europe (§9).

Alternatives considered: the planet file (80 GB, no); BBBike's custom
extracts (hand-drawn areas, weekly, no polygons to test coverage against);
Overpass itself for a one-off area download (the thing this design leaves);
OpenStreetMap's own servers (no extracts).

### 2.2 Importer

Four ways to turn a PBF into Trail's tables were compared for the node
(12 vCPU Docker VM, 8.25 GB, laptop SSD):

| Option | Belgium | Europe | RAM | Disk | Fit |
|---|---|---|---|---|---|
| Node parser on `pbf` 5.x (BSD-3; the two OSM `.proto` files compiled with its generator), two passes, node locations in typed arrays | ~ 3 min | impossible in RAM (900 M node references need a disk-backed store: external sorting written by hand) | 15 M references × 16 B = 240 MB; Benelux 0.8 GB | the PBF | pure Node, no tool; caps at Benelux-sized regions |
| `osm-pbf-parser` 2.3 (MIT), `osm-read` (BSD-2) | as above | as above | as above | — | unmaintained since 2018 and 2016 |
| **`osmium-tool` 1.18** (GPL-3.0-or-later, Jochen Topf; `libosmium` is Boost-licensed) as a subprocess at build time: `tags-filter`, `add-locations-to-ways`, `cat -f opl`, `export` | ~ 1 min | ~ 45 min with `--index-type=sparse_file_array` (14 GB index file) | 300 MB (Belgium, in-memory index) | 2× the filtered file | the reference implementation; a native binary, so it runs where the artefacts are built, never in the runtime image |
| `osm2pgsql` 2.x (GPL-2.0) or `imposm3` (Apache-2.0) | ~ 5 min | ~ 3 h | 2–8 GB | PostGIS tables | both need PostGIS (§2.4); their tables are not Trail's |
| Planetiler 0.9 custom profile (Apache-2.0, Java) | ~ 3 min | hours | 3–16 GB | tiles | writes vector tiles, which clip ways at tile edges and drop node ids: the graph needs both |

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
# the ways Trail keeps (overpassQuery.ts, the same filter), with the nodes they reference
osmium tags-filter "$pbf" w/highway w/railway=rail,light_rail,tram,subway,narrow_gauge,funicular w/route=ferry -o ways.osm.pbf
osmium add-locations-to-ways ways.osm.pbf -o ways-with-locations.osm.pbf    # node coordinates into the ways, untagged nodes dropped
osmium cat ways-with-locations.osm.pbf -f opl | gzip -6 > ways.opl.gz       # one line per way: tags, node ids with coordinates
# the stops and airports (classifyPoi.ts): points, and aerodrome polygons for their centres
osmium tags-filter "$pbf" n/railway=station,halt,tram_stop n/highway=bus_stop n/amenity=ferry_terminal nwr/aeroway=aerodrome -o pois.osm.pbf
osmium export pois.osm.pbf -f geojsonseq --geometry-types=point,polygon --add-unique-id=type_id | gzip -6 > pois.geojsonseq.gz
```

OPL is osmium's line format: `w123 … Thighway=residential,name=… Nn1x4.35y50.85,n2x…`,
with `%xx%` escapes in tags. The loader (`apps/api/src/mapdata/loadWays.ts`)
streams `ways.opl.gz` through `zlib`, classifies every way with
`classifyWay` (the kept tags of `parseOverpassResponse`, the same `kind`;
`null` drops it), computes its bounding box and the z14 tiles its segments
pass through (`forEachCell` of `wayIndex.ts` in tile space), and writes
batches of 5 000 rows with `COPY … FROM STDIN` (`pg-copy-streams` 7.x, MIT,
pure JavaScript; today's `jsonb_to_recordset` inserts are three to five
times slower at this volume). `pois.geojsonseq.gz` goes the same way: a
point keeps its position, an aerodrome polygon becomes its centroid, the
id is `n…`, `w…` or `r…` as Overpass's `out center` gives it (large
airports are often multipolygon relations).

Memory: the loader holds one batch and the region's polygon; the tile
membership of a way is computed from its own geometry, so nothing
accumulates. Belgium: under 300 MB; the same for Europe, which is why the
loader can run in the worker beside processing (§5.4). Time on the node,
measured against task 0: Belgium about 4 min (1 min download, 2 min `COPY`,
1 min indexes); Benelux about 12 min; Europe 2½–4 h, most of it `COPY` and
the index builds (`SET maintenance_work_mem = '512MB'` for the session).

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
| **Tile index** (today's `osm_tile_ways`): membership rows per z14 tile, computed at import | PK lookups per tile, as `loadMapData` does now | 2 M rows for Belgium, 110 M for Europe (110 B each) | keeps `planPieces`, `pieceMaxTiles`, `missing_tiles`, `FixtureWaySource` and every test as they are |
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

Sizes at about 330 B per way and 110 B per membership row, indexes
included: Belgium 0.8 GB, Benelux 2.7 GB, Germany 7 GB, Europe 40 GB.
Today's cache tables hold a few thousand tiles, so the migration converts
them in place (a statement at its end; the cache is rebuildable either way).

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
  household near a border lists the neighbour.
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
the registry) and in the database:

| Regions | Artefacts on the volume (ways + basemap) | Database | Peak during a refresh | Steady |
|---|---|---|---|---|
| `belgium` | 0.4 GB | 0.8 GB | 2.4 GB | 1.2 GB |
| `benelux` | 1.4 GB | 2.7 GB | 7 GB | 4 GB |
| `belgium,germany` | 4 GB | 8 GB | 20 GB | 12 GB |
| `europe` | 21 GB | 40 GB | 100 GB | 60 GB |

Europe fits this node once, with a refresh that needs 100 GB free; it is
supported, not the default, and §9 says what it costs in time. RAM: the
loader 300 MB in the worker; the API's tile serving a few MB (the PMTiles
directory cache, §3.4); Postgres unchanged at 2 GB (`shared_buffers` of the
image's default serves the hot tiles; `osm_tile_ways` of Belgium is 220 MB).

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
| Build | Planetiler 0.9 (Apache-2.0, Java 21) with the `planetiler-openmaptiles` profile (Apache-2.0; the schema is OpenMapTiles, CC-BY 4.0): one run per region, `--output=basemap.pmtiles --maxzoom=14` | none: `pmtiles extract https://build.protomaps.com/<date>.pmtiles --bbox=…` (go-pmtiles 1.2x, BSD-3) pulls the region's tiles from their daily planet build with range requests |
| Belgium | 8 min, `-Xmx3g`, 250 MB | 3 min, no RAM, 250 MB (maxzoom 15) |
| Europe | 4–8 h, 16 GB or `--storage=mmap` with 70 GB of disk; not on a GitHub runner | about an hour, bandwidth-bound, 13 GB |
| Styles | the current ones: OpenFreeMap's `liberty` and `dark` work unchanged with their source pointed at Trail — and the same style serves the OpenFreeMap fallback | `@protomaps/basemaps` (BSD-3) flavours `light` and `dark`: a different look, a second style set for the fallback, the heat and track layer placement tests redone |
| Attribution | `© OpenMapTiles © OpenStreetMap contributors` | `© Protomaps © OpenStreetMap contributors` |
| Build-time downloads | Geofabrik, Natural Earth, OSM water polygons and lake centrelines (about 1.5 GB, cached) | the planet build (served by Protomaps) |

Decision: Planetiler and the OpenMapTiles schema. Keeping one style set for
the self-hosted tiles and the fallback is what makes the fallback a flag
rather than a second map, and the screenshots, the heat placement
(`heatLayerPlacement.ts`, tested on both OpenFreeMap styles as served) and
the contrast numbers of §14 stay valid. Protomaps is the way out if the
Planetiler build ever becomes a burden, and the answer for a Europe basemap
without a build machine (§9).

Build numbers on a GitHub runner (4 vCPU, 16 GB, about 25 GB free disk,
6 h per job), to be measured in task 0:

| Region | Planetiler time | Heap | Temp disk | `basemap.pmtiles` |
|---|---|---|---|---|
| `luxembourg` | 2 min | 2 GB | 0.5 GB | 30 MB |
| `belgium` | 8 min | 3 GB | 2 GB | 250 MB |
| `netherlands` | 15 min | 4 GB | 4 GB | 600 MB |
| `benelux` (`osmium merge` first) | 25 min | 5 GB | 6 GB | 900 MB |
| `germany`, `france` | 60–75 min | 8 GB | 12 GB | 2.5 GB |
| `europe` | not on the runner | | | 13 GB |

Zoom 14 is the schema's native maximum (OpenFreeMap serves z0–14 too);
MapLibre overzooms to 19 from there, as it does today.

**Outside the region.** Planetiler writes tiles for the extract's bounding
box only, at every zoom: a Belgian archive has nothing for a holiday in
Spain, and the map there would be Trail's tracks on a plain background.
Two measures:

- a **world overview**, one archive for every region set,
  `trail-mapdata:world` (built in the same workflow with Planetiler from
  the Monaco extract and `--bounds=world --maxzoom=6`, so that the layers
  the profile fills from Natural Earth and the OSM water polygons — oceans,
  coastlines, country boundaries, large lakes — cover the globe without
  OSM detail; about 80 MB; task 0 verifies the profile does this). The
  tile router answers from the region archive when it has the tile, else
  from the world archive, else 204. Abroad the map then shows countries
  and coastlines, not streets; the fallback flag of §3.5 is for whoever
  wants OpenFreeMap's detail everywhere.
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
| `GET /map/tiles/<build>/{z}/{x}/{y}.pbf` | the tile read from `basemap.pmtiles` with the `pmtiles` package 4.x (BSD-3; a `Source` over `fs.promises.FileHandle.read`, its directory cache sized to about 10 MB); `Content-Type: application/x-protobuf`, `Content-Encoding: gzip` passed through as Planetiler wrote it; 204 for a tile the archive has none of; 404 for a build that is not active | `public, max-age=31536000, immutable` (the build id is in the path) |
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
from `scripts/mapdata/regions.json` (`luxembourg`, `belgium`, `netherlands`,
`benelux`, `germany`, `france`; the node's regions must be in it or come
from a hand build). Each job, on `ubuntu-latest`:

1. downloads the region's PBF and `.poly` from Geofabrik (`curl` with a
   pinned host, no redirects off it), checks the `.md5`, reads the extract's
   timestamp with `osmium fileinfo -e`;
2. runs the `osmium` steps of §2.2 (Ubuntu's `osmium-tool` package);
3. runs Planetiler from its pinned image
   (`ghcr.io/onthegomap/planetiler@sha256:…`) with `--osm-path` and the
   Natural Earth and water-polygon downloads from a monthly cache;
4. writes `manifest.json` and pushes the artefact (§4.2) with
   `oras push` (ORAS 1.3, Apache-2.0), then signs it with
   `actions/attest-build-provenance`, as the image gets (§13.2);
5. deletes versions older than the last three of the region.

Budget: Belgium 12 min, Benelux 30 min, Germany 80 min, all inside the
runner's disk and the 6 h limit. Europe is not built here: too long and too
much disk. `scripts/mapdata/build.sh` is the same script the workflow runs,
for a machine with `osmium-tool`, Java and 70 GB free (the author's Mac,
`brew install osmium-tool`, at 4–8 h), and `oras push` from there.

### 4.2 Artefacts

One OCI artefact per region on GHCR, `ghcr.io/jenspenneman/trail-mapdata`,
tags `<region>` (moving, the newest) and `<region>-<yyyymmdd>` (immutable),
public, so the pull is anonymous (the image is pulled the same way):

| Layer | Media type | Belgium | Europe |
|---|---|---|---|
| `manifest.json` | `application/vnd.trail.mapdata.manifest.v1+json` | 2 KB | 2 KB |
| `region.poly` | `application/vnd.trail.mapdata.poly.v1` | 10 KB | 200 KB |
| `ways.opl.gz` (chunks of 1 GB, `.000`, `.001` …) | `application/vnd.trail.mapdata.ways.v1+gzip` | 150 MB | 8 GB |
| `pois.geojsonseq.gz` | `application/vnd.trail.mapdata.pois.v1+gzip` | 3 MB | 150 MB |
| `basemap.pmtiles` (chunks of 1 GB) | `application/vnd.trail.mapdata.basemap.v1` | 250 MB | 13 GB |

`trail-mapdata:world` is a sixth artefact, the world overview of §3.1
(`manifest.json` and `basemap.pmtiles`, about 80 MB), rebuilt in the same
run and pulled by every node with at least one region.

The manifest: region, Geofabrik path and extract timestamp, build time, the
building commit of Trail, tool versions, the files with sizes and SHA-256
(whole files and chunks), the attribution strings the bundle requires, the
build-time download URLs with their checksums. GHCR documents no hard
layer limit; chunks of 1 GB keep a retry cheap and stay far from any.
GitHub release assets (2 GB a file) would do for Belgium only, so they are
not used. Public packages cost nothing in storage or bandwidth.

### 4.3 How the node fetches and verifies

The worker's registry client (`apps/api/src/mapdata/registry.ts`, about
150 lines, `fetch` only): an anonymous token from `ghcr.io/token`, the
manifest by tag with the OCI media type, each blob by digest — GHCR
answers blob requests with a redirect to
`pkg-containers.githubusercontent.com`, the only redirect it follows —
streamed to `MAP_DATA_DIR/tmp/` while a SHA-256 runs over it, compared with
the digest in the manifest and the manifest's own hash, then renamed into
`MAP_DATA_DIR/regions/<region>/<build>/`. Anything else aborts the refresh,
deletes the temporary files and keeps the old build. The digest the worker
resolved is recorded in `osm_regions.digest`; `trail map status` shows it,
and an operator can compare it with the workflow's attestation on GitHub.
Bandwidth: Belgium 400 MB a month, Benelux 1.4 GB, Europe 21 GB; a preview
downloads its region once per deployment (§9).

Hosts the worker speaks to: `ghcr.io`, `pkg-containers.githubusercontent.com`
(and `overpass-api.de` while the fallback is on, and ntfy). The old direct
path — the worker downloading from Geofabrik and running osmium — is not
offered: it would put a native tool in the runtime image for the one
region set the workflow cannot build, which a hand build covers.

### 4.4 The dev container and tests

- **Fixture**: `apps/api/tests/fixtures/mapdata/monaco/` holds the files of
  a Monaco artefact built once by the script and committed (about 1 MB
  PBF-derived: 150 KB of ways, 20 KB of POIs, a `.poly`, a `basemap.pmtiles`
  of 400 KB with `--maxzoom=14`, a manifest), with its ODbL notice. Monaco
  has a railway station, bus stops and no tram, and its polygon is small
  enough to list every covered tile by hand; the aerodrome centroid is
  tested on a hand-made polygon.
- **Unit**: the OPL and GeoJSON-seq parsers on hand-made lines and on the
  fixture (counts, kinds, a known way's node ids and geometry, the
  aerodrome centroid), the tile membership of a way against
  `tileCover.ts`, the polygon test with corners on the border, the
  composite source's states, the geometry encoding round trip.
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

The worker: the loader 300 MB, the tile cache 256 MB, a piece up to 250 MB
(the note on `NODE_OPTIONS` in `deploy/compose.yaml`), the rest of the
pipeline under 100 MB — a
container of 1.5 GB with `--max-old-space-size=1024`, and the import never
runs while a piece of 256 tiles is held (the loader waits for the window
in progress, then takes the import lock; windows resume after it). The
API: the PMTiles directory cache 10 MB and one open file per active bundle.

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
| Database, map tables | 0.8 GB (Belgium): `osm_ways` 460 MB, `osm_tile_ways` 220 MB, PKs 150 MB | all in the page cache beside a 2 GB `mem_limit` |
| Import per refresh | Belgium 4 min, Benelux 12 min | the worker keeps processing between batches |
| Basemap requests | 72 000 tiles a day, under 1/s, bursts of 20/s | 0.3 ms a read, 10–150 KB a tile |
| Outbound traffic | 400 MB a month | the artefact; nothing per move |

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
  attested; the node pulls by tag, verifies every blob's SHA-256 against
  the manifest and the manifest's digest, follows one known redirect, and
  refuses anything else. The build-time downloads (Natural Earth, water
  polygons, the fonts and sprites) are pinned by URL and checksum in the
  repository. The GPL tool runs at build time as a process; nothing of it
  is linked or shipped.
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
- **Previews**: pull their region at every deployment (400 MB, 5 min); the
  map and the matching use the fallbacks until then when they are on.

### 8.5 Tasks for the builders

At most two development containers run at once on the Mac (§3), so the
work is two lanes. Every task: tests at every level that apply (§16), the
docs it touches, a threat model in the pull request, one migration at
most, and the house rules of §2 throughout.

| # | Task | Done when | Lane |
|---|---|---|---|
| 0 | **Measure.** Build the Belgium and Monaco artefacts by hand with `scripts/mapdata/build.sh` (first version); run Planetiler for Belgium on the Mac and in a throwaway workflow run; time the loader prototype on the node. Fill the tables of §2.1, §2.7, §3.1 with measured values | the numbers in this document are replaced by measured ones in its pull request; the Monaco fixture is committed | A (no container needed) |
| 1 | **Tables and loader.** The migration of §8.3 (phase 1), `loadWays`, `loadPois`, the geometry codec, `trail map import <dir>`, the source swap and orphan deletion | the fixture imports in under 5 s in the integration suite; counts, kinds, a known way and the aerodrome centroid match; a second import swaps without a gap; `loadMapData` reads both sources; the conversion statement round-trips today's cache | A |
| 2 | **Workflow and registry.** `mapdata.yml` with the matrix, `oras push`, attestation, retention; the registry client with digest checks and the fake registry tests; `trail map refresh`, `status`; the refresh schedule in the worker | a dispatch run publishes `belgium`; the worker pulls it into the volume and imports it; a wrong digest and a truncated blob are refused and leave the old build; status shows the digest | B |
| 3 | **Coverage and the fallback.** `coverage.ts`, `RegionWaySource`, `CompositeWaySource`, `tileAvailability`, the queue's filters, the re-arm after an import, the reasons in features, the contracts (`map` on moves, `/api/v1/map/coverage`), the UI wording | a Monaco journey maps without a network; a move outside is unmapped with `outside_regions` and the dialog and Insights say so; with the fixture Overpass source it waits and completes; the first import re-arms waiting windows; the OpenAPI snapshot is refreshed on purpose | A, after 1 |
| 4 | **Basemap serving.** Vendored styles, `map-assets.mjs` with pinned checksums, the Dockerfile layer, `map_bundles`, the tile router, the config contract and `useMapStyle` on paths, the CSP change, `MAP_BASEMAP_FALLBACK`, the e2e fixture bundle and the suite on real tiles | the map draws Monaco from the app's origin with every other origin refused; tiles answer with the headers of §3.3; the heat placement tests import the vendored styles; a server without a bundle shows the fallback or the plain style and its notice; axe green | B, after 2 |
| 5 | **The worker's tile cache and the numbers.** The LRU, invalidation on a refresh, the load-test scenario of §6 run against a Belgium import on the node | p50/p95 of §5.3 met or the targets amended with the measured values in the docs | A, after 3 |
| 6 | **Off by default.** The defaults of phase 3, the backup's exclusion and restore step, the runbook of §8.4, §12 and `transport.md` on what no longer leaves the node, `docs/licences.md`, About's credits | a fresh install maps Belgium and draws the basemap with no outbound request but the registry; the restore drill in the runbook works on a preview | B, after 4 and 5 |

Lane A: 0 → 1 → 3 → 5. Lane B: 2 → 4 → 6. Task 2 needs the artefact
layout of task 1's loader (the OPL and GeoJSON-seq files), which task 0
fixes first, so both lanes start after task 0.

## 9. Risks and open questions

- **Europe on this node.** It fits once (60 GB steady, 100 GB at a refresh)
  and the import takes hours during which the worker is busy; the basemap
  cannot be built on a GitHub runner. Recommendation: not now; measure
  Benelux first, and if Europe is wanted, build it by hand once a quarter
  and consider the Protomaps extract for its basemap (§3.1).
- **Border tiles.** The strict corner rule leaves a strip along every
  region border unmapped (or on Overpass). Recommendation: default to
  `belgium`, document `benelux` for anyone near the Dutch or Luxembourg
  border; a later option is the neighbour's border strip only.
- **Travel.** A trip abroad is unmapped unless Overpass is on or the
  country is listed. Recommendation: leave it to the operator; an
  automatic "add a region when a device travels there" would download a
  country because of one weekend, and §2.5's reason is honest about it.
- **Previews download 400 MB per deployment.** Launchway allows previews
  no shared volume (no host mounts, not trusted). Recommendation: accept
  it; `MAP_DATA_REGIONS=luxembourg` for previews where it hurts.
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
  extract (§3.1); task 0 proves it. If it does not, the Protomaps planet
  build extracted at z0–6 (a different schema, so a few layers of their
  style for those zooms only) is the fallback, and until then the map
  abroad is tracks on a plain background with the fallback flag off.
- **Relief shading at the world zooms** (`ne2_shaded`) is gone from the
  vendored styles. A raster set of Natural Earth II at z0–7 is about
  100 MB and one `gdal2tiles` step; worth it only if someone misses it.
- **Dropping `osm_tiles` and the Overpass code** once the fallback has
  been off for two releases would remove 600 lines and a policy. Not
  decided; the flag stays until then.
