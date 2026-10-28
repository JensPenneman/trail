# Trail

Self-hosted location history for iPhones and Android phones. A tracking app on
the phone — [Overland](https://github.com/aaronpk/Overland-iOS),
[OwnTracks](https://owntracks.org), [Traccar Client](https://www.traccar.org/client/),
[OsmAnd](https://osmand.net) or [GPSLogger](https://gpslogger.app) — posts its
points to Trail; people sign in with passkeys to see where their devices are,
where they have been, and that data keeps arriving.

It runs as a small Docker Compose stack on a home server, deployed by
Launchway, the owner's self-hosted deployment platform, which also runs its
tests: GitHub Actions publishes an image of every commit to GHCR, a release is
published and goes to production once the tests of its commit have passed,
and every pull request gets a preview deployment of its own.

## Features

- **Five tracking apps**: Overland's batch protocol (with visits, trips, app
  events and four remote settings presets sent back to the phone), OwnTracks
  in HTTP mode and Traccar's OsmAnd format (Traccar Client, OsmAnd, GPSLogger),
  each with duplicate-safe storage and a reject log for invalid points (a bad
  point never blocks a phone's queue). Adding a device shows exactly what its
  app needs: a setup code or link where the app takes one, every value with a
  copy button, and recommended settings.
- **Passkeys only**: no passwords. Several people per server, invites,
  one-time links to add a passkey on another device or address.
- **People, the home page**: one map with three views — **Live** (where
  everyone is now and today's tracks, updated over server-sent events, with
  your day so far as a timeline), **History** (tracks per day or date range
  with distance, visits and trips, and a time scrubber) and **Heat** (an
  all-time heatmap) — and beside it you and everyone who shares with you, a
  card each in the style of Find My: where they are, what they are doing and
  how fresh that is in two lines, where they have been while they are on the
  map, and everything else one tap away under Details. Show anyone on the
  map, alone or together, as far as their share allows, on a light, dark or
  (where the server has imagery) satellite map. Everything it shows is in its
  address, so a view can be bookmarked or shared.
- **How you travelled**: tracks in four levels — raw, averaged (noise
  smoothed), mapped onto OpenStreetMap roads and railways, and transport:
  stops and moves, each move with its mode (walking, cycling, car, bus, tram,
  metro, train, boat, plane …) worked out from speed, the ways followed,
  pauses at stops and the phone's motion sensor. A timeline per day, one-click
  corrections that survive every recomputation, and a quick "now I'm on the
  train" toggle ([docs/transport.md](docs/transport.md)).
- **Insights**: how you travelled in a period — distance, time on the move,
  moves, stops and active days against the period before, the mix of modes
  and its days, weeks or months, each mode's speeds, longest and fastest
  moves and the kinds of road it took, and the hours of the week you travel —
  with accessible charts drawn without a chart library.
- **Sharing**: share your location with family and friends in the spirit of
  Find My — one way, for an hour, until the end of the day, a week or until
  you stop, precisely or only roughly (about 500 m or 5 km), with or without
  history — and see who shares with you, with their battery, what they are
  doing and how far away they are. Public links show your location to
  someone without an account until the link expires. How it works:
  [docs/sharing.md](docs/sharing.md).
- **Devices**, in Settings: set up a phone by scanning a QR code; the proof
  that data still comes in — each phone's status, last upload, battery,
  movement, trip, position and two days of points and uploads per hour, and a
  feed of uploads as they arrive; a page per device with its ingest log, raw
  points, tracking settings and setup a level deeper, and token rotation.
- **Alerts** through [ntfy](https://ntfy.sh) when a device goes silent and
  when it recovers.
- **Your data**: export as GeoJSON, GPX or CSV; delete a range or the account.
- **Settings** in the style of the iPhone's: groups of rows with search
  (one's devices found by name), a page for every part (and for each device,
  passkey, share, public link and API token), the list beside the page on wide
  screens, and preferences the account takes to every browser — the map's
  style and the level of its tracks.
- **Public API**: a versioned JSON API under `/api/v1` for scripts, apps and
  agents — devices, positions, every recorded point, visits, trips, daily
  statistics, activity and the heatmap — described in OpenAPI 3.1 and
  browsable at `/docs`.
- **API tokens**: created in Settings, each with its own scopes, devices,
  expiry and optional IP allowlist; the secret is shown once, and a token can
  be rolled or revoked at any time.
- **Data access log**: who read your data and when — the people you share
  with, the visitors of your links, your tokens and agents, your own
  sessions — and what they saw, by the hour, without coordinates and for
  your eyes only: **Who viewed you** in Settings ("Ana looked at your live
  position 14 times and your history twice, last on Tuesday at 18:03", per
  day, a page per person, link and token), the filterable **Access log**,
  the use of each token, link and share on its page, and a card on Insights
  (`GET /api/v1/access-log`, a summary per 7, 30 or 90 days).
- **MCP server**: agents connect to `/mcp` with an API token and ask where
  the devices are, where they were at a time, the timeline of stops and
  moves, a day in figures, visits and trips, and the people who share with
  you, and can say how you travel now ([docs/mcp.md](docs/mcp.md)).
- **Operations**: one image for amd64 and arm64, releases deployed
  automatically, a preview per pull request, daily database dumps.

## Architecture

```mermaid
flowchart LR
  phone["Phones<br/>Overland, OwnTracks, Traccar Client, OsmAnd, GPSLogger"]
  browser["Browser<br/>passkeys"]
  ci["GitHub Actions<br/>image build, map data, releases"]
  ghcr["GHCR<br/>ghcr.io/jenspenneman/trail,<br/>trail-mapdata"]
  releases["GitHub releases<br/>and pull requests"]

  subgraph server["Home server: Launchway"]
    edge["Launchway edge<br/>HTTPS"]
    app["app<br/>API, ingest, dashboard"]
    worker["worker<br/>processing, map data"]
    db[("db<br/>PostgreSQL 18")]
    backup["backup<br/>daily pg_dump"]
    checks["checks<br/>lint, tests, end-to-end"]
  end

  folder[("backup folder")]

  phone -->|HTTPS| edge
  browser -->|HTTPS| edge
  edge --> app
  app --> db
  worker --> db
  backup --> db
  backup --> folder
  ci -->|"push image,<br/>monthly map data"| ghcr
  ci -->|"publish draft release<br/>after the checks"| releases
  releases -->|"webhooks: deploy, check"| server
  checks -->|"commit statuses"| releases
  ghcr -->|"pull image,<br/>map data"| app
```

Previews run the same stack as separate projects with their own host name
and database, without `backup`. The API (Express 5) serves the
ingest endpoints, the JSON API and the built single-page app from one
container on port 8080; a second container of the same image, the worker,
works out how the devices travelled, with CPUs and memory of its own, so
processing never slows the API down. PostgreSQL is reachable only on an
internal network.
The specification, including the data model, the HTTP API and the security
model, is [docs/architecture.md](docs/architecture.md).

## Development

Requirements: Node.js LTS (`.nvmrc`; `fnm use` or `nvm use`) and Docker for
the development database.

```sh
npm ci
cp .env.example .env
npm run dev
```

`npm run dev` starts PostgreSQL from `compose.yaml` (host port 54329), the API
with reload on port 8787, the processing worker with reload (its liveness
probe on port 8788) and Vite on <http://localhost:5173> — the API and the
worker in separate processes, as in production. Values in `.env` take
precedence over variables exported by your shell. To test with a real
phone on the same Wi-Fi, set `INGEST_BASE_URL` to the Mac's LAN address (see
`.env.example`).

| Script | What it does |
|---|---|
| `npm run dev` | database, API, processing worker and web app with reload |
| `npm run devc -- <arguments>` | `scripts/devc.sh`: [the development container](#develop-in-a-container) |
| `npm run build` | production build: `apps/web/dist` and `apps/api/dist` |
| `npm start` | runs the built server (`apps/api/dist/main.mjs`) |
| `npm run db:up` / `npm run db:down` | start / stop the development database |
| `npm run lint` / `npm run lint:fix` | Biome lint and format check / with fixes |
| `npm run format` | Biome format |
| `npm run typecheck` | TypeScript in every workspace |
| `npm test` | unit tests of every workspace and of the load harness |
| `npm run test:integration` | API tests against PostgreSQL (`TEST_DATABASE_URL`) |
| `npm run test:e2e` | Playwright against the built server (`E2E_DATABASE_URL`; run `npm run build` first) |
| `npm run test:load` | the load harness's own tests (also part of `npm test`) |
| `npm run load -- fleet-10` | a load test on the capped stack, its report in `docs/perf/` ([docs/perf/README.md](docs/perf/README.md)) |
| `npm run knip` | unused files, exports and dependencies |
| `npm run check` | lint, typecheck, knip and unit tests |
| `npm run db:generate -w @trail/api` | a new SQL migration from the Drizzle schema |

The development database also holds `trail_test` and `trail_e2e`:

```sh
TEST_DATABASE_URL=postgres://trail:trail@127.0.0.1:54329/trail_test npm run test:integration
E2E_DATABASE_URL=postgres://trail:trail@127.0.0.1:54329/trail_e2e npm run test:e2e
```

`npm run test:e2e` empties `trail_e2e` and starts the built server on port
4190 itself (run `npm run build` first). To run the same suite against a
deployment that is already up, such as a local Docker stack, point it there:
`E2E_BASE_URL=http://localhost:8080 npm run test:e2e`. The invitation tests
need the first account on that server, so they run on a fresh one only.

For coverage, pass the flag to the workspaces directly:
`npm run test --workspaces --if-present -- --coverage`.

The unit tests size their pool of workers to the CPUs, and to the machine's
cgroup CPU quota when there is one (a check in a Launchway container).
`VITEST_MAX_WORKERS=2 npm test` sets the size by hand; leave it out of
`npm run test:integration`, whose files share one database and run one after
the other, since it overrides that too.

Git hooks (lefthook) run Biome and the type check before a commit, commitlint
on the message ([Conventional Commits](https://www.conventionalcommits.org))
and the unit tests before a push.

### Develop in a container

`.devcontainer/` holds a development container: Node LTS, Chromium for the
end-to-end tests and a PostgreSQL of its own, so every check runs inside
Docker and several git worktrees can run theirs side by side. Launchway runs
the checks of pushes and pull requests in the same container on its node
([Checks on Launchway](#checks-on-launchway)). It needs Docker with the
Compose plugin; `scripts/devc.sh` drives it from anywhere in a worktree.

```sh
scripts/devc.sh up          # build the image when needed, start, npm ci
scripts/devc.sh npm test    # any command, run in the container
scripts/devc.sh down        # remove this worktree's containers and volumes
```

The first `up` builds the image (1.2 GB) and installs the modules, a minute
or two on a fast connection; later ones take seconds. `up` and every command
run `npm ci` again when `package-lock.json` has changed since the modules
were installed (after a pull, a rebase or a checkout); commands started
together install once.
Commands start the stack if it is not running and run in the matching
directory of the container. The test databases are preset there (`.env`
belongs to the host), so the other suites need no variables either:

```sh
scripts/devc.sh npm run test:integration
scripts/devc.sh npm run build && scripts/devc.sh npm run test:e2e
```

Playwright runs one worker per suite in the container (`E2E_WORKERS=1`). Its
browser draws the maps in software, a CPU's worth, and with more workers the
suites of three worktrees at once overload Docker Desktop's 8 CPUs until
tests time out. A suite takes about two minutes alone and about four with
two others beside it; when it runs alone,
`E2E_WORKERS=4 scripts/devc.sh npm run test:e2e` finishes in under one.

`scripts/devc.sh shell` opens a shell, `scripts/devc.sh ps` lists the
containers. A command has devc.sh's standard input and output to itself
(`scripts/devc.sh node < script.mjs > out.json`): starting the stack and
`npm ci` write to stderr.

Each worktree is a Compose project of its own, named after its branch:
`trail-<branch>` with `/` as `-`, for example `trail-chore-devcontainer`. It
has its own database, `node_modules` volumes (Linux builds, apart from the
host's) and network, and publishes no port on the host, so worktrees never
compete for one. VS Code's "Reopen in Container" uses the same project. Git
stays on the host: commit there, where the hooks run with the host's own
`npm ci`.

For the app in a browser on the host, `scripts/devc.sh up --web` publishes
Vite's port on a free port of the host's loopback and prints the address, for
example `http://localhost:59206`; `scripts/devc.sh npm run dev` then serves
the app there. Commands started through the script get that address as
`PUBLIC_URL`, the origin passkeys belong to. A plain `up` removes the port
again.

`scripts/devc.sh down` removes the project's containers, network and volumes,
the database included; run it before you delete a worktree or switch its
branch, since the project name follows the branch and the old project would
stay behind (`docker compose -p trail-<old-branch> down --volumes` removes it
later). The image stays for the next `up`.

## Production

[deploy/compose.yaml](deploy/compose.yaml) runs the app, the processing
worker, PostgreSQL and a backup job; Launchway deploys it and serves it over
HTTPS. Its variables are
in [deploy/.env.example](deploy/.env.example), and
[deploy/compose.dev.yaml](deploy/compose.dev.yaml) runs the same stack locally
from the working tree. The runbook, from the Launchway settings to previews,
backups and troubleshooting: [docs/operations.md](docs/operations.md).

### Releases, previews and rollback

GitHub Actions builds the image of every push to a branch of this repository
for amd64 and arm64, with provenance and an SBOM, and pushes it as
`sha-<short commit>` (`main` also as `latest`) within minutes, without waiting
for the tests. A pull request's preview runs that image.

release-please keeps a release pull request open with the next version and
its changelog. `scripts/release.sh` publishes it as a signed commit and tag
and a draft GitHub release; CI on the tag publishes the version's images and,
once the Launchway node's checks of the release commit have passed, the
release, and Launchway deploys it. To roll back, redeploy an older release in
Launchway. Dependabot keeps npm packages, GitHub Actions and the Node base
image current and merges minor and patch updates, security fixes among them,
once the required checks pass; majors, Biome and TypeScript are merged by
hand ([SECURITY.md](SECURITY.md#dependencies)). See
[Releases](docs/operations.md#releases).

### Checks on Launchway

Lint, type checks, knip, unit, integration and end-to-end tests run on the
Launchway node, in the development container of `.devcontainer/`, for every
push to `main` and every pull request into it. Every check starts from a
fresh Compose project with empty module volumes, so its command begins with
`npm ci --no-audit --no-fund`, and reports to GitHub as a commit status:

| Status | Command |
|---|---|
| `launchway/quality` | `npm run check` |
| `launchway/integration` | `npm run test:integration` |
| `launchway/e2e` | `npm run build && npm run test:e2e` |

With the image build (`image`, GitHub Actions) they are the checks that the
branch rules of `main` require. A failed check's log is in Launchway (Trail →
Checks; the status's Details link on GitHub opens the run). The node runs one
check at a time, so a commit's three take about 25 minutes once their turn
comes. Pull requests from forks get no checks: a maintainer pushes their
branch to this repository and opens the pull request from there, which runs
them. More in [docs/operations.md](docs/operations.md#checks).

## Phones

Install a tracking app, add a device in Trail and choose the app:

- **iPhone**: Overland (the most detail for the least battery, with visits,
  trips and settings sent from Trail), OwnTracks or Traccar Client.
- **Android**: OwnTracks, Traccar Client, GPSLogger, or OsmAnd's online
  tracking.

Overland, OwnTracks and Traccar Client set themselves up from the QR code or
link Trail shows; OsmAnd and GPSLogger take one URL to paste. The comparison,
every app's setup, recommended settings and troubleshooting:
[docs/trackers.md](docs/trackers.md); Overland's own guide:
[docs/overland.md](docs/overland.md).

## Public API and MCP

Every Trail server documents its public API at `/docs`: a reference generated
from the server's OpenAPI document (`/api/v1/openapi.json`), with the guide
[docs/api.md](docs/api.md) on top — tokens, scopes, the levels of the tracks
and the timeline, pagination, errors, rate limits, CORS and the versioning
promise. Scripts, apps and agents use an API token from Settings › API tokens:

```sh
curl -H "Authorization: Bearer trlk_…" https://trail.example.com/api/v1/tokens/verify
```

Agents can also use Trail as an MCP server at `/mcp`: any MCP client that
speaks Streamable HTTP, with a token made from the Agent template in the
`Authorization` header. [docs/mcp.md](docs/mcp.md) has the tools, how to
connect and the privacy model.

How the API is built and how to add an operation: [docs/architecture.md
§8.3](docs/architecture.md#83-public-api-v1); how tokens work:
[§8.4](docs/architecture.md#84-api-tokens); the MCP server:
[§8.6](docs/architecture.md#86-mcp-server).

## Tech stack

- **API**: Node.js LTS, TypeScript 7, Express 5, PostgreSQL 18 with Drizzle
  ORM, zod, SimpleWebAuthn, pino; bundled with tsdown.
- **Web**: React 19, React Router 8, TanStack Query 5, MapLibre GL 6 with
  OpenFreeMap styles, plain CSS; built with Vite 8.
- **Shared**: `packages/contracts`, the zod schemas of the HTTP API used by
  both sides.
- **Tooling**: npm workspaces, Biome, knip, Vitest, Playwright, lefthook,
  commitlint.
- **Operations**: Docker (multi-stage, multi-platform image), Docker Compose,
  GitHub Actions, GHCR, release-please, Launchway.

## Repository layout

```
apps/api/            Express API, ingest of the tracking apps, CLI (Node LTS, TypeScript)
apps/web/            React single-page app, served by the API in production
packages/contracts/  zod schemas and types of the HTTP API
deploy/              compose stack for Launchway, .env example, local run
docs/                architecture (the specification), API and sharing guides, operations, phone setup, transport modes, load-test reports
scripts/             development, build, hook and release scripts
tools/load/          load tests: k6 scenarios, SSE probe, collector, reports (docs/perf/)
tests/e2e/           Playwright end-to-end tests
.devcontainer/       development container (scripts/devc.sh)
compose.yaml         development database
Dockerfile           the production image
```

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

Not licensed for reuse (`UNLICENSED`): all rights reserved.
