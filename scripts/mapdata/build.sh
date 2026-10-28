#!/usr/bin/env bash
# Builds the map data of one region (docs/design/self-hosted-maps.md, §2.2,
# §3.1 and §4): from a Geofabrik extract, the ways and stops that map matching
# keeps, filtered with osmium-tool, and the basemap in the OpenMapTiles schema,
# built with Planetiler. The region `world` is the world overview: a basemap
# only, z0–6 over the whole globe from Natural Earth and the OSM water
# polygons, with the Monaco extract as the OSM input Planetiler needs.
#
# .github/workflows/mapdata.yml runs this script; it runs by hand too, on Linux
# or macOS with bash, curl, gzip, jq, osmium-tool 1.16 or later and, for the
# basemap, Java 21 or later. The Planetiler jar is downloaded into the cache
# directory once and checked against the SHA-256 pinned below.
#
# Usage: scripts/mapdata/build.sh [options] <region>
#
#   <region>        a name of scripts/mapdata/regions.json
#   --out DIR       the artefact (default: mapdata/<region>)
#   --work DIR      downloads, intermediate files, logs, summary.md and
#                   build-stats.json (default: <cache>/work/<region>)
#   --cache DIR     the Planetiler jar and the sources of its profile
#                   (Natural Earth, the OSM water polygons, lake centrelines;
#                   about 1.5 GB) (default: ~/.cache/trail-mapdata)
#   --pbf FILE      an extract on disk instead of the download (with --poly)
#   --poly FILE     its polygon
#   --extract DATE  Geofabrik's extract of that day (yymmdd, e.g. 261027)
#                   instead of the newest; Geofabrik keeps the last few days
#                   and the first of every month
#   --no-basemap    the ways and stops only: no Planetiler, no Java
#   --heap SIZE     Planetiler's Java heap (default: the region's, e.g. 3g)
#   --chunk-mib N   files larger than N MiB are published in chunks of N MiB
#                   (default 1024), which the manifest lists
#
# The build's id is the day of the extract's data (yyyymmdd, UTC), from the
# extract's replication timestamp: an extract without a timestamp is refused.
#
# The artefact:
#   ways.opl.gz         one OPL line per way: its id, the tags Trail keeps, its
#                       node ids with their coordinates
#   pois.geojsonseq.gz  the stops and airports, a GeoJSON text sequence:
#                       points, and MultiPolygons for aerodromes mapped as
#                       areas (osmium writes every area as a MultiPolygon)
#   region.poly         the extract's polygon, as Geofabrik publishes it
#   basemap.pmtiles     the vector tiles (OpenMapTiles schema, gzipped MVT)
#   manifest.json       the region, its extract, the build (its id, time,
#                       commit and tools), counts, attribution, and every
#                       file's size and SHA-256, with those of its chunks
#   SHA256SUMS          the same checksums, for `sha256sum -c`
# The world overview holds basemap.pmtiles, manifest.json and SHA256SUMS.
set -euo pipefail

readonly planetiler_version=0.10.2
readonly planetiler_sha256=f310bd0413e2e4512b27f4046d418664e8e1d3bf31603c2a70e23de06c167e4d
readonly planetiler_url=https://github.com/onthegomap/planetiler/releases/download/v${planetiler_version}/planetiler.jar
readonly geofabrik=https://download.geofabrik.de
# The one mirror Geofabrik sends its biggest extracts to (Germany, Europe):
# it serves their -latest file only, the bytes of the newest dated file on
# Geofabrik, which serves the .md5 the mirror lacks (resolve_extract).
readonly geofabrik_mirror=https://ftp5.gwdg.de/pub/misc/openstreetmap/download.geofabrik.de
# The sources of Planetiler's OpenMapTiles profile, fetched by this script into
# --cache and handed to Planetiler by path (it downloads nothing itself).
# Natural Earth's package and the lake centrelines' release asset are fixed
# files, pinned by SHA-256 (the checksums of their first download, on 28
# October 2026; Natural Earth's package dates from May 2022). The OSM water
# polygons are regenerated upstream every day, so they can only be recorded
# in the manifest; the cached copy is fetched again after 30 days.
readonly natural_earth_url=https://naciscdn.org/naturalearth/packages/natural_earth_vector.sqlite.zip
readonly natural_earth_sha256=375da61836d4779dffa8b87887bc4faa94dac77745ba0ee3914bd7cbedf40a02
readonly lake_centerlines_url=https://github.com/acalcutt/osm-lakelines/releases/download/v12/lake_centerline.shp.zip
readonly lake_centerlines_sha256=6c900507c88fc9f5b5a386f90fd0a42d0495e8755a03d075538fb9a6801a3192
readonly water_polygons_url=https://osmdata.openstreetmap.de/download/water-polygons-split-3857.zip

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
readonly here
readonly regions_file=$here/regions.json

say() { printf '==> %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
usage() { sed -n '/^# Usage:/,/^# The artefact:/p' "$0" | sed '$d; s/^# \{0,1\}//'; }
value() { [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"; }

region='' out='' work='' cache='' pbf='' poly='' basemap=true heap='' extract='' chunk_mib=1024
while (($# > 0)); do
  case $1 in
    --out) value "$@"; out=$2; shift ;;
    --work) value "$@"; work=$2; shift ;;
    --cache) value "$@"; cache=$2; shift ;;
    --pbf) value "$@"; pbf=$2; shift ;;
    --poly) value "$@"; poly=$2; shift ;;
    --heap) value "$@"; heap=$2; shift ;;
    --extract) value "$@"; extract=$2; shift ;;
    --chunk-mib) value "$@"; chunk_mib=$2; shift ;;
    --no-basemap) basemap=false ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option $1 (see --help)" ;;
    *)
      [ -z "$region" ] || die "one region at a time"
      region=$1
      ;;
  esac
  shift
done
[ -n "$region" ] || { usage >&2; exit 2; }
case $region in
  *[!a-z0-9-]* | -*) die "a region is lowercase letters, digits and dashes: $region" ;;
esac
if { [ -n "$pbf" ] && [ -z "$poly" ]; } || { [ -z "$pbf" ] && [ -n "$poly" ]; }; then
  die "--pbf and --poly go together"
fi
case $extract in
  '' | [0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) die "--extract takes a day as yymmdd, e.g. 261027: $extract" ;;
esac
if [ -n "$extract" ] && [ -n "$pbf" ]; then die "--extract and --pbf exclude each other"; fi
case $chunk_mib in
  '' | *[!0-9]* | 0*) die "--chunk-mib takes a whole number of MiB: $chunk_mib" ;;
esac
readonly chunk_bytes=$((chunk_mib * 1048576))

for tool in curl gzip jq osmium awk; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is missing"
done
entry=$(jq -c --arg region "$region" '.[$region] // empty' "$regions_file")
[ -n "$entry" ] || die "$region is not a region of $regions_file"
geofabrik_path=$(jq -r '.geofabrik' <<<"$entry")
matching=$(jq -r 'if .matching == false then "false" else "true" end' <<<"$entry")
bounds=$(jq -r '.bounds // empty' <<<"$entry")
maxzoom=$(jq -r '.maxzoom // empty' <<<"$entry")
[ -n "$heap" ] || heap=$(jq -r '.heap // "2g"' <<<"$entry")
case $heap in
  *[!0-9kmgKMG]* | '') die "--heap takes a Java size such as 3g: $heap" ;;
esac
if ! $matching && ! $basemap; then die "$region is a basemap only; --no-basemap leaves nothing"; fi

cache=${cache:-${XDG_CACHE_HOME:-$HOME/.cache}/trail-mapdata}
out=${out:-mapdata/$region}
work=${work:-$cache/work/$region}
mkdir -p "$out" "$work" "$cache"
out=$(CDPATH='' cd -- "$out" && pwd -P)
work=$(CDPATH='' cd -- "$work" && pwd -P)
cache=$(CDPATH='' cd -- "$cache" && pwd -P)
logs=$work/logs
stats=$work/stats.tsv
rm -rf "$logs"
mkdir -p "$logs"
: >"$stats"
# a previous build's files must not end up in this artefact
rm -f "$out"/ways.opl.gz "$out"/pois.geojsonseq.gz "$out"/region.poly "$out"/basemap.pmtiles \
  "$out"/manifest.json "$out"/SHA256SUMS

if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | awk '{ print $1 }'; }
else
  sha256_of() { shasum -a 256 "$1" | awk '{ print $1 }'; }
fi
if command -v md5sum >/dev/null 2>&1; then
  md5_of() { md5sum "$1" | awk '{ print $1 }'; }
else
  md5_of() { command md5 -q "$1"; }
fi
bytes_of() { wc -c <"$1" | tr -d ' '; }
# the escape character, to take terminal codes out of Planetiler's log
esc=$(printf '\033')
if /usr/bin/time --version 2>&1 | grep -q GNU; then gnu_time=true; else gnu_time=false; fi

# step NAME COMMAND...: runs COMMAND with its output in logs/NAME.log and
# appends NAME, its seconds and its peak resident memory in KiB (measured with
# GNU time, so on Linux only) to stats.tsv.
step() {
  local name=$1 started seconds rss=''
  shift
  say "$name"
  started=$(date +%s)
  if $gnu_time; then
    if ! /usr/bin/time -f '%e %M' -o "$logs/$name.time" "$@" >"$logs/$name.log" 2>&1; then
      tail -n 40 "$logs/$name.log" >&2
      die "$name failed; its log is $logs/$name.log"
    fi
    read -r seconds rss < <(tail -n 1 "$logs/$name.time")
  else
    if ! "$@" >"$logs/$name.log" 2>&1; then
      tail -n 40 "$logs/$name.log" >&2
      die "$name failed; its log is $logs/$name.log"
    fi
    seconds=$(($(date +%s) - started))
  fi
  printf '%s\t%s\t%s\n' "$name" "$seconds" "$rss" >>"$stats"
}

sampler=''
cleanup() { if [ -n "$sampler" ]; then kill "$sampler" 2>/dev/null || true; fi; }
trap cleanup EXIT

# curl for Geofabrik: HTTPS only, no redirect followed
fetch=(curl --proto '=https' --tlsv1.2 -fsS -L --max-redirs 0 --retry 3 --retry-delay 10)

# yymmdd of N days ago, in UTC (GNU date, then BSD date)
days_ago() {
  local then=$(($(date +%s) - $1 * 86400))
  date -u -d "@$then" +%y%m%d 2>/dev/null || date -u -r "$then" +%y%m%d
}

# head_of URL: "<status> <size> <last-modified>" of a HEAD request (no redirect
# followed), the time as the server wrote it
head_of() {
  curl --proto '=https' --tlsv1.2 -sS -I --max-redirs 0 "$1" 2>/dev/null | tr -d '\r' | awk '
    NR == 1 { status = $2 }
    tolower($1) == "content-length:" { size = $2 }
    tolower($1) == "last-modified:" { sub(/^[^:]*:[ \t]*/, ""); modified = $0 }
    END { printf "%s %s %s\n", (status == "" ? "000" : status), (size == "" ? "-" : size), modified }'
}

# Sets pbf_url, the extract's dated file on Geofabrik's own server
# (europe/belgium-261027.osm.pbf), whose .md5 next to it cannot change while
# the download runs; pbf_source, where its bytes come from; and pbf_mirror,
# the mirror's URL when that is where. Geofabrik answers *-latest.osm.pbf with
# a redirect to the dated file, except for its biggest extracts (Germany,
# Europe), which it sends to the mirror's -latest file: that is downloaded
# from the mirror, faster than Geofabrik serves it, and checked against the
# .md5 of the dated file on Geofabrik with the same size and modification
# time (the mirror's copy of it). Nothing else is downloaded from.
resolve_extract() {
  local latest=$geofabrik/$geofabrik_path-latest.osm.pbf answer code location day dated
  local mirror_code mirror_size mirror_modified size modified name
  pbf_mirror=''
  if [ -n "$extract" ]; then
    pbf_url=$geofabrik/$geofabrik_path-$extract.osm.pbf
    pbf_source=$pbf_url
    read -r code _ <<<"$(head_of "$pbf_url")"
    [ "$code" = 200 ] || die "Geofabrik has no $pbf_url ($code): it keeps the last few days and the first of every month"
    return
  fi
  answer=$(curl --proto '=https' --tlsv1.2 -sS -I -o /dev/null -w '%{http_code} %{redirect_url}' "$latest") ||
    die "Geofabrik did not answer for $latest"
  code=${answer%% *}
  location=${answer#* }
  case $code in
    200)
      pbf_url=$latest
      pbf_source=$latest
      return
      ;;
    301 | 302 | 303 | 307 | 308) ;;
    *) die "Geofabrik answered $code for $latest" ;;
  esac
  case $location in
    "$geofabrik/$geofabrik_path-"[0-9][0-9][0-9][0-9][0-9][0-9].osm.pbf)
      pbf_url=$location
      pbf_source=$location
      return
      ;;
  esac
  name=$(basename -- "$geofabrik_path")
  if ! [[ $location =~ ^${geofabrik_mirror//./\\.}/([a-z0-9-]+/)*${name}-latest\.osm\.pbf$ ]]; then
    die "Geofabrik sent $latest to $location, which is not a host this script downloads from"
  fi
  read -r mirror_code mirror_size mirror_modified <<<"$(head_of "$location")"
  [ "$mirror_code" = 200 ] || die "the mirror answered $mirror_code for $location"
  # an extract carries the date of its data and appears early the next day
  for day in 0 1 2 3; do
    dated=$geofabrik/$geofabrik_path-$(days_ago "$day").osm.pbf
    read -r code size modified <<<"$(head_of "$dated")"
    if [ "$code" = 200 ] && [ "$size" = "$mirror_size" ] && [ "$modified" = "$mirror_modified" ]; then
      pbf_url=$dated
      pbf_source=$location
      pbf_mirror=$location
      return
    fi
  done
  die "the mirror's $location ($mirror_size bytes, $mirror_modified) is none of Geofabrik's dated extracts of the last four days"
}

# download_extract: the extract from pbf_source into pbf_file, its .md5 from
# Geofabrik into pbf_md5; false when the bytes do not match it
download_extract() {
  local listed
  step download "${fetch[@]}" -o "$pbf_file" "$pbf_source"
  listed=$("${fetch[@]}" "$pbf_url.md5")
  pbf_md5=$(awk 'NR == 1 { print $1 }' <<<"$listed")
  [ "$(awk 'NR == 1 { print $2 }' <<<"$listed")" = "$(basename -- "$pbf_url")" ] ||
    die "$pbf_url.md5 names another file: $listed"
  [ "$(md5_of "$pbf_file")" = "$pbf_md5" ]
}

# fetch_source URL [SHA-256]: the source in the cache, downloaded when it is
# missing, does not match its pin, or (unpinned) is older than 30 days
fetch_source() {
  local url=$1 pin=${2:-} file
  file=$cache/sources/$(basename -- "$url")
  if [ -f "$file" ]; then
    if [ -n "$pin" ] && [ "$(sha256_of "$file")" = "$pin" ]; then return; fi
    if [ -z "$pin" ] && [ -z "$(find "$file" -mtime +30 2>/dev/null)" ]; then return; fi
  fi
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 3 -o "$file.part" "$url" ||
    die "could not download $url"
  if [ -n "$pin" ] && [ "$(sha256_of "$file.part")" != "$pin" ]; then
    rm -f "$file.part"
    die "$url does not match its pinned SHA-256"
  fi
  mv "$file.part" "$file"
}
fetch_sources() {
  fetch_source "$natural_earth_url" "$natural_earth_sha256"
  fetch_source "$lake_centerlines_url" "$lake_centerlines_sha256"
  fetch_source "$water_polygons_url"
}

built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
commit=${GITHUB_SHA:-$(git -C "$here" rev-parse HEAD 2>/dev/null || echo unknown)}
osmium_version=$(osmium --version | awk 'NR == 1 { print $NF }')
libosmium_version=$(osmium --version | awk '/^libosmium version/ { print $NF }')

say "$region ($geofabrik_path) into $out"

# 1. The extract and its polygon
pbf_url=''
pbf_source=''
pbf_mirror=''
pbf_md5=''
if [ -n "$pbf" ]; then
  [ -f "$pbf" ] || die "no file $pbf"
  [ -f "$poly" ] || die "no file $poly"
  pbf_file=$(CDPATH='' cd -- "$(dirname -- "$pbf")" && pwd -P)/$(basename -- "$pbf")
  poly_file=$(CDPATH='' cd -- "$(dirname -- "$poly")" && pwd -P)/$(basename -- "$poly")
else
  resolve_extract
  pbf_file=$work/$(basename -- "$pbf_url")
  poly_file=$work/region.poly
  if ! download_extract; then
    [ -n "$pbf_mirror" ] || die "$pbf_file does not match $pbf_url.md5"
    # The mirror's -latest file changed to the next day's during the download:
    # once more, against that day's .md5.
    say "the mirror's file does not match $pbf_url.md5; once more"
    rm -f "$pbf_file"
    resolve_extract
    pbf_file=$work/$(basename -- "$pbf_url")
    download_extract || die "$pbf_file from the mirror does not match $pbf_url.md5"
  fi
  "${fetch[@]}" -o "$poly_file" "$geofabrik/$geofabrik_path.poly"
fi
pbf_bytes=$(bytes_of "$pbf_file")
pbf_sha256=$(sha256_of "$pbf_file")
# shellcheck disable=SC2016 # expanded by the inner shell
step fileinfo sh -c 'osmium fileinfo --extended --json "$1" >"$2"' sh "$pbf_file" "$work/extract-info.json"
extract_timestamp=$(jq -r '.header.option.osmosis_replication_timestamp // .data.timestamp.last // ""' "$work/extract-info.json")
# The build's id: the day of the extract's data, in UTC
case $extract_timestamp in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z) ;;
  *) die "the extract carries no timestamp (osmosis_replication_timestamp, or its newest object's), so the build has no id: '$extract_timestamp'" ;;
esac
build_id=${extract_timestamp:0:4}${extract_timestamp:5:2}${extract_timestamp:8:2}
extract_counts=$(jq -c '.data.count | { nodes, ways, relations }' "$work/extract-info.json")

counts='{}'
files_tsv=$work/files.tsv
: >"$files_tsv"
add_file() { # add_file NAME MEDIA-TYPE
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$(bytes_of "$out/$1")" "$(sha256_of "$out/$1")" >>"$files_tsv"
}

if $matching; then
  # 2. The ways map matching keeps: the filter of overpassQuery.ts, with the
  #    nodes they reference (stripped of their tags, so that adding the
  #    locations to the ways drops them), as OPL with the kept tags only.
  step filter-ways osmium tags-filter --overwrite --remove-tags -o "$work/ways.osm.pbf" "$pbf_file" \
    'w/highway!=proposed,construction,abandoned,razed,disused,planned' \
    w/railway=rail,light_rail,tram,subway,narrow_gauge,funicular \
    w/route=ferry
  step locations osmium add-locations-to-ways --overwrite -o "$work/ways-located.osm.pbf" "$work/ways.osm.pbf"
  # pipefail: a failing osmium must fail the step, not leave gzip's exit 0 and
  # a truncated file with a valid checksum
  # shellcheck disable=SC2016 # expanded by the inner shell
  step opl bash -o pipefail -c 'osmium cat -t way -f opl,add_metadata=false,locations_on_ways=true -o - "$1" | awk -v stats="$2" -f "$3" | gzip -6n >"$4"' \
    bash "$work/ways-located.osm.pbf" "$work/opl-counts.tsv" "$here/keep-tags.awk" "$out/ways.opl.gz"
  read -r opl_ways opl_refs <"$work/opl-counts.tsv"
  osmium fileinfo --extended --json "$work/ways.osm.pbf" >"$work/ways-info.json"
  filtered_ways=$(jq '.data.count.ways' "$work/ways-info.json")
  [ "$opl_ways" = "$filtered_ways" ] ||
    die "ways.opl.gz holds $opl_ways ways, the filtered extract $filtered_ways"
  way_nodes=$(jq '.data.count.nodes' "$work/ways-info.json")

  # 3. The stops and airports of classifyPoi.ts: nodes, and aerodromes mapped
  #    as ways or multipolygons, exported as points and polygons with the tags
  #    the loader reads (pois-export.json).
  step filter-pois osmium tags-filter --overwrite --remove-tags -o "$work/pois.osm.pbf" "$pbf_file" \
    n/railway=station,halt,tram_stop n/highway=bus_stop n/amenity=ferry_terminal nwr/aeroway=aerodrome
  # shellcheck disable=SC2016 # expanded by the inner shell
  step export-pois bash -o pipefail -c 'osmium export --overwrite -c "$1" -f geojsonseq --geometry-types=point,polygon --add-unique-id=type_id -o - "$2" | gzip -6n >"$3"' \
    bash "$here/pois-export.json" "$work/pois.osm.pbf" "$out/pois.geojsonseq.gz"
  # (the record separators of the sequence taken out, for jq)
  pois=$(gzip -dc "$out/pois.geojsonseq.gz" | tr -d '\036' | jq -c -s '
    def kind: .properties as $p
      | if $p.railway == "station" then (if $p.station == "subway" or $p.subway == "yes" then "subway_station" else "station" end)
        elif $p.railway == "halt" then "halt"
        elif $p.railway == "tram_stop" then "tram_stop"
        elif $p.highway == "bus_stop" then "bus_stop"
        elif $p.amenity == "ferry_terminal" then "ferry_terminal"
        elif $p.aeroway == "aerodrome" then "aerodrome"
        else "other" end;
    { features: length,
      kinds: (group_by(kind) | map({ key: (.[0] | kind), value: length }) | from_entries),
      geometries: (group_by(.geometry.type) | map({ key: .[0].geometry.type, value: length }) | from_entries) }')

  cp "$poly_file" "$out/region.poly"
  add_file ways.opl.gz application/vnd.trail.mapdata.ways.v1+gzip
  add_file pois.geojsonseq.gz application/vnd.trail.mapdata.pois.v1+gzip
  add_file region.poly application/vnd.trail.mapdata.poly.v1
  counts=$(jq -n -c --argjson ways "$opl_ways" --argjson refs "$opl_refs" --argjson nodes "$way_nodes" \
    --argjson pois "$pois" '{ ways: $ways, wayNodeRefs: $refs, wayNodes: $nodes, pois: $pois }')
fi

# 4. The basemap
sources='[]'
java_version=''
temp_peak_kib=''
heap_used_mib=''
heap_live_mib=''
if $basemap; then
  command -v java >/dev/null 2>&1 || die "java is missing (Java 21 or later; or --no-basemap)"
  java_major=$(java -XshowSettings:properties -version 2>&1 | awk -F' = ' '/java.specification.version/ { print $2 }')
  java_version=$(java -XshowSettings:properties -version 2>&1 | awk -F' = ' '/java.runtime.version/ { print $2 }')
  [ "${java_major:-0}" -ge 21 ] 2>/dev/null || die "Planetiler needs Java 21 or later, not ${java_major:-unknown}"
  jar=$cache/planetiler-$planetiler_version.jar
  if [ ! -f "$jar" ] || [ "$(sha256_of "$jar")" != "$planetiler_sha256" ]; then
    say "planetiler $planetiler_version"
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 3 -o "$jar.part" "$planetiler_url"
    [ "$(sha256_of "$jar.part")" = "$planetiler_sha256" ] || die "$planetiler_url does not match its pinned SHA-256"
    mv "$jar.part" "$jar"
  fi
  mkdir -p "$cache/sources"
  # a shell function, so timed here rather than by `step`
  say sources
  started=$SECONDS
  fetch_sources
  printf '%s\t%s\t\n' sources "$((SECONDS - started))" >>"$stats"
  natural_earth_file=$cache/sources/$(basename -- "$natural_earth_url")
  lake_centerlines_file=$cache/sources/$(basename -- "$lake_centerlines_url")
  water_polygons_file=$cache/sources/$(basename -- "$water_polygons_url")
  tmp=$work/planetiler-tmp
  rm -rf "$tmp"
  mkdir -p "$tmp"
  args=(-Xmx"$heap" -jar "$jar"
    --osm_path="$pbf_file" --natural_earth_path="$natural_earth_file"
    --water_polygons_path="$water_polygons_file" --lake_centerlines_path="$lake_centerlines_file"
    --output="$out/basemap.pmtiles" --force
    --tmpdir="$tmp" --output_layerstats=true --color=false)
  if [ -n "$bounds" ]; then args+=(--bounds="$bounds"); fi
  if [ -n "$maxzoom" ]; then args+=(--maxzoom="$maxzoom"); fi
  # the temporary files' peak size, sampled every two seconds
  (
    peak=0
    while :; do
      size=$(du -sk "$tmp" 2>/dev/null | awk '{ print $1 }')
      if [ "${size:-0}" -gt "$peak" ]; then
        peak=$size
        echo "$peak" >"$logs/planetiler-temp-peak-kib"
      fi
      sleep 2
    done
  ) &
  sampler=$!
  step planetiler java "${args[@]}"
  kill "$sampler" 2>/dev/null || true
  wait "$sampler" 2>/dev/null || true
  sampler=''
  temp_peak_kib=$(cat "$logs/planetiler-temp-peak-kib" 2>/dev/null || echo 0)
  # the most heap in use and the most left after a collection, from the
  # progress lines ("heap: 1.2G/3G ... postGC: 800M"), terminal codes removed
  read -r heap_used_mib heap_live_mib < <(sed "s/${esc}\[[0-9;]*m//g" "$logs/planetiler.log" | awk '
    function mib(value, number, unit) {
      number = value + 0
      unit = substr(value, length(value))
      if (unit == "k") return number / 1024
      if (unit == "M") return number
      if (unit == "G") return number * 1024
      if (unit == "T") return number * 1048576
      return number / 1048576
    }
    match($0, /heap: [0-9.]+[kMGT]?\//) { used = mib(substr($0, RSTART + 6, RLENGTH - 7)); if (used > heap) heap = used }
    match($0, /postGC: [0-9.]+[kMGT]?/) { live = mib(substr($0, RSTART + 8, RLENGTH - 8)); if (live > post) post = live }
    END { printf "%d %d\n", heap, post }')
  rm -rf "$tmp"
  for layerstats in "$out"/*.layerstats.tsv.gz; do
    if [ -f "$layerstats" ]; then mv "$layerstats" "$work/"; fi
  done
  add_file basemap.pmtiles application/vnd.trail.mapdata.basemap.v1
  for source in "$natural_earth_url $natural_earth_sha256" "$lake_centerlines_url $lake_centerlines_sha256" \
    "$water_polygons_url"; do
    read -r url pin <<<"$source"
    file=$cache/sources/$(basename -- "$url")
    sources=$(jq -c --arg url "$url" --argjson bytes "$(bytes_of "$file")" --arg sha256 "$(sha256_of "$file")" \
      --argjson pinned "$([ -n "${pin:-}" ] && echo true || echo false)" \
      '. + [{ url: $url, bytes: $bytes, sha256: $sha256, pinned: $pinned }]' <<<"$sources")
  done
fi

# 5. Manifest and checksums. A file larger than the chunk size is published
#    in chunks, which publish.sh cuts with the same script: the manifest
#    lists each one's size and SHA-256 with its file.
chunks_tsv=$work/chunks.tsv
: >"$chunks_tsv"
while IFS=$'\t' read -r name _ bytes _; do
  if [ "$bytes" -gt "$chunk_bytes" ]; then
    rm -rf "$work/chunks"
    "$here/chunks.sh" "$out/$name" "$chunk_bytes" "$work/chunks" |
      awk -v file="$name" '{ print file "\t" $0 }' >>"$chunks_tsv"
    rm -rf "$work/chunks"
  fi
done <"$files_tsv"
jq -R -s --rawfile chunks "$chunks_tsv" '
  ($chunks | split("\n") | map(select(length > 0) | split("\t")
    | { file: .[0], name: .[1], bytes: (.[2] | tonumber), sha256: .[3] })) as $pieces
  | split("\n") | map(select(length > 0) | split("\t")
    | { name: .[0], mediaType: .[1], bytes: (.[2] | tonumber), sha256: .[3] }
    | . as $file
    | [$pieces[] | select(.file == $file.name) | { name, bytes, sha256 }] as $own
    | if ($own | length) > 0 then . + { chunks: $own } else . end)' "$files_tsv" >"$work/files.json"
jq -n \
  --arg region "$region" --arg path "$geofabrik_path" --arg url "$pbf_url" --arg md5 "$pbf_md5" \
  --arg mirror "$pbf_mirror" --arg buildId "$build_id" \
  --arg sha256 "$pbf_sha256" --argjson bytes "$pbf_bytes" --arg timestamp "$extract_timestamp" \
  --argjson extractCounts "$extract_counts" --arg builtAt "$built_at" --arg commit "$commit" \
  --arg osmium "$osmium_version" --arg libosmium "$libosmium_version" \
  --arg planetiler "$($basemap && echo "$planetiler_version" || true)" --arg java "$java_version" \
  --arg bounds "$bounds" --arg maxzoom "$maxzoom" --argjson counts "$counts" \
  --argjson sources "$sources" --slurpfile files "$work/files.json" '
  {
    mediaType: "application/vnd.trail.mapdata.manifest.v1+json",
    region: $region,
    extract: {
      geofabrik: $path,
      url: (if $url == "" then null else $url end),
      mirror: (if $mirror == "" then null else $mirror end),
      md5: (if $md5 == "" then null else $md5 end),
      sha256: $sha256,
      bytes: $bytes,
      timestamp: (if $timestamp == "" then null else $timestamp end),
      counts: $extractCounts
    },
    build: {
      id: $buildId,
      at: $builtAt,
      commit: $commit,
      tools: ({ osmium: $osmium, libosmium: $libosmium }
        + (if $planetiler == "" then {} else { planetiler: $planetiler, java: $java } end))
    },
    basemap: (if $planetiler == "" then null else {
      schema: "openmaptiles",
      bounds: (if $bounds == "" then "extract" else $bounds end),
      maxzoom: (if $maxzoom == "" then 14 else ($maxzoom | tonumber) end),
      sources: $sources
    } end),
    counts: $counts,
    attribution: "© OpenMapTiles © OpenStreetMap contributors",
    licences: [
      { applies: "OpenStreetMap data", name: "ODbL-1.0", url: "https://www.openstreetmap.org/copyright" },
      { applies: "OpenMapTiles schema", name: "CC-BY-4.0", url: "https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md" },
      { applies: "Natural Earth", name: "public domain", url: "https://www.naturalearthdata.com/about/terms-of-use/" }
    ],
    files: $files[0]
  }' >"$out/manifest.json"
awk -F'\t' '{ printf "%s  %s\n", $4, $1 }' "$files_tsv" >"$out/SHA256SUMS"
printf '%s  %s\n' "$(sha256_of "$out/manifest.json")" manifest.json >>"$out/SHA256SUMS"

# 6. What it took: build-stats.json and summary.md (the workflow's job summary)
case $(uname -s) in
  Linux)
    cpus=$(nproc)
    ram_kib=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
    ;;
  *)
    cpus=$(sysctl -n hw.ncpu)
    ram_kib=$(($(sysctl -n hw.memsize) / 1024))
    ;;
esac
disk_free_kib=$(df -Pk "$work" | awk 'NR == 2 { print $4 }')
jq -R -s --arg region "$region" --arg os "$(uname -sm)" --argjson cpus "$cpus" --argjson ramKib "$ram_kib" \
  --argjson diskFreeKib "$disk_free_kib" --arg heap "$heap" --arg tempPeakKib "$temp_peak_kib" \
  --arg heapUsedMib "$heap_used_mib" --arg heapLiveMib "$heap_live_mib" \
  --slurpfile manifest "$out/manifest.json" '
  { region: $region,
    machine: { os: $os, cpus: $cpus, ramKib: $ramKib, diskFreeKibAfter: $diskFreeKib },
    planetiler: { heap: $heap,
      tempPeakKib: (if $tempPeakKib == "" then null else ($tempPeakKib | tonumber) end),
      heapUsedMaxMib: (if $heapUsedMib == "" then null else ($heapUsedMib | tonumber) end),
      heapLiveMaxMib: (if $heapLiveMib == "" then null else ($heapLiveMib | tonumber) end) },
    steps: (split("\n") | map(select(length > 0) | split("\t")
      | { name: .[0], seconds: (.[1] | tonumber), peakRssKib: (if .[2] == "" then null else (.[2] | tonumber) end) })),
    manifest: $manifest[0] }' "$stats" >"$work/build-stats.json"

{
  printf '### Map data: %s\n\n' "$region"
  jq -r '
    def mb: . / 1000000 | . * 10 | round / 10 | tostring + " MB";
    def duration: if . >= 60 then "\(. / 60 | floor) min \(. % 60 | round) s" else "\(. * 10 | round / 10) s" end;
    def mib: if . == null then "" else . / 1024 | round | tostring + " MiB" end;
    .manifest as $m
    | "Build `\($m.build.id)` from the extract `\($m.extract.url // "on disk" | split("/") | last)` (\($m.extract.geofabrik)\(if $m.extract.mirror then ", downloaded from the mirror `\($m.extract.mirror | split("/")[2])`" else "" end)), \($m.extract.bytes | mb), OSM data up to \($m.extract.timestamp // "unknown"): \($m.extract.counts.nodes) nodes, \($m.extract.counts.ways) ways, \($m.extract.counts.relations) relations.",
      "",
      "Built \($m.build.at) on \(.machine.os), \(.machine.cpus) CPUs, \(.machine.ramKib / 1048576 | . * 10 | round / 10) GiB RAM, \(.machine.diskFreeKibAfter / 1048576 | round) GiB free afterwards; osmium-tool \($m.build.tools.osmium) (libosmium \($m.build.tools.libosmium))\(if $m.build.tools.planetiler then ", Planetiler \($m.build.tools.planetiler) on Java \($m.build.tools.java) with -Xmx\(.planetiler.heap) (at most \(.planetiler.heapUsedMaxMib) MiB of heap in use, \(.planetiler.heapLiveMaxMib) MiB live after a collection), temporary files at most \(.planetiler.tempPeakKib // 0 | . / 1024 | round) MiB" else "" end).",
      "",
      "| Step | Time | Peak memory |",
      "|---|---:|---:|",
      (.steps[] | "| \(.name) | \(.seconds | duration) | \(.peakRssKib | mib) |"),
      "",
      "| File | Size | SHA-256 |",
      "|---|---:|---|",
      ($m.files[] | "| `\(.name)` | \(.bytes | mb) (\(.bytes) B)\(if .chunks then ", \(.chunks | length) chunks" else "" end) | `\(.sha256)` |"),
      "",
      (if $m.counts.ways then
        "Kept \($m.counts.ways) ways with \($m.counts.wayNodeRefs) node references (\($m.counts.wayNodes) distinct nodes); \($m.counts.pois.features) stops and airports: \($m.counts.pois.kinds | to_entries | map("\(.key) \(.value)") | join(", ")); geometries \($m.counts.pois.geometries | to_entries | map("\(.key) \(.value)") | join(", "))."
       else empty end)
  ' "$work/build-stats.json"
  if [ -f "$logs/planetiler.log" ]; then
    printf '\n<details><summary>Planetiler</summary>\n\n```\n'
    # the data errors, stage timings and sizes Planetiler prints at the end,
    # without the terminal codes its logger writes even with --color=false
    sed "s/${esc}\[[0-9;]*m//g" "$logs/planetiler.log" |
      awk 'index($0, "- ----------------------------------------") { n++ } /Acknowledgments/ { exit } n >= 1' |
      sed 's/^[0-9:]* [A-Z]* \[[^]]*\] - //; s/^[0-9:]* [A-Z]* - //'
    printf '```\n\n</details>\n'
  fi
} >"$work/summary.md"

say "done: $out"
cat "$work/summary.md"
