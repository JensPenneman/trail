#!/bin/sh
# The development container of this worktree (.devcontainer): Node LTS,
# Chromium for the end-to-end tests and a PostgreSQL of its own, in a Compose
# project named after the branch (trail-<branch>, "/" as "-"), so that several
# worktrees run side by side. Works from any directory; POSIX sh (macOS bash
# 3.2, dash).
#
#   scripts/devc.sh up [--web]     build when needed, start, install the modules;
#                                  --web publishes the web app on a free host port
#   scripts/devc.sh <command...>   runs the command in the container (npm test)
#   scripts/devc.sh shell          a shell in the container
#   scripts/devc.sh ps             this worktree's containers
#   scripts/devc.sh down           removes them, the database and modules too
#
# Commands start the stack first when it is not running, and run `npm ci`
# first when package-lock.json has changed since the last install.
set -eu

usage='usage: scripts/devc.sh up [--web] | shell | ps | down | <command...>'
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
devcontainer=$root/.devcontainer
# Vite's port in the container (apps/web/vite.config.ts)
web_port=5173

fail() {
  printf 'devc: %s\n' "$1" >&2
  exit 1
}

# A detached HEAD has no branch: the worktree's directory name stands in.
branch=$(git -C "$root" symbolic-ref --quiet --short HEAD 2>/dev/null) || branch=$(basename -- "$root")
# Compose project names allow lowercase letters, digits, "-" and "_" only.
COMPOSE_PROJECT_NAME=trail-$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-')
export COMPOSE_PROJECT_NAME

# Docker Desktop shows files that the container creates in the worktree as the
# host user's; a Linux host keeps their uid, so the image takes the caller's.
if [ "$(uname -s)" = Linux ] && [ "$(id -u)" != 0 ]; then
  TRAIL_DEVC_UID=$(id -u)
  TRAIL_DEVC_GID=$(id -g)
  export TRAIL_DEVC_UID TRAIL_DEVC_GID
fi

# A command that fails is not a Compose error to debug: no Docker Desktop hints.
DOCKER_CLI_HINTS=false
export DOCKER_CLI_HINTS

compose() {
  docker compose --file "$devcontainer/compose.yaml" "$@"
}

running() {
  [ -n "$(compose ps --status running --quiet dev 2>/dev/null)" ]
}

# The address `up --web` published, if it did. localhost, not 127.0.0.1:
# browsers allow passkeys on a domain or localhost only.
web_url() {
  address=$(compose port dev "$web_port" 2>/dev/null) || return 1
  [ -n "$address" ] || return 1
  printf 'http://localhost:%s\n' "${address##*:}"
}

# What devcontainer.json's postCreateCommand does, and again whenever the
# lockfile differs from the one the modules were installed from: the modules
# live in the container's volumes, and a pull, a rebase or a checkout can
# change the lockfile under a running stack. `up` and every command check it
# first. The lock, outside the volume `npm ci` empties, keeps commands that
# start together from installing at the same time: the others wait and find
# the modules current. Its output goes to stderr, so a command's own output
# stays as it is.
install_modules() {
  compose exec --no-TTY dev flock /tmp/devc-modules.lock sh -c '
    cmp -s package-lock.json node_modules/.devc-package-lock.json && exit 0
    echo "devc: npm ci (new volumes or a changed package-lock.json)"
    npm ci --no-audit --no-fund && cp package-lock.json node_modules/.devc-package-lock.json
  ' >&2
}

up() {
  web=false
  for option in "$@"; do
    case $option in
      --web) web=true ;;
      *) fail "unknown option for up: $option" ;;
    esac
  done
  if $web; then set -- --file "$devcontainer/compose.web.yaml"; else set --; fi
  # Without --web a published port goes away again: Compose recreates `dev`.
  compose "$@" up --detach --build --wait
  install_modules
  if url=$(web_url); then
    printf 'devc: %s is up; the web app (scripts/devc.sh npm run dev) is on %s\n' "$COMPOSE_PROJECT_NAME" "$url"
  else
    printf 'devc: %s is up\n' "$COMPOSE_PROJECT_NAME"
  fi
}

run() {
  if running; then install_modules; else up; fi
  # Called from inside the worktree, the command runs in the same directory.
  here=$(pwd -P)
  case $here/ in
    "$root"/*) workdir=/workspaces/trail${here#"$root"} ;;
    *) workdir=/workspaces/trail ;;
  esac
  # A terminal only when there is one: pipes, scripts and CI have none.
  terminal=false
  if [ -t 0 ] && [ -t 1 ]; then terminal=true; fi
  if ! $terminal; then
    # Without a terminal Docker passes no signal on, and an interrupted devc.sh
    # would leave the command running in the container, holding its ports. So
    # there it runs in a process group of its own, which `forward` signals; the
    # traps only let that shell outlive the command to report its status.
    group=/tmp/devc-$$
    # shellcheck disable=SC2016 # expanded by the container's shell
    set -- setsid --wait sh -c 'trap : INT TERM HUP; echo $$ >"$0"; "$@"; status=$?; rm -f "$0"; exit "$status"' "$group" "$@"
  fi
  set -- --workdir "$workdir" dev "$@"
  # Passkeys need the API to know the origin the browser is on.
  if url=$(web_url); then set -- --env "PUBLIC_URL=$url" "$@"; fi
  # E2E_WORKERS of the host replaces the container's (compose.yaml).
  if [ -n "${E2E_WORKERS-}" ]; then set -- --env "E2E_WORKERS=$E2E_WORKERS" "$@"; fi
  if $terminal; then
    exec docker compose --file "$devcontainer/compose.yaml" exec "$@"
  fi
  trap 'forward INT 130' INT
  trap 'forward TERM 143' TERM
  trap 'forward HUP 129' HUP
  # An explicit <&0: a background command would read /dev/null instead.
  compose exec --no-TTY "$@" <&0 &
  client=$!
  status=0
  wait "$client" || status=$?
  # After a forwarded signal, the output the command prints while it stops
  if [ -n "${interrupted-}" ]; then
    wait "$client" || true
    exit "$interrupted"
  fi
  exit "$status"
}

forward() {
  # shellcheck disable=SC2016 # expanded by the container's shell
  compose exec --no-TTY dev sh -c 'kill -s "$1" -- "-$(cat "$0")" 2>/dev/null; rm -f "$0"' "$group" "$1" || true
  interrupted=$2
}

# initializeCommand of devcontainer.json, run on the host before every start:
# Dev Containers clients take the project name (and the ids above) from
# .devcontainer/.env, which Compose reads for this project. Git-ignored.
initialize() {
  {
    printf '# Written by scripts/devc.sh --initialize (devcontainer.json)\n'
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$COMPOSE_PROJECT_NAME"
    if [ -n "${TRAIL_DEVC_UID-}" ]; then
      printf 'TRAIL_DEVC_UID=%s\nTRAIL_DEVC_GID=%s\n' "$TRAIL_DEVC_UID" "$TRAIL_DEVC_GID"
    fi
  } >"$devcontainer/.env"
}

case ${1-} in
  -h | --help)
    printf '%s\n' "$usage"
    exit 0
    ;;
  '')
    printf '%s\n' "$usage" >&2
    exit 2
    ;;
  --initialize)
    initialize
    exit 0
    ;;
  -*)
    printf '%s\n' "$usage" >&2
    exit 2
    ;;
esac

command -v docker >/dev/null 2>&1 || fail "needs Docker with the Compose plugin"

case $1 in
  up)
    shift
    up "$@"
    ;;
  shell)
    shift
    run bash "$@"
    ;;
  ps)
    shift
    compose ps "$@"
    if url=$(web_url); then printf 'web: %s\n' "$url"; fi
    ;;
  down)
    shift
    compose down --volumes --remove-orphans "$@"
    ;;
  *) run "$@" ;;
esac
