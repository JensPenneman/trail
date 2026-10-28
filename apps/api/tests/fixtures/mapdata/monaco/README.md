# Monaco map data (test fixture)

The files of a Trail map data artefact for Monaco, as `scripts/mapdata/build.sh
monaco` writes them (docs/design/self-hosted-maps.md, §2.2, §3.1 and §4.4),
kept here so that the loader, the coverage rules, the tile router and the
end-to-end suite have real OpenStreetMap data and real tiles without a
network. Built on 28 October 2026 (10:36 UTC) by the Map data workflow
(`.github/workflows/mapdata.yml`, run 40673177968,
https://github.com/JensPenneman/trail/actions/runs/40673177968) at commit
5219f04, from Geofabrik's extract `monaco-261027.osm.pbf` (OSM data up to
2026-10-27T21:23:59Z). The data files are the same, byte for byte, as those
of the first build (run 40652466713); only the manifest's build time,
commit and Java differ.

| File | Contents | Bytes |
|---|---|---:|
| `ways.opl.gz` | 3 677 ways (highways, railways, the ferry route) with the tags Trail keeps and 20 535 node references with coordinates, one OPL line each | 240 517 |
| `pois.geojsonseq.gz` | 119 stops: 117 bus stops, the railway station Monaco - Monte Carlo and the cruise terminal (`amenity=ferry_terminal`); no aerodrome | 3 306 |
| `region.poly` | Geofabrik's polygon of the extract (Monaco's land border and its waters) | 635 |
| `basemap.pmtiles` | vector tiles z0–14, OpenMapTiles schema 3.16.0, gzipped MVT, 246 tiles over the extract's bounding box | 421 415 |
| `manifest.json` | the region, the extract, the build, the tools, the counts, attribution, licences, and every file's size and SHA-256 (Planetiler's sources marked `pinned` or not) | 3 287 |
| `SHA256SUMS` | the checksums, for `sha256sum -c SHA256SUMS` | |

Facts the tests can rely on:

- `classifyWay` gives the ways these kinds: footway 2 382, service 400,
  residential 319, secondary 215, primary 149, tertiary 148, path 39,
  other 13, rail 11, ferry 1. None is malformed or unclassified.
- The streets lie in six z14 tiles (x 8528–8530, y 5973–5975). Only one of
  them, 14/8530/5974, has all four corners inside `region.poly`, so it is the
  only tile the design's coverage rule (§2.5) counts as covered by the region;
  the other five cross the French border. 36 tiles are covered in all; the
  other 35 are sea.
- No aerodrome and no tram: the aerodrome centroid is tested on a hand-made
  polygon (§4.4).
- The files are what the workflow built, byte for byte; rebuild them with
  the workflow (region `monaco`) rather than editing them, and update this
  file with the run.

## Source and licence

The data is from OpenStreetMap, © OpenStreetMap contributors, and is
available under the Open Database Licence 1.0 (ODbL):
https://www.openstreetmap.org/copyright. It was taken from Geofabrik's
extract of Monaco (https://download.geofabrik.de/europe/monaco.html). These
files are a derivative database of it and are licensed under the ODbL as
well, whatever the licence of the rest of this repository.

`basemap.pmtiles` holds vector tiles in the OpenMapTiles schema (© OpenMapTiles,
CC-BY 4.0, https://github.com/openmaptiles/openmaptiles), built with
Planetiler (Apache-2.0); at its low zooms it draws on Natural Earth (public
domain) and on the OSM water polygons of osmdata.openstreetmap.de (ODbL). A
map that shows these tiles credits "© OpenMapTiles © OpenStreetMap
contributors".
