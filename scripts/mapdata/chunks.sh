#!/usr/bin/env bash
# Cuts a file of a map data artefact into the chunks it is published in
# (docs/design/self-hosted-maps.md §4.2): pieces of CHUNK_BYTES, the last one
# shorter, named <file>.000, <file>.001 … in DIR. build.sh lists them in the
# manifest; publish.sh pushes them as layers; both cut with this script, so
# the pieces are the same. Prints one line per chunk: its name, its size and
# its SHA-256, apart by tabs.
#
# Usage: scripts/mapdata/chunks.sh FILE CHUNK_BYTES DIR
set -euo pipefail

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[ $# -eq 3 ] || die "usage: chunks.sh FILE CHUNK_BYTES DIR"
file=$1 chunk_bytes=$2 dir=$3
[ -f "$file" ] || die "no file $file"
case $chunk_bytes in
  '' | *[!0-9]* | 0*) die "CHUNK_BYTES is a whole number of bytes: $chunk_bytes" ;;
esac
mkdir -p "$dir"
name=$(basename -- "$file")
rm -f "$dir/$name".[0-9][0-9][0-9]
split -b "$chunk_bytes" -d -a 3 "$file" "$dir/$name."
if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | awk '{ print $1 }'; }
else
  sha256_of() { shasum -a 256 "$1" | awk '{ print $1 }'; }
fi
count=0
for chunk in "$dir/$name".[0-9][0-9][0-9]; do
  [ -f "$chunk" ] || continue
  printf '%s\t%s\t%s\n' "$(basename -- "$chunk")" "$(wc -c <"$chunk" | tr -d ' ')" "$(sha256_of "$chunk")"
  count=$((count + 1))
done
[ "$count" -ge 1 ] || die "split wrote no chunk of $file"
[ "$count" -le 999 ] || die "$file makes more than 999 chunks of $chunk_bytes bytes"
