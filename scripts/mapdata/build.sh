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
#   --cache DIR     the Planetiler jar and the sources Planetiler downloads
#                   (Natural Earth, the OSM water polygons, lake centrelines;
#                   about 1.5 GB) (default: ~/.cache/trail-mapdata)
#   --pbf FILE      an extract on disk instead of the download (with --poly)
#   --poly FILE     its polygon
#   --no-basemap    the ways and stops only: no Planetiler, no Java
#   --heap SIZE     Planetiler's Java heap (default: the region's, e.g. 3g)
#
# The artefact:
#   ways.opl.gz         one OPL line per way: its id, the tags Trail keeps, its
#                       node ids with their coordinates
#   pois.geojsonseq.gz  the stops and airports, a GeoJSON text sequence:
#                       points, and polygons for aerodromes mapped as areas
#   region.poly         the extract's polygon, as Geofabrik publishes it
#   basemap.pmtiles     the vector tiles (OpenMapTiles schema, gzipped MVT)
#   manifest.json       the region, its extract, the build, the tools, counts,
#                       attribution, and every file's size and SHA-256
#   SHA256SUMS          the same checksums, for `sha256sum -c`
# The world overview holds basemap.pmtiles, manifest.json and SHA256SUMS.
set -euo pipefail

readonly planetiler_version=0.10.2
readonly planetiler_sha256=f310bd0413e2e4512b27f4046d418664e8e1d3bf31603c2a70e23de06c167e4d
readonly planetiler_url=https://github.com/onthegomap/planetiler/releases/download/v${planetiler_version}/planetiler.jar
readonly geofabrik=https://download.geofabrik.de

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

region='' out='' work='' cache='' pbf='' poly='' basemap=true heap=''
while (($# > 0)); do
  case $1 in
    --out) value "$@"; out=$2; shift ;;
    --work) value "$@"; work=$2; shift ;;
    --cache) value "$@"; cache=$2; shift ;;
    --pbf) value "$@"; pbf=$2; shift ;;
    --poly) value "$@"; poly=$2; shift ;;
    --heap) value "$@"; heap=$2; shift ;;
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

# The newest extract of the region: Geofabrik answers *-latest.osm.pbf with a
# redirect to the dated file of the day (europe/belgium-261027.osm.pbf), whose
# .md5 next to it cannot change while the download runs.
resolve_extract() {
  local latest=$geofabrik/$geofabrik_path-latest.osm.pbf answer code location
  answer=$(curl --proto '=https' --tlsv1.2 -sS -I -o /dev/null -w '%{http_code} %{redirect_url}' "$latest") ||
    die "Geofabrik did not answer for $latest"
  code=${answer%% *}
  location=${answer#* }
  case $code in
    200) printf '%s\n' "$latest" ;;
    301 | 302 | 303 | 307 | 308)
      case $location in
        "$geofabrik/$geofabrik_path-"[0-9][0-9][0-9][0-9][0-9][0-9].osm.pbf) printf '%s\n' "$location" ;;
        *) die "Geofabrik sent $latest to $location, which is not one of its dated extracts" ;;
      esac
      ;;
    *) die "Geofabrik answered $code for $latest" ;;
  esac
}

built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
commit=${GITHUB_SHA:-$(git -C "$here" rev-parse HEAD 2>/dev/null || echo unknown)}
osmium_version=$(osmium --version | awk 'NR == 1 { print $NF }')
libosmium_version=$(osmium --version | awk '/^libosmium version/ { print $NF }')

say "$region ($geofabrik_path) into $out"

# 1. The extract and its polygon
pbf_url=''
pbf_md5=''
if [ -n "$pbf" ]; then
  [ -f "$pbf" ] || die "no file $pbf"
  [ -f "$poly" ] || die "no file $poly"
  pbf_file=$(CDPATH='' cd -- "$(dirname -- "$pbf")" && pwd -P)/$(basename -- "$pbf")
  poly_file=$(CDPATH='' cd -- "$(dirname -- "$poly")" && pwd -P)/$(basename -- "$poly")
else
  pbf_url=$(resolve_extract)
  pbf_file=$work/$(basename -- "$pbf_url")
  poly_file=$work/region.poly
  step download "${fetch[@]}" -o "$pbf_file" "$pbf_url"
  pbf_md5=$("${fetch[@]}" "$pbf_url.md5" | awk '{ print $1 }')
  [ "$(md5_of "$pbf_file")" = "$pbf_md5" ] || die "$pbf_file does not match its .md5"
  "${fetch[@]}" -o "$poly_file" "$geofabrik/$geofabrik_path.poly"
fi
pbf_bytes=$(bytes_of "$pbf_file")
pbf_sha256=$(sha256_of "$pbf_file")
# shellcheck disable=SC2016 # expanded by the inner shell
step fileinfo sh -c 'osmium fileinfo --extended --json "$1" >"$2"' sh "$pbf_file" "$work/extract-info.json"
extract_timestamp=$(jq -r '.header.option.osmosis_replication_timestamp // .data.timestamp.last // ""' "$work/extract-info.json")
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
  # shellcheck disable=SC2016 # expanded by the inner shell
  step opl sh -c 'osmium cat -t way -f opl,add_metadata=false,locations_on_ways=true -o - "$1" | awk -v stats="$2" -f "$3" | gzip -6n >"$4"' \
    sh "$work/ways-located.osm.pbf" "$work/opl-counts.tsv" "$here/keep-tags.awk" "$out/ways.opl.gz"
  read -r opl_ways opl_refs <"$work/opl-counts.tsv"
  osmium fileinfo --extended --json "$work/ways.osm.pbf" >"$work/ways-info.json"
  way_nodes=$(jq '.data.count.nodes' "$work/ways-info.json")

  # 3. The stops and airports of classifyPoi.ts: nodes, and aerodromes mapped
  #    as ways or multipolygons, exported as points and polygons with the tags
  #    the loader reads (pois-export.json).
  step filter-pois osmium tags-filter --overwrite --remove-tags -o "$work/pois.osm.pbf" "$pbf_file" \
    n/railway=station,halt,tram_stop n/highway=bus_stop n/amenity=ferry_terminal nwr/aeroway=aerodrome
  # shellcheck disable=SC2016 # expanded by the inner shell
  step export-pois sh -c 'osmium export --overwrite -c "$1" -f geojsonseq --geometry-types=point,polygon --add-unique-id=type_id -o - "$2" | gzip -6n >"$3"' \
    sh "$here/pois-export.json" "$work/pois.osm.pbf" "$out/pois.geojsonseq.gz"
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
  tmp=$work/planetiler-tmp
  rm -rf "$tmp"
  mkdir -p "$tmp"
  args=(-Xmx"$heap" -jar "$jar"
    --osm_path="$pbf_file" --download --download_dir="$cache/sources"
    --output="$out/basemap.pmtiles" --force
    --tmpdir="$tmp" --output_layerstats=true)
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
  rm -rf "$tmp"
  for layerstats in "$out"/*.layerstats.tsv.gz; do
    if [ -f "$layerstats" ]; then mv "$layerstats" "$work/"; fi
  done
  add_file basemap.pmtiles application/vnd.trail.mapdata.basemap.v1
  for source in "$cache"/sources/*; do
    if [ -f "$source" ]; then
      sources=$(jq -c --arg name "$(basename -- "$source")" --argjson bytes "$(bytes_of "$source")" \
        --arg sha256 "$(sha256_of "$source")" '. + [{ name: $name, bytes: $bytes, sha256: $sha256 }]' <<<"$sources")
    fi
  done
fi

# 5. Manifest and checksums
jq -R -s 'split("\n") | map(select(length > 0) | split("\t")
  | { name: .[0], mediaType: .[1], bytes: (.[2] | tonumber), sha256: .[3] })' "$files_tsv" >"$work/files.json"
jq -n \
  --arg region "$region" --arg path "$geofabrik_path" --arg url "$pbf_url" --arg md5 "$pbf_md5" \
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
      md5: (if $md5 == "" then null else $md5 end),
      sha256: $sha256,
      bytes: $bytes,
      timestamp: (if $timestamp == "" then null else $timestamp end),
      counts: $extractCounts
    },
    build: {
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
  --slurpfile manifest "$out/manifest.json" '
  { region: $region,
    machine: { os: $os, cpus: $cpus, ramKib: $ramKib, diskFreeKibAfter: $diskFreeKib },
    planetiler: { heap: $heap, tempPeakKib: (if $tempPeakKib == "" then null else ($tempPeakKib | tonumber) end) },
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
    | "Extract `\($m.extract.url // "on disk" | split("/") | last)` (\($m.extract.geofabrik)), \($m.extract.bytes | mb), OSM data up to \($m.extract.timestamp // "unknown"): \($m.extract.counts.nodes) nodes, \($m.extract.counts.ways) ways, \($m.extract.counts.relations) relations.",
      "",
      "Built \($m.build.at) on \(.machine.os), \(.machine.cpus) CPUs, \(.machine.ramKib / 1048576 | . * 10 | round / 10) GiB RAM, \(.machine.diskFreeKibAfter / 1048576 | round) GiB free afterwards; osmium-tool \($m.build.tools.osmium) (libosmium \($m.build.tools.libosmium))\(if $m.build.tools.planetiler then ", Planetiler \($m.build.tools.planetiler) on Java \($m.build.tools.java), heap \(.planetiler.heap), temporary files at most \(.planetiler.tempPeakKib // 0 | . / 1024 | round) MiB" else "" end).",
      "",
      "| Step | Time | Peak memory |",
      "|---|---:|---:|",
      (.steps[] | "| \(.name) | \(.seconds | duration) | \(.peakRssKib | mib) |"),
      "",
      "| File | Size | SHA-256 |",
      "|---|---:|---|",
      ($m.files[] | "| `\(.name)` | \(.bytes | mb) (\(.bytes) B) | `\(.sha256)` |"),
      "",
      (if $m.counts.ways then
        "Kept \($m.counts.ways) ways with \($m.counts.wayNodeRefs) node references (\($m.counts.wayNodes) distinct nodes); \($m.counts.pois.features) stops and airports: \($m.counts.pois.kinds | to_entries | map("\(.key) \(.value)") | join(", ")); geometries \($m.counts.pois.geometries | to_entries | map("\(.key) \(.value)") | join(", "))."
       else empty end)
  ' "$work/build-stats.json"
  if [ -f "$logs/planetiler.log" ]; then
    printf '\n<details><summary>Planetiler</summary>\n\n```\n'
    # the stage timings and sizes Planetiler prints at the end
    awk '/^-+$/ { n++ } n >= 1' "$logs/planetiler.log" | sed -n '1,80p' | sed 's/^[0-9:. -]*[A-Z]* *\[[^]]*\] *- //'
    printf '```\n\n</details>\n'
  fi
} >"$work/summary.md"

say "done: $out"
cat "$work/summary.md"
