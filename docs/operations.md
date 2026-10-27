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

`app` may use 1 GB (`mem_limit`) and its V8 heap at most 640 MB of it
(`NODE_OPTIONS=--max-old-space-size=640`): a processing backfill holds up to
~250 MB per piece, and the cap keeps the heap well under the container's
limit, so the kernel never OOM-kills the app in the middle of one. A server
that needs more raises both together in `deploy/compose.yaml`. Commands run
with `docker exec … trail` are a second Node process under the same 1 GB,
with a heap of their own: start a long `trail reprocess` when the worker is
not backfilling.

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
`MCP_ALLOWED_ORIGINS` (web pages of browser-based MCP clients, see
[docs/mcp.md](mcp.md)),
`ALERT_NTFY_URL`, `ALERT_NTFY_TOKEN`, `LIVE_WINDOW_MINUTES`,
`STALE_AFTER_HOURS`, `DATA_ACCESS_RETENTION_DAYS` (how long the data access
log keeps who looked, 365 days by default), `SESSION_TTL_DAYS`,
`DEFAULT_TIMEZONE`, `LOG_LEVEL`,
`RATE_LIMIT_*`, `MAP_STYLE_LIGHT`, `MAP_STYLE_DARK`, `MAP_CONNECT_SRC`,
`MAP_STYLE_SATELLITE` and `MAP_STYLE_SATELLITE_ATTRIBUTION`
([Satellite imagery](#satellite-imagery)) and the `PROCESSING_*` settings
([Processing](#processing)).

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
   others join through the allowlist or an invite (Settings > Accounts).
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
- **A migration regenerated after a rebase.** Drizzle applies only the
  migrations newer than the last one a database has applied (by the
  journal's timestamp), and a pull request rebased onto a `main` that gained
  a migration deletes its own and generates it again, under a new number.
  The preview's database already has the old version, so the new one fails
  ("already exists") and the app refuses to start; a migration of `main`
  older than the old version would even be skipped. A preview holds test
  data only, so start it over on an empty database, then redeploy the
  preview in Launchway (or push to the branch):

  ```sh
  docker compose -p launchway-trail-pr-<number> down
  docker volume rm launchway-trail-pr-<number>_trail-db
  ```
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
the dump made before the update ([Backups](#backups)). Back on the newer
release, run `trail recompute` ([Heatmap](#heatmap)): an older release keeps
fewer sizes of the heatmap. The server also rebuilds the sizes it finds out of
step at every start.

## Your data

Every point, visit, trip and event is kept forever; Trail itself only ever
deletes recorded data when you ask it to (Settings > Your data: delete a
period, delete the account; a device's page: delete the device). What
processing works out from it — averaged and mapped points, stops and moves,
the map cache — can always be worked out again; the transport modes people set
are kept like recorded data.

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

Shares and public links live in the same database, and so does the key that
places the cells of approximate and area shares (`server_secrets`,
`share-grid`, generated on first use): a restore keeps it, so everyone keeps
seeing the same cells. Never delete that row; a new key would move every cell,
and someone who saw both could narrow a position down. Stopped and ended
shares and links are removed 30 days later.

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
   Settings > Passkeys > "Add a passkey on another device or address", pick
   the new address and open the link (or its QR code) on the device that should hold
   the passkey. The link is valid for 15 minutes and works once. Without a
   working sign-in, create the link with the CLI:
   `docker exec launchway-trail-app-1 trail passkey-link you@example.com --origin https://<new address>`.
2. **Move each phone.** Devices > the device > Rotate token shows a new QR code
   with the new endpoint; scan it with the phone right away (the old token
   stops working at once). Points queued on the phone are kept.
3. **Public links** carry the address they were made on. Links sent before the
   change still work as long as the old address reaches the server; otherwise
   make new ones in Settings › Public links.

## Processing

Trail works out from the recorded points how each device travelled
([transport.md](transport.md) for the people using it,
[architecture.md §17](architecture.md#17-processing-and-transport-inference)
for the details): the averaged level (outliers dropped, noise smoothed), the
mapped one (snapped to roads and railways from OpenStreetMap), and the
inferred one — stops and moves, each move with its transport mode. All of it
lives in tables of its own and can be rebuilt; the recorded points are never
changed. One worker in the app does the work a few seconds after each upload;
after a release that changes the algorithms it works through the whole history
again, newest days first, while new uploads keep going first.

**Map data and Overpass.** Map data comes from the public Overpass instance
at `https://overpass-api.de/api/interpreter` (`PROCESSING_OVERPASS_URL`), one
query per map tile of about 1.5 km square. A tile stays cached for
`PROCESSING_OSM_TTL_DAYS` (90); after that it keeps serving and is fetched
again the next time a window needs it. Trail follows the instance's usage policy: one
request at a time, at most one every two seconds, a User-Agent that names the
software (`Trail/<version> (+https://github.com/JensPenneman/trail)`, never
your server's address), retries only for busy answers, with backoff, and at
most `PROCESSING_OVERPASS_DAILY_MB` (300 MB) a day. The first
days after an install or a long trip use the most; the places you visit again
are cached, and flights ask for nothing. The worker holds the map data of at
most about 256 tiles at a time (a few hundred MB in a city centre), however
long the trip. When the budget is spent, mapping pauses until midnight UTC and
the rest goes on (moves without their tiles are shown averaged until the
tiles arrive). The tiles requested tell the Overpass operator which squares
of about 1.5 km your devices passed through and when (fetches follow uploads),
from your server's IP address — not the tracks, and not who you are. To keep
that at home, point `PROCESSING_OVERPASS_URL` at an Overpass instance of your
own — it needs the same interpreter API — or set it empty: then nothing is
mapped and the mapped level shows the averaged one. Serving the map data from
a local OpenStreetMap extract is a possible later step (the `WaySource`
interface is there for it).

| Setting | Effect |
|---|---|
| `PROCESSING_ENABLED=false` | Nothing is queued or processed; what was worked out stays as it is |
| `PROCESSING_OVERPASS_URL=` (empty) | No map data: stops, moves and modes are still worked out, without map evidence |
| `PROCESSING_OVERPASS_DAILY_MB=100` | A smaller daily download budget |
| `PROCESSING_MAX_ACCURACY_M`, `PROCESSING_STOP_MIN_S` | The two thresholds worth tuning: points left out as inaccurate (150 m), the shortest stop (180 s) |

**Reprocess** after changing those thresholds, or to fill in the map after a
long budget pause:

```sh
docker exec launchway-trail-app-1 trail reprocess                                   # everything, from averaging on
docker exec launchway-trail-app-1 trail reprocess --device <id> --from 2026-10-01T00:00:00Z --to 2026-11-01T00:00:00Z
docker exec launchway-trail-app-1 trail reprocess --from-level inferred              # only stops, moves and modes
```

It works through the range in day windows and prints a line per device;
tiles it lacks are left to the server, which fetches them politely
afterwards. The modes people set are kept through every reprocessing.

The log tells what the worker does: `processing window done` (device, range,
points, segments, missing tiles, milliseconds), `map tile stored` (ways,
stops, bytes, milliseconds), `processing backfill queued` (days), and warnings
when a tile fails (with the kind of failure; it is tried again later) or the
daily budget is spent. Which tile — a place someone has been — is logged at
`LOG_LEVEL=debug` only, like coordinates.

## Heatmap

The heatmap is counted as the points arrive: every upload adds its points to
squares at six sizes, from about 600 km down to about 24 m (level 20, as fine
as GPS accuracy is worth), and the map sums them for every zoom in between.

**After an upgrade that adds a size.** Level 20 came with the street-level
heatmap; the points uploaded before it are not in it yet. About five seconds
after every start, the server compares the sizes of every device (a point
counts once in each) and builds the ones that miss points from the device's
points by itself — nothing to run. It goes a device at a time, and an upload
from that device waits until its squares are built (1 to 4 seconds for 1.2
million points), so nothing is counted twice. The log says
`heat cells filled in` per device (with the milliseconds) and
`heat levels filled in` at the end, or `heat levels stopped before every
device was done` when the server stopped first: the next start does the
rest.

**Rebuild** every size of every device (or of one) from the points — after
restoring data by hand, or whenever the heatmap looks wrong:

```sh
docker exec launchway-trail-app-1 trail recompute
docker exec launchway-trail-app-1 trail recompute --device <id>
```

It also rebuilds the daily statistics; an upload of a device waits while that
device is rebuilt (about 20 seconds for 1.2 million points).

## Satellite imagery

The map's style control offers Auto (light or dark with the system), Light,
Dark and — once the server has imagery — Satellite. Light and dark come from
OpenFreeMap (`MAP_STYLE_LIGHT`, `MAP_STYLE_DARK`). Trail ships no imagery:
`MAP_STYLE_SATELLITE` names it, in one of two forms.

- **A MapLibre style URL**, for a provider that publishes whole styles. For
  example [MapTiler](https://www.maptiler.com/maps/)'s satellite map, with an
  API key from a MapTiler account:

  ```sh
  MAP_STYLE_SATELLITE=https://api.maptiler.com/maps/satellite/style.json?key=<your key>
  ```

  The style credits its own sources on the map.
- **A raster tile URL template** with `{z}`, `{x}` and `{y}` (in the order the
  provider uses; MapLibre fills in nothing else, so `{s}` and other
  placeholders are refused at boot). Tiles are 256 px squares, used up to
  zoom 19. The provider's credit is then required and shown on the map as
  plain text:

  ```sh
  MAP_STYLE_SATELLITE=https://imagery.example.com/tiles/{z}/{x}/{y}.jpg
  MAP_STYLE_SATELLITE_ATTRIBUTION=Imagery © Example
  ```

The origin of the URL is added to the Content Security Policy (`img-src`,
`connect-src`), so its tiles load. A style that loads from more hosts (tiles,
fonts or sprites elsewhere) needs those in `MAP_CONNECT_SRC`; the browser
console names any it refuses. Unset or empty, the control has no Satellite.

**Terms of use.** Imagery is licensed, not open data: read the provider's
terms before you configure it. Most allow a limited number of requests a
month on a free plan, some only for personal or non-commercial use, and
nearly all require their credit on the map (which is why a template needs
`MAP_STYLE_SATELLITE_ATTRIBUTION`). A key in the URL reaches every browser
that opens Trail, and `/api/config` shows it without a sign-in: restrict the
key to Trail's addresses in the provider's dashboard (MapTiler: *Allowed HTTP
origins*), and rotate it there if it leaks. Like the OpenFreeMap tiles, the
imagery tiles a browser loads tell the provider which areas it shows, from the
browser's address: not the tracks, and not who is looking.

## Logs

Launchway shows each service's logs; on the server:

```sh
docker logs -f launchway-trail-app-1     # the app logs JSON lines (pino)
docker logs --since 1h launchway-trail-app-1 2>&1 | grep '"level":50'   # errors
docker logs launchway-trail-app-1 2>&1 | grep '"msg":"API token'      # API tokens created, changed, rolled, revoked
```

Every container keeps at most 5 files of 10 MB of logs. Device and API tokens,
cookies, coordinates and map tiles never appear in the app's logs at the
default level; the API token lines carry the token's and the user's id only.

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
| An API token with an IP allowlist is refused (401) from an allowed address | The same: without the edge in `TRUST_PROXY` every request seems to come from the edge. Settings › API tokens shows the address a token was last used from. |
| "No passkey for this address" | Passkeys are per host name: a preview needs its own account; a new production address needs [a new passkey](#changing-the-public-address). |
| `backup` restarts with "pg_dump failed" | The database is not reachable; the log line before it shows why. |
| Backups happen at the wrong hour | `TZ`. |
| The mapped level shows averaged lines | No map data for that area yet: the tiles wait for the daily budget (log: "daily map download budget spent") or failed (log: "map tile could not be fetched"; tried again later). `PROCESSING_OVERPASS_URL` empty switches map data off altogether. |
| The map's style control has no Satellite | `MAP_STYLE_SATELLITE` is unset, or the app refused it at boot (the log names the variable). |
| Satellite stays blank or shows only some tiles | The browser console names the refused host: add it to `MAP_CONNECT_SRC`. Otherwise the provider refuses the key (usage limit, or the key is restricted to other origins). |
| Stops, moves or modes are missing for new points | The worker runs a few seconds after an upload; `PROCESSING_ENABLED=false` switches it off. A failed window is retried with backoff (log: "processing window failed"). |

## Appendix: standalone (legacy)

Until October 2026 Trail ran as a standalone Compose stack on a Windows laptop
with Docker Desktop: Watchtower installed every new `latest` image, and the
app was public through a Cloudflare Tunnel, Caddy with Let's Encrypt, or a
shared reverse proxy. Launchway replaced all of that, and those services, the
profiles `tunnel` and `direct`, `deploy/compose.proxy.yaml` and the Windows
helper are gone. The last version of that stack and its runbook are in the
history of this repository at commit `3e560ee` (`deploy/`,
`docs/operations.md`).
