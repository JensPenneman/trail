# Operations: Trail on Launchway

Trail runs on Launchway, the owner's self-hosted deployment platform. Launchway
deploys `deploy/compose.yaml` from this repository in two ways:

- **Production**: every published GitHub release (`vX.Y.Z`) is deployed
  automatically. Releases come from release-please and
  `scripts/release.sh` ([Releases](#releases)).
- **Previews**: every pull request from a branch of this repository gets a
  deployment of its own, with its own host name and an empty database, so a
  change can be tried before it is merged ([Previews](#previews)).

The architecture behind it is in [architecture.md](architecture.md) (sections
3 and 13); phone setup is in [overland.md](overland.md). Commands run on the
Launchway server unless noted.

## What runs

| Service | Image | Production | Preview |
|---|---|---|---|
| `app` | `ghcr.io/jenspenneman/trail:sha-<commit>` | API, Overland ingest and the dashboard on port 8080 | the same, for the pull request's head commit |
| `db` | `postgres:18-alpine` | the database, in the volume `TRAIL_DB_VOLUME` | the database, in a volume of the preview's own project |
| `backup` | `postgres:18-alpine` | daily `pg_dump` into `BACKUP_DIR` (profile `production`) | not started |

Launchway names the Compose projects `launchway-trail` (production) and
`launchway-trail-pr-<number>` (previews); the containers are
`<project>-<service>-1`, for example `launchway-trail-app-1`. It attaches `app`
to its proxy network, where its edge forwards the route to port 8080; no host
port is published. `db` and `backup` sit on an internal network without a
route out.

Nothing is built on the server: CI builds and tests every commit and publishes
its image as `sha-<first 7 characters of the commit>` ([Images](#images)).

## The app in Launchway

| Setting | Value |
|---|---|
| Repository | `JensPenneman/trail` |
| Compose file | `deploy/compose.yaml` (only this one) |
| Route | `trail.jenspenneman.com` → service `app`, port 8080. Unprotected (phones upload without a browser session) and uncompressed (compression would buffer the `/api/events` stream) |
| Trusted | on: production bind-mounts `BACKUP_DIR` and uses a volume it did not create (`TRAIL_DB_VOLUME`); Launchway's Compose policy refuses both otherwise |
| Deploy releases automatically | on: a published release is deployed. Drafts are ignored, which is why CI publishes the draft only once the images exist |
| Previews | on, for pull requests from branches of this repository |

### Production variables

```ini
COMPOSE_PROFILES=production        # starts `backup`
POSTGRES_PASSWORD=<hex>            # openssl rand -hex 32; fixed once the database exists
PUBLIC_URL=https://trail.jenspenneman.com
TRAIL_DB_VOLUME=trail-db           # the existing database volume
BACKUP_DIR=/absolute/host/path     # existing, as the Docker daemon sees it
TRUST_PROXY=10.210.0.2             # Launchway's edge on its proxy network (the default)
SIGNUP_ALLOWLIST=you@example.com
TZ=Europe/Brussels
BACKUP_HOUR=3
BACKUP_KEEP_DAYS=14
BACKUP_KEEP_MONTHS=12
BACKUP_KEEP_YEARS=0
BACKUP_ON_START=false
```

Optional, as in [deploy/.env.example](../deploy/.env.example):
`INGEST_BASE_URL` (empty: phones post to `PUBLIC_URL`), `ADDITIONAL_ORIGINS`,
`ALERT_NTFY_URL`, `ALERT_NTFY_TOKEN`, `LIVE_WINDOW_MINUTES`,
`STALE_AFTER_HOURS`, `SESSION_TTL_DAYS`, `DEFAULT_TIMEZONE`, `LOG_LEVEL`,
`RATE_LIMIT_*`, `MAP_STYLE_LIGHT`, `MAP_STYLE_DARK` and `MAP_CONNECT_SRC`.

`BACKUP_DIR` must be absolute and must exist: a relative path would land in
the deployment's checkout, which Launchway deletes after later deployments,
and the mount does not create a missing folder (the `backup` container then
fails to start, naming the path).

Launchway adds its own variables to the `.env` it writes. Trail uses two:
`LAUNCHWAY_COMMIT_SHA_SHORT` (the image tag `sha-<commit>`) and
`LAUNCHWAY_PUBLIC_URL` (the https address of the deployment's host name, used
when `PUBLIC_URL` is empty). `LAUNCHWAY_ENVIRONMENT` (`production` or
`preview`) and `LAUNCHWAY_PREVIEW_NUMBER` are available but unused.

### Preview variables

A preview needs only `POSTGRES_PASSWORD` (any hex value; its database is new)
and `SIGNUP_ALLOWLIST` (to create the first account). Everything that ties a
deployment to production must be **empty** in a preview; when previews start
from the production variables, override these:

```ini
COMPOSE_PROFILES=                  # no backup service, no host folder
TRAIL_DB_VOLUME=                   # a volume of the preview's own project
PUBLIC_URL=                        # the preview's own address (LAUNCHWAY_PUBLIC_URL)
INGEST_BASE_URL=
ALERT_NTFY_URL=                    # no alerts from test data
```

`TRAIL_DB_VOLUME` matters most: a preview with the production volume would
run a second Postgres on the production data and corrupt it.

## Install

On a server without Trail:

1. Create the database volume once, by hand, so that no Compose command ever
   deletes it ([Your data](#your-data)): `docker volume create trail-db`.
2. Create the backup folder (`BACKUP_DIR`).
3. If the GHCR package is private, give Launchway's server credentials for
   `ghcr.io` (a classic token with only `read:packages`); a public package
   needs nothing.
4. Create the app in Launchway as above and publish a release (or deploy the
   latest one by hand).
5. Open `https://trail.jenspenneman.com`, enter the address from
   `SIGNUP_ALLOWLIST` and create a passkey. The first account is the admin;
   others join through the allowlist or an invite (Settings > People).
6. Add a phone: Devices > Add device, scan the QR code with the iPhone's
   Camera app; Overland opens with endpoint, token and device ID filled in
   ([overland.md](overland.md)).

```sh
curl -i https://trail.jenspenneman.com/api/health      # 200: app and database are up
docker ps --filter name=launchway-trail-                # app and db healthy, backup up
```

## Releases

release-please keeps a release pull request open that proposes the next
version (from the Conventional Commits on `main`) and its `CHANGELOG.md`
section. Every commit on `main` must carry a GPG signature, so that pull
request is not merged on GitHub; the maintainer publishes it with:

```sh
scripts/release.sh   # asks before it changes anything; --yes skips the questions
```

The script checks that the working tree is clean, that `main` equals
`origin/main`, that exactly one release pull request is open and is one commit
on top of that `main` (so the changelog covers everything the release ships),
and that neither the tag nor a release exists yet. Then it:

1. cherry-picks the release commit onto `main` with `-x`, makes the maintainer
   its author and verifies the commit's signature;
2. creates the signed tag `vX.Y.Z` and pushes `main` and the tag together;
3. creates the GitHub release **as a draft**, with the version's
   `CHANGELOG.md` section as notes, and shows the CI run of the tag
   (dispatching CI on the tag itself if none starts);
4. closes the release pull request with a comment and deletes its branch.

CI on the tag runs every test, publishes the images (`X.Y.Z`, `X.Y`,
`sha-<commit>`) and then **publishes the draft** (job `release`). Launchway
deploys on that `published` event, so the image always exists by then. If the
script stops before the push, it moves `main` back and deletes the tag; after
the push, it prints the commands that are left. It needs git with commit
signing, an authenticated GitHub CLI and Node.js.

When the release pull request is not one commit on top of `main`,
release-please has not processed the latest push yet: wait for the Release
Please workflow, then run the script again.

Two fallbacks keep a release from getting stuck:

- **Merged on GitHub** (not the normal path): release-please creates the draft
  release itself (`"draft": true` in `release-please-config.json`); its
  workflow creates the tag and starts CI on it, which publishes the draft.
- **A tag pushed by hand** without a release: CI creates and publishes the
  release once the images exist, with the `CHANGELOG.md` section (or
  generated notes) as text.

Optional: a pull request opened with `GITHUB_TOKEN` starts no workflows, which
does not matter for a release pull request that is never merged. A
fine-grained token with `contents` and `pull-requests` write access in the
`RELEASE_PLEASE_TOKEN` secret makes CI run on it anyway.

## Previews

Every pull request from a branch of this repository gets a preview: Launchway
deploys its head commit as the Compose project `launchway-trail-pr-<number>`
on a host name of its own, and redeploys it on every push. Pull requests from
forks get no preview, and CI never publishes their images.

- **Image.** CI publishes `sha-<commit>` for every push to a branch of this
  repository once all tests pass, roughly a quarter of an hour after the push.
  Launchway retries the pull for up to an hour, so a preview appears when its
  image does. A failing test means no image and no preview.
- **Database.** Empty, in a volume of the preview's project, removed with the
  preview. Migrations run on boot as in production.
- **Sign-in.** Passkeys are bound to a host name, so every preview needs its
  own account: sign up with an address from `SIGNUP_ALLOWLIST`.
- **Phones.** Overland can post to a preview like to production (Devices > Add
  device in the preview), for example with a test device. Do not move a real
  device there: its points would end up in a database that disappears.
- **No backups.** The `backup` service runs only with the `production`
  profile, so a preview needs no host folder.

`PUBLIC_URL` falls back to `LAUNCHWAY_PUBLIC_URL`, so a preview serves its own
address without any setting ([Preview variables](#preview-variables)).

## Images

CI (`.github/workflows/ci.yml`) runs lint, type checks, unit, integration and
end-to-end tests, then builds `ghcr.io/jenspenneman/trail` for amd64 and arm64
with provenance and an SBOM:

| Trigger | Tags published |
|---|---|
| push to any branch of this repository | `sha-<commit>`, the branch name (`/` becomes `-`) |
| push to `main` | the above and `latest` |
| tag `vX.Y.Z` | `sha-<commit>`, `X.Y.Z`, `X.Y`; then the draft release is published |
| weekly schedule (Monday 03:00 UTC) | `main`, `latest` and `sha-<commit>` of `main`, rebuilt on the current base image |
| pull request | nothing: build only (forks never publish) |

Dependabot's branches only build, because their runs have a read-only token.
Deployments always pin `sha-<commit>`; `latest` is only the newest build of
`main`.

What is running: Settings > About in the dashboard, or

```sh
curl -s https://trail.jenspenneman.com/api/config   # version, commit, builtAt
```

The commit is the short SHA of the image's `sha-<commit>` tag.

## Rollback

Redeploy an older release in Launchway (the app's deployments list): it pulls
that release's `sha-<commit>` image again. Migrations only move forward, so an
older image runs against the newer schema; when that does not work, restore
the dump made before the update ([Backups](#backups)).

## Your data

Every point, visit, trip and event is kept forever; Trail itself only ever
deletes recorded data when you ask it to (Settings > Data: delete a range,
delete a device, delete the account).

| Event | The data |
|---|---|
| A deployment (release, rollback), container recreated | stays: it lives in the `trail-db` volume, not in a container |
| Database migration on boot | runs in one transaction under a lock; a failure rolls back and the app refuses to start, data untouched. CI upgrades a database of the first release, with data, to every new release before an image ships |
| Postgres update (18.x) | happens when the server pulls a newer `postgres:18-alpine`; the data directory stays compatible within Postgres 18 |
| `docker compose down -v` in the production project | stays: Compose only removes volumes it created, and `trail-db` was created by hand |
| A preview is removed | only the preview's own volume goes |
| Postgres 19 | never automatic: see [Postgres major upgrade](#postgres-major-upgrade) |
| `docker volume rm trail-db`, a wiped Docker data directory | **gone**: restore from the backups. Never do this without a fresh dump |
| The server's disk fails | gone from the server: the backups in `BACKUP_DIR` survive if it is on another disk or synced off-site |

## Backups

The `backup` service (production only) dumps the database every day at
`BACKUP_HOUR` (local time in `TZ`) to `BACKUP_DIR/trail-<UTC timestamp>.dump`
(PostgreSQL custom format). A dump counts only once `pg_restore` can read it
back. Layout and retention:

| Folder of `BACKUP_DIR` | What | Kept |
|---|---|---|
| (top) `trail-<timestamp>.dump` | every daily dump | `BACKUP_KEEP_DAYS` (14) |
| `monthly/trail-<YYYY-MM>.dump` | the first dump of each month | `BACKUP_KEEP_MONTHS` (12; 0 = forever) |
| `yearly/trail-<YYYY>.dump` | the first dump of each year | `BACKUP_KEEP_YEARS` (0 = forever) |
| `pre-update/` | dumps of the former standalone stack, if any | `BACKUP_KEEP_DAYS` |

Every dump holds the whole history, so the newest one is all a restore needs.
It also dumps right after starting when the newest dump is more than a day
old, or every start with `BACKUP_ON_START=true`. A failed dump stops the
container, Docker restarts it and the restart tries again, so a failing backup
shows up as "Restarting".

```sh
docker logs launchway-trail-backup-1   # "backup complete: trail-....dump, 1234 KiB in 2 s"
```

**Dump now** (before a risky change):

```sh
docker exec launchway-trail-backup-1 sh -c 'pg_dump --format=custom --file=/backups/trail-$(date -u +%Y%m%dT%H%M%SZ).dump && ls -l /backups'
```

**Restore** into the running deployment (replaces the current data):

```sh
docker stop launchway-trail-app-1
docker exec launchway-trail-backup-1 pg_restore --clean --if-exists --single-transaction --dbname=trail /backups/trail-20261001T010000Z.dump
docker start launchway-trail-app-1
```

**Restore on a new server:** install as above, copy the dumps into
`BACKUP_DIR`, deploy, then restore as above. The app applies newer migrations
on boot. Restore a dump now and then to be sure the backups work.

## Postgres major upgrade

The `db` image stays on Postgres 18. Dependabot opens a pull request when a new
major exists; it never merges itself. Postgres 18+ images keep the cluster in
`/var/lib/postgresql/<major>/docker`, so a new major starts next to the old
data in the same volume, empty. Move the data with a dump:

1. `docker stop launchway-trail-app-1`, then [dump now](#backups).
2. Merge the pull request and release it; the deployment starts the new,
   empty database, and the app creates an empty schema in it.
3. Restore the dump into it as under "Restore" in [Backups](#backups), which
   stops the app first and starts it again afterwards.
4. Once everything checks out, remove the old cluster:
   `docker exec launchway-trail-db-1 rm -rf /var/lib/postgresql/18`.

## Change the database password

`POSTGRES_PASSWORD` is applied only when the database is created. To change
it, set it in the database first, then in Launchway, and redeploy:

```sh
docker exec launchway-trail-db-1 psql -U trail -d trail -c "ALTER USER trail PASSWORD '<new hex password>'"
```

## Changing the public address

Passkeys are bound to a host name, and every phone posts to the address in its
setup QR code. After a new `PUBLIC_URL`:

1. **Add a passkey for the new address.** While the old address still works,
   Settings > "Add a passkey on another device or address", pick the new
   address and open the link (or its QR code) on the device that should hold
   the passkey. The link is valid for 15 minutes and works once. Without a
   working sign-in, create the link with the CLI:
   `docker exec launchway-trail-app-1 trail passkey-link you@example.com --origin https://<new address>`.
2. **Move each phone.** Devices > the device > Rotate token shows a new QR code
   with the new endpoint; scan it with the phone right away (the old token
   stops working at once). Points queued on the phone are kept.

## Logs

Launchway shows each service's logs; on the server:

```sh
docker logs -f launchway-trail-app-1     # the app logs JSON lines (pino)
docker logs --since 1h launchway-trail-app-1 2>&1 | grep '"level":50'   # errors
```

Every container keeps at most 5 files of 10 MB of logs. Device tokens, cookies
and coordinates never appear in the app's logs at the default level.

## Local run

`deploy/compose.dev.yaml` builds the working tree into an image and runs the
stack on `http://localhost:8080`, like a preview (no backup, a volume of its
own). Its header lists the four variables `deploy/.env` needs; then, in
`deploy/`:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
E2E_BASE_URL=http://localhost:8080 npm run test:e2e   # from the repository root, on a fresh database
docker compose -f compose.yaml -f compose.dev.yaml down -v
```

Day-to-day development uses `npm run dev` instead (README).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The deployment fails at the pull of `sha-<commit>` | CI has not published that commit yet (tests still running or failed). Launchway retries for an hour; check the commit's CI run. |
| A release was tagged but nothing deployed | The release is still a draft: CI publishes it after the images. Check the tag's CI run, job `release`. |
| `required variable POSTGRES_PASSWORD is missing a value` | Set it in Launchway (production and previews). |
| `required variable LAUNCHWAY_COMMIT_SHA_SHORT is missing` | Outside Launchway: a local run sets `TRAIL_IMAGE` ([Local run](#local-run)). |
| `backup` does not start: "bind source path does not exist" | `BACKUP_DIR` is unset or the folder does not exist; create it, absolute path. |
| No `backup` container in production | `COMPOSE_PROFILES=production` is missing. |
| Compose warns that volume `trail-db` "was not created by Docker Compose" | Expected: the volume was created by hand, which keeps `down -v` away from it. |
| `app` keeps restarting; its log says "Invalid configuration" | A value is invalid; the log names it. Fix it in Launchway and redeploy. |
| `/api/health` answers 503 | The database is down: `docker logs launchway-trail-db-1`. |
| Requests all share one client address, or the session cookie is not `Secure` | `TRUST_PROXY` does not name Launchway's edge address. |
| "No passkey for this address" | Passkeys are per host name: a preview needs its own account; a new production address needs [a new passkey](#changing-the-public-address). |
| `backup` restarts with "pg_dump failed" | The database is not reachable; the log line before it shows why. |
| Backups happen at the wrong hour | `TZ`. |

## Appendix: standalone (legacy)

Until October 2026 Trail ran as a standalone Compose stack on a Windows laptop
with Docker Desktop: Watchtower installed every new `latest` image, and the
app was public through a Cloudflare Tunnel, Caddy with Let's Encrypt, or a
shared reverse proxy. Launchway replaced all of that, and those services, the
profiles `tunnel` and `direct`, `deploy/compose.proxy.yaml` and the Windows
helper are gone. The last version of that stack and its runbook are in the
history of this repository at commit `3e560ee` (`deploy/`,
`docs/operations.md`).

<!-- preview smoke test: Launchway pull-request previews (2026-10-07) -->
