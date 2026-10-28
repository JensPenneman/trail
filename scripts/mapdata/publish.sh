#!/usr/bin/env bash
# Publishes a map data artefact, the directory scripts/mapdata/build.sh wrote,
# to an OCI registry with ORAS (docs/design/self-hosted-maps.md §4.2):
# manifest.json and the files it lists as layers, a file larger than a chunk
# in the chunks the manifest lists, under the tags <region> (what every
# server follows) and <region>-<build id> (the day of the extract's data; a
# rebuild of the same extract moves it, and retain.sh deletes the build it
# leaves untagged). The manifest of the push carries the region and the
# build id as annotations, which a server reads before it downloads anything.
# Every layer is checked against manifest.json before the push, and what the
# registry holds afterwards against the layers.
#
# .github/workflows/mapdata.yml runs it in its publishing job after `oras
# login`; by hand, after `oras login ghcr.io` (ORAS 1.3).
#
# Usage: scripts/mapdata/publish.sh [options] <artefact directory>
#
#   --repository REF  where to (default: ghcr.io/jenspenneman/trail-mapdata)
#   --oci-layout DIR  an OCI image layout directory instead, to try it out
#   --source URL      the source annotation (default: the Trail repository)
#   --stage DIR       where the layers are put together (default: a
#                     temporary directory; on the artefact's file system,
#                     whole files are hard links)
#   --outputs FILE    append digest=, previous= (the build the dated tag
#                     left, if any) and moved-from= (where <region> pointed)
#   --summary FILE    append a Markdown summary
#   --dry-run         put the layers together and check them; push nothing
set -euo pipefail

readonly artefact_type=application/vnd.trail.mapdata.v1
readonly manifest_type=application/vnd.trail.mapdata.manifest.v1+json
# The annotations the servers' registry client reads (apps/api/src/mapdata/artefactLayout.ts)
readonly region_key=com.jenspenneman.trail.mapdata.region
readonly build_key=com.jenspenneman.trail.mapdata.build

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
readonly here

say() { printf '==> %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
usage() { sed -n '/^# Usage:/,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; }
value() { [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"; }

dir='' repository=ghcr.io/jenspenneman/trail-mapdata layout='' source_url=https://github.com/JensPenneman/trail
stage='' outputs='' summary='' dry_run=false
while (($# > 0)); do
  case $1 in
    --repository) value "$@"; repository=$2; shift ;;
    --oci-layout) value "$@"; layout=$2; shift ;;
    --source) value "$@"; source_url=$2; shift ;;
    --stage) value "$@"; stage=$2; shift ;;
    --outputs) value "$@"; outputs=$2; shift ;;
    --summary) value "$@"; summary=$2; shift ;;
    --dry-run) dry_run=true ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option $1 (see --help)" ;;
    *)
      [ -z "$dir" ] || die "one artefact at a time"
      dir=$1
      ;;
  esac
  shift
done
[ -n "$dir" ] || { usage >&2; exit 2; }
[ -f "$dir/manifest.json" ] || die "$dir has no manifest.json"
dir=$(CDPATH='' cd -- "$dir" && pwd -P)

for tool in jq split; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is missing"
done
$dry_run || command -v oras >/dev/null 2>&1 || die "oras is missing (ORAS 1.3)"
if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | awk '{ print $1 }'; }
else
  sha256_of() { shasum -a 256 "$1" | awk '{ print $1 }'; }
fi
bytes_of() { wc -c <"$1" | tr -d ' '; }

manifest=$dir/manifest.json
jq -e --arg type "$manifest_type" '.mediaType == $type' "$manifest" >/dev/null ||
  die "$manifest is not a Trail map data manifest"
region=$(jq -r '.region // ""' "$manifest")
build_id=$(jq -r '.build.id // ""' "$manifest")
built_at=$(jq -r '.build.at // ""' "$manifest")
commit=$(jq -r '.build.commit // ""' "$manifest")
extract_timestamp=$(jq -r '.extract.timestamp // "unknown"' "$manifest")
geofabrik_path=$(jq -r '.extract.geofabrik // ""' "$manifest")
case $region in
  '' | *[!a-z0-9-]* | -*) die "the manifest's region is not a region: '$region'" ;;
esac
case $build_id in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) die "the manifest has no build id (yyyymmdd): '$build_id' (build.sh writes one)" ;;
esac

temporary=''
cleanup() { if [ -n "$temporary" ]; then rm -rf "$temporary"; fi; }
trap cleanup EXIT
temporary=$(mktemp -d)
if [ -z "$stage" ]; then
  stage=$temporary/layers
fi
mkdir -p "$stage"
stage=$(CDPATH='' cd -- "$stage" && pwd -P)
find "$stage" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
expected=$temporary/expected.tsv
: >"$expected"
layers=()

# put FILE NAME: a whole file into the stage, a hard link where it can be
put() { ln -f "$1" "$stage/$2" 2>/dev/null || cp "$1" "$stage/$2"; }

put "$manifest" manifest.json
layers+=("manifest.json:$manifest_type")
printf 'manifest.json\t%s\tsha256:%s\n' "$(bytes_of "$manifest")" "$(sha256_of "$manifest")" >>"$expected"

while IFS=$'\t' read -r name media_type bytes sha256 chunk_count; do
  case $name in
    ways.opl.gz | pois.geojsonseq.gz | region.poly | basemap.pmtiles) ;;
    *) die "the manifest lists $name, which is not a file of a map data artefact" ;;
  esac
  [ -f "$dir/$name" ] || die "$dir has no $name, which the manifest lists"
  [ "$(bytes_of "$dir/$name")" = "$bytes" ] && [ "$(sha256_of "$dir/$name")" = "$sha256" ] ||
    die "$dir/$name is not the file the manifest describes"
  if [ "$chunk_count" -gt 0 ]; then
    chunk_bytes=$(jq -r --arg name "$name" '.files[] | select(.name == $name) | .chunks[0].bytes' "$manifest")
    "$here/chunks.sh" "$dir/$name" "$chunk_bytes" "$stage" >"$temporary/cut.tsv"
    jq -e -n --rawfile cut "$temporary/cut.tsv" --slurpfile manifest "$manifest" --arg name "$name" '
      ($cut | split("\n") | map(select(length > 0) | split("\t") | { name: .[0], bytes: (.[1] | tonumber), sha256: .[2] }))
      == ($manifest[0].files[] | select(.name == $name) | [.chunks[] | { name, bytes, sha256 }])' >/dev/null ||
      die "the chunks of $name are not those the manifest lists"
    while IFS=$'\t' read -r chunk chunk_size chunk_sha256; do
      layers+=("$chunk:$media_type")
      printf '%s\t%s\tsha256:%s\n' "$chunk" "$chunk_size" "$chunk_sha256" >>"$expected"
    done <"$temporary/cut.tsv"
  else
    put "$dir/$name" "$name"
    layers+=("$name:$media_type")
    printf '%s\t%s\tsha256:%s\n' "$name" "$bytes" "$sha256" >>"$expected"
  fi
done < <(jq -r '.files[] | [.name, .mediaType, (.bytes | tostring), .sha256, ((.chunks // []) | length | tostring)] | @tsv' "$manifest")

total=$(awk -F'\t' '{ sum += $2 } END { printf "%d", sum }' "$expected")
count=$(wc -l <"$expected" | tr -d ' ')
say "$region $build_id: $count layers, $total bytes"
if $dry_run; then
  say "dry run: nothing pushed"
  exit 0
fi

ref_flags=()
if [ -n "$layout" ]; then
  mkdir -p "$layout"
  repository=$(CDPATH='' cd -- "$layout" && pwd -P)
  ref_flags=(--oci-layout)
fi
dated=$region-$build_id
resolve() { oras resolve "${ref_flags[@]}" "$repository:$1" 2>/dev/null || true; }
previous=$(resolve "$dated")
moved_from=$(resolve "$region")

description="Trail map data: $region (Geofabrik $geofabrik_path), OSM data up to $extract_timestamp"
started=$(date +%s)
digest=$(cd "$stage" && oras push "${ref_flags[@]}" "$repository:$region,$dated" \
  --artifact-type "$artefact_type" \
  --annotation "$region_key=$region" \
  --annotation "$build_key=$build_id" \
  --annotation "org.opencontainers.image.created=$built_at" \
  --annotation "org.opencontainers.image.version=$build_id" \
  --annotation "org.opencontainers.image.revision=$commit" \
  --annotation "org.opencontainers.image.source=$source_url" \
  --annotation "org.opencontainers.image.description=$description" \
  --annotation "org.opencontainers.image.licenses=ODbL-1.0" \
  --format go-template='{{.digest}}' \
  "${layers[@]}")
seconds=$(($(date +%s) - started))
case $digest in
  sha256:[0-9a-f]*) ;;
  *) die "oras push printed no digest: $digest" ;;
esac

# What the registry holds now: exactly the layers, the annotations and the two tags
oras manifest fetch "${ref_flags[@]}" "$repository@$digest" >"$temporary/pushed.json"
jq -e --arg type "$artefact_type" --arg region "$region" --arg build "$build_id" \
  --arg regionKey "$region_key" --arg buildKey "$build_key" --rawfile expected "$expected" '
  .artifactType == $type
  and .annotations[$regionKey] == $region and .annotations[$buildKey] == $build
  and ([.layers[] | [.annotations["org.opencontainers.image.title"], (.size | tostring), .digest]] | sort)
      == ($expected | split("\n") | map(select(length > 0) | split("\t")) | sort)' \
  "$temporary/pushed.json" >/dev/null || die "the registry's manifest $digest is not what was pushed"
for tag in "$region" "$dated"; do
  [ "$(resolve "$tag")" = "$digest" ] || die "$repository:$tag does not point at $digest"
done
say "pushed $repository:$region and :$dated as $digest in $seconds s"

if [ -n "$outputs" ]; then
  {
    printf 'digest=%s\n' "$digest"
    printf 'previous=%s\n' "$([ "$previous" != "$digest" ] && printf '%s' "$previous")"
    printf 'moved-from=%s\n' "$([ "$moved_from" != "$digest" ] && printf '%s' "$moved_from")"
  } >>"$outputs"
fi
# shellcheck disable=SC2016 # the backticks are Markdown's
if [ -n "$summary" ]; then
  {
    printf '### Published: %s\n\n' "$region"
    printf '`%s:%s` and `:%s`, manifest `%s`: %s layers, %s, pushed in %s s.' "$repository" "$region" \
      "$dated" "$digest" "$count" "$(awk -v b="$total" 'BEGIN { printf "%.1f MB", b / 1e6 }')" "$seconds"
    if [ -z "$moved_from" ]; then
      printf ' The tag `%s` is new.' "$region"
    elif [ "$moved_from" != "$digest" ]; then
      printf ' The tag `%s` moved from `%s`.' "$region" "$moved_from"
    fi
    if [ -n "$previous" ] && [ "$previous" != "$digest" ]; then
      printf ' A rebuild of the extract of %s: it replaces `%s`.' "$build_id" "$previous"
    fi
    printf '\n\n| Layer | Size | Digest |\n|---|---:|---|\n'
    awk -F'\t' '{ printf "| `%s` | %d B | `%s` |\n", $1, $2, $3 }' "$expected"
    printf '\n'
  } >>"$summary"
fi
printf '%s\n' "$digest"
