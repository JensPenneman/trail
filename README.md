# Trail

Self-hosted location history for the iOS GPS logger
[Overland](https://github.com/aaronpk/Overland-iOS). Phones post their GPS
batches to Trail; people sign in with passkeys to see where their devices are,
where they have been, and that data keeps arriving.

It runs as a small Docker Compose stack on a home server, deployed by
Launchway, the owner's self-hosted deployment platform: CI publishes an image
to GHCR after the tests pass, every published release goes to production, and
every pull request gets a preview deployment of its own.

## Features

- **Overland receiver**: the batch protocol with duplicate-safe storage, a
  reject log for invalid points (a bad point never blocks a phone's queue),
  visits, trips and app events, and three remote settings presets sent back
  to the phone.
- **Passkeys only**: no passwords. Several people per server, invites,
  one-time links to add a passkey on another device or address.
- **Live**: every device's position, battery, motion and last upload, updated
  over server-sent events, plus a feed of uploads as they arrive.
- **History**: tracks per day or date range with distance, visits and trips,
  and a time scrubber.
- **Explore**: an all-time heatmap.
- **Devices**: set up a phone by scanning a QR code; per-device ingest log,
  raw points, token rotation.
- **Alerts** through [ntfy](https://ntfy.sh) when a device goes silent and
  when it recovers.
- **Your data**: export as GeoJSON, GPX or CSV; delete a range or the account.
- **Operations**: one image for amd64 and arm64, releases deployed
  automatically, a preview per pull request, daily database dumps.

## Architecture

```mermaid
flowchart LR
  phone["iPhone<br/>Overland"]
  browser["Browser<br/>passkeys"]
  ci["GitHub Actions<br/>tests, image build"]
  ghcr["GHCR<br/>ghcr.io/jenspenneman/trail"]
  releases["GitHub releases<br/>and pull requests"]

  subgraph server["Home server: Launchway"]
    edge["Launchway edge<br/>HTTPS"]
    app["app<br/>API, ingest, dashboard"]
    db[("db<br/>PostgreSQL 18")]
    backup["backup<br/>daily pg_dump"]
  end

  folder[("backup folder")]

  phone -->|HTTPS| edge
  browser -->|HTTPS| edge
  edge --> app
  app --> db
  backup --> db
  backup --> folder
  ci -->|"push image"| ghcr
  ci -->|"publish draft release"| releases
  releases -->|"webhook: deploy"| server
  ghcr -->|pull| app
```

Previews run the same stack as separate projects with their own host name
and database, without `backup`. The API (Express 5) serves the
Overland endpoint, the JSON API and the built single-page app from one
container on port 8080; PostgreSQL is reachable only on an internal network.
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
with reload on port 8787 and Vite on <http://localhost:5173>. Values in `.env`
take precedence over variables exported by your shell. To test with a real
phone on the same Wi-Fi, set `INGEST_BASE_URL` to the Mac's LAN address (see
`.env.example`).

| Script | What it does |
|---|---|
| `npm run dev` | database, API and web app with reload |
| `npm run build` | production build: `apps/web/dist` and `apps/api/dist` |
| `npm start` | runs the built server (`apps/api/dist/main.mjs`) |
| `npm run db:up` / `npm run db:down` | start / stop the development database |
| `npm run lint` / `npm run lint:fix` | Biome lint and format check / with fixes |
| `npm run format` | Biome format |
| `npm run typecheck` | TypeScript in every workspace |
| `npm test` | unit tests of every workspace |
| `npm run test:integration` | API tests against PostgreSQL (`TEST_DATABASE_URL`) |
| `npm run test:e2e` | Playwright against the built server (`E2E_DATABASE_URL`; run `npm run build` first) |
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

Git hooks (lefthook) run Biome and the type check before a commit, commitlint
on the message ([Conventional Commits](https://www.conventionalcommits.org))
and the unit tests before a push.

## Production

[deploy/compose.yaml](deploy/compose.yaml) runs the app, PostgreSQL and a
backup job; Launchway deploys it and serves it over HTTPS. Its variables are
in [deploy/.env.example](deploy/.env.example), and
[deploy/compose.dev.yaml](deploy/compose.dev.yaml) runs the same stack locally
from the working tree. The runbook, from the Launchway settings to previews,
backups and troubleshooting: [docs/operations.md](docs/operations.md).

### Releases, previews and rollback

Every push to a branch of this repository runs lint, type checks, unit,
integration and end-to-end tests; when they pass, CI builds the image for
amd64 and arm64 with provenance and an SBOM and pushes it as
`sha-<short commit>` (`main` also as `latest`). A pull request's preview runs
that image.

release-please keeps a release pull request open with the next version and
its changelog. `scripts/release.sh` publishes it as a signed commit and tag
and a draft GitHub release; CI on the tag publishes the version's images and
then the release, and Launchway deploys it. To roll back, redeploy an older
release in Launchway. Dependabot keeps npm packages, GitHub Actions and the
Node base image current and merges minor and patch updates once CI is green.
See [Releases](docs/operations.md#releases).

## Phones

Install Overland from the App Store, add a device in Trail and scan its QR
code with the iPhone camera; Overland opens with everything filled in. Allow
location access "Always" and keep Logging Mode on "All Data". Recommended
settings and troubleshooting: [docs/overland.md](docs/overland.md).

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
apps/api/            Express API, Overland ingest, CLI (Node LTS, TypeScript)
apps/web/            React single-page app, served by the API in production
packages/contracts/  zod schemas and types of the HTTP API
deploy/              compose stack for Launchway, .env example, local run
docs/                architecture (the specification), operations, Overland
scripts/             development, build, hook and release scripts
tests/e2e/           Playwright end-to-end tests
compose.yaml         development database
Dockerfile           the production image
```

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

Not licensed for reuse (`UNLICENSED`): all rights reserved.
