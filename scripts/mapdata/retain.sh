#!/usr/bin/env bash
# Deletes a region's old builds from the GHCR package of the map data
# (docs/design/self-hosted-maps.md §4.1, step 5): keeps the newest --keep
# builds by the day in their tag <region>-<yyyymmdd> and whatever <region>
# points at, and deletes every other version tagged <region>-<yyyymmdd>, with
# its build provenance attestation (GHCR has no referrers API, so the
# attestation is the version tagged sha256-<hex of the build's digest>).
# --also deletes a build a rebuild left untagged (publish.sh's `previous`),
# if no tag but an attestation's names it any more. A version that carries
# another region's tag is never touched.
#
# .github/workflows/mapdata.yml runs it after publishing, with the job's
# token (packages: write; the repository needs the Admin role in the
# package's Actions access, which it gets as the package's publisher).
#
# Usage: scripts/mapdata/retain.sh [options] --region <region>
#
#   --keep N          builds to keep (default 3)
#   --also DIGEST     a superseded build to delete as well (repeatable)
#   --package NAME    the container package (default: trail-mapdata)
#   --owner NAME      its owner (default: $GITHUB_REPOSITORY_OWNER)
#   --summary FILE    append a Markdown summary
#   --dry-run         say what would be deleted; delete nothing
set -euo pipefail

say() { printf '==> %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
usage() { sed -n '/^# Usage:/,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; }
value() { [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"; }

region='' keep=3 package=trail-mapdata owner=${GITHUB_REPOSITORY_OWNER:-} summary='' dry_run=false
also=()
while (($# > 0)); do
  case $1 in
    --region) value "$@"; region=$2; shift ;;
    --keep) value "$@"; keep=$2; shift ;;
    --also) value "$@"; also+=("$2"); shift ;;
    --package) value "$@"; package=$2; shift ;;
    --owner) value "$@"; owner=$2; shift ;;
    --summary) value "$@"; summary=$2; shift ;;
    --dry-run) dry_run=true ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown argument $1 (see --help)" ;;
  esac
  shift
done
case $region in
  '' | *[!a-z0-9-]* | -*) die "--region takes a region: '$region'" ;;
esac
case $keep in
  '' | *[!0-9]* | 0) die "--keep takes a number of builds, 1 or more: '$keep'" ;;
esac
[ -n "$owner" ] || die "no owner: --owner, or GITHUB_REPOSITORY_OWNER"
for digest in "${also[@]}"; do
  [[ $digest =~ ^sha256:[0-9a-f]{64}$ ]] || die "--also takes a digest: '$digest'"
done
for tool in gh jq; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is missing"
done

case $(gh api "users/$owner" --jq .type) in
  Organization) base="orgs/$owner" ;;
  User) base="users/$owner" ;;
  *) die "$owner is neither a user nor an organisation" ;;
esac
versions=$(gh api --paginate "$base/packages/container/$package/versions?per_page=100" | jq -s 'add // []')

# The plan: every version to delete, with why, as {id, name, why}
also_json=$(printf '%s\n' "${also[@]}" | jq -R -s 'split("\n") | map(select(length > 0))')
plan=$(jq --arg region "$region" --argjson keep "$keep" --argjson also "$also_json" '
  def tags: .metadata.container.tags // [];
  def dated: [tags[] | select(test("^" + $region + "-[0-9]{8}$"))];
  def regional: [tags[] | select(. == $region or test("^" + $region + "-[0-9]{8}$"))];
  def attestation($digest): "sha256-" + ($digest | ltrimstr("sha256:"));
  . as $versions
  | [$versions[] | select((dated | length) > 0)
      | . + { day: (dated | max | .[-8:]), moving: (tags | index($region) != null) }]
    | sort_by(.day, .created_at) | reverse as $builds
  # every version of the region is a build of its own region only: one that
  # carries another region'"'"'s tags too is left alone
  | ([$builds[] | select((tags | map(select(test("^sha256-") | not)) | length) == (regional | length))]) as $own
  | ([$own | to_entries[] | select(.key >= $keep and (.value.moving | not)) | .value
      | { id, name, why: "older than the newest \($keep)" }]
     + [$versions[] | select(.name as $name | $also | index($name))
      | select([tags[] | select(test("^sha256-") | not)] | length == 0)
      | { id, name, why: "replaced by a rebuild" }]) as $old
  | $old + [$old[] as $build | $versions[] | select(tags | index(attestation($build.name)))
      | { id, name, why: "the attestation of \($build.name)" }]
  | unique_by(.id)' <<<"$versions")

kept=$(jq -r --arg region "$region" '[.[] | select((.metadata.container.tags // []) | any(test("^" + $region + "-[0-9]{8}$")))] | length' <<<"$versions")
count=$(jq 'length' <<<"$plan")
say "$region: $kept builds in $package, $count versions to delete (keeping $keep)"
failed=0
lines=()
while IFS=$'\t' read -r id name why; do
  [ -n "$id" ] || continue
  if $dry_run; then
    say "would delete $name ($why)"
    lines+=("would delete \`$name\` ($why)")
  elif gh api -X DELETE "$base/packages/container/$package/versions/$id" >/dev/null; then
    say "deleted $name ($why)"
    lines+=("deleted \`$name\` ($why)")
  else
    failed=$((failed + 1))
    lines+=("could not delete \`$name\` ($why)")
  fi
done < <(jq -r '.[] | [(.id | tostring), .name, .why] | @tsv' <<<"$plan")

# shellcheck disable=SC2016 # the backticks are Markdown's
if [ -n "$summary" ]; then
  {
    printf '### Retention: %s\n\n' "$region"
    printf '%s builds tagged `%s-<yyyymmdd>` in `%s`; the newest %s stay.\n' "$kept" "$region" "$package" "$keep"
    if [ "${#lines[@]}" -eq 0 ]; then printf '\nNothing to delete.\n'; fi
    for line in "${lines[@]}"; do printf -- '- %s\n' "$line"; done
    printf '\n'
  } >>"$summary"
fi
[ "$failed" -eq 0 ] || die "$failed versions could not be deleted"
