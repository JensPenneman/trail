# Operations: Trail on Launchway

Trail runs on Launchway, the owner's self-hosted deployment platform. Launchway
deploys `deploy/compose.yaml` from this repository in two ways:

- **Production**: every published GitHub release (`vX.Y.Z`) is deployed
  automatically. Releases come from release-please and
  `scripts/release.sh` ([Releases](#releases)).
- **Previews**: every pull request from a branch of this repository gets a
  deployment of its own, with its own host name and an empty database, so a
  change can be tried before it is merged ([Previews](#previews)).

It also runs the tests of every push to `main` and every pull request on its
node and reports them to GitHub, where the branch rules require them
([Checks](#checks)).

The architecture behind it is in [architecture.md](architecture.md) (sections
3, 13 and 15); phone setup is in [trackers.md](trackers.md) (Overland's own
guide: [overland.md](overland.md)). Commands run on the Launchway server
unless noted.

## What runs

| Service | Image | Production | Preview |
|---|---|---|---|
| `app` | `trail-local:<commit>`, built on the server from the deployed ref | API, the phones' ingest and the dashboard on port 8080 (`PROCESSING_ROLE: api`: it queues the processing) | the same, for the pull request's head commit |
| `worker` | the same image, as `trail worker` | the processing worker (`PROCESSING_ROLE: worker`): the averaged, mapped and inferred levels, map data, the backfill; no HTTP server | the same; it idles on the empty database |
| `db` | `postgres:18-alpine` | the database, in the volume `TRAIL_DB_VOLUME` | the database, in a volume of the preview's own project |
| `backup` | `postgres:18-alpine` | daily `pg_dump` into `BACKUP_DIR` (profile `production`) | not started |
| `predeploy-dump` | `trail-local-predeploy-dump:<commit>`, `postgres:18-alpine` plus the migrations' journal, built on the server | a one-shot: a verified dump into `BACKUP_DIR/pre-update/` before `app` and `worker` start, on every deployment | runs and skips (`LAUNCHWAY_ENVIRONMENT=preview`): no dump |

`deploy/compose.yaml` fixes each container's role; `.env` cannot change it
([Processing](#processing)).

Launchway names the Compose projects `launchway-trail` (production) and
`launchway-trail-pr-<number>` (previews); the containers are
`<project>-<service>-1`, for example `launchway-trail-app-1` and
`launchway-trail-worker-1`. It attaches `app` to its proxy network, where its
edge forwards the route to port 8080; no host port is published. `worker`
publishes nothing and the edge never reaches it; it joins the project's
default network for Overpass. `db` and `backup` sit on an internal network
without a route out. `app` keeps the map data of its regions in
the volume `<project>_trail-map` ([Map data](#map-data)) and serves the
basemap from it ([The basemap](#the-basemap)).

Launchway builds the app's image on the server from the checked-out ref
(`build:` in `deploy/compose.yaml`, [Images](#images)); GitHub Actions
still builds and publishes `sha-<first 7 characters of the commit>`
to GHCR, but no deployment pulls it. The server runs the tests instead, for every push to
`main` and every pull request, in the development container
([Checks](#checks)).

Every container has explicit caps in `deploy/compose.yaml`, so processing
can never take the API's CPU or memory, and no container can take all of
the node's:

| Service | CPUs | Memory (`mem_limit`) | V8 heap (`NODE_OPTIONS`) |
|---|---|---|---|
| `app` | 2: a dashboard page asks 5–10 things at once, which one CPU would answer one after another | 1 GB | 640 MB |
| `worker` | 2 | 1 GB | 768 MB: a pass holds up to ~250 MB of map data per piece |
| `db` | 2 | 2 GB | — |
| `backup` | — | 512 MB | — |

Swap is capped at the same values (`memswap_limit`), so WSL does not double
them. The caps add up to 4.5 GB in production and 4 GB more for each preview:
the node's WSL VM has 10 GB (set 28 Oct 2026).
The CPUs of `app`, `worker` and `db` add up to six, which the node's WSL VM
(8 CPUs) holds with two to spare for Launchway and its edge; a Launchway check
asks for 6 CPUs, so one check beside Trail already competes for them, and two
concurrent checks at 6 CPUs each oversubscribe the 8 CPUs: they compete rather
than fit, so run one at a time. A cap is a ceiling, not a reservation, so the
containers only take CPUs while busy.
The heap stays well under each container's limit, so a heap that runs out
fails with an error in the log before the kernel would OOM-kill the
container; a server that needs more raises a limit and its heap together.
Commands run with `docker exec … trail` are a second Node process under the
same limit, with a heap of their own ([Processing](#processing)).

## The app in Launchway

| Setting | Value |
|---|---|
| Repository | `JensPenneman/trail` |
| Compose file | `deploy/compose.yaml` (only this one) |
| Route | `trail.jenspenneman.com` → service `app`, port 8080. Unprotected (phones upload without a browser session) and uncompressed (compression would buffer the `/api/events` stream) |
| Trusted | on: production bind-mounts `BACKUP_DIR` and uses a volume it did not create (`TRAIL_DB_VOLUME`); Launchway's Compose policy refuses both otherwise |
| Deploy releases automatically | on: a published release is deployed. Drafts are ignored, which is why CI publishes the draft only once the images exist and the checks have passed |
| Previews | on, for pull requests from branches of this repository |
| Checks | on: `quality`, `integration` and `e2e` in `.devcontainer/compose.yaml`, for `main` ([Checks](#checks)) |

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
and `backup`'s mount does not create a missing folder (the container then
fails to start, naming the path). `predeploy-dump`'s mount does create one
(Docker's short bind form, which Compose cannot switch with a variable), so a
mistyped path gets an empty folder there. The dump service therefore refuses a
folder that holds no daily `trail-*.dump` of `backup`'s. On a first install
(no daily dump yet) create the marker file once: `touch
$BACKUP_DIR/.trail-backup-dir`.

Launchway adds its own variables to the `.env` it writes. Trail uses three:
`LAUNCHWAY_COMMIT_SHA_SHORT` (the image tag `trail-local:<commit>` and the commit `/api/config` reports),
`LAUNCHWAY_PUBLIC_URL` (the https address of the deployment's host name, used
when `PUBLIC_URL` is empty; Launchway leaves it empty for an app without a
public route, which then needs `PUBLIC_URL` set) and `LAUNCHWAY_ENVIRONMENT`
(`production` or `preview`), which `predeploy-dump` uses to skip in a preview
(and to refuse an empty `BACKUP_DIR` in production) and `trail load-fleet` uses
to refuse anywhere but in a preview. `LAUNCHWAY_PREVIEW_NUMBER` is available
but unused. `PREDEPLOY_DUMP` is not a production variable: only
`deploy/compose.dev.yaml` sets it, so a forgotten value in `.env` can never
skip the dump of an update.

### Preview variables

A preview needs only `POSTGRES_PASSWORD` (any hex value; its database is new)
and `SIGNUP_ALLOWLIST` (to create the first account). Everything that ties a
deployment to production must be **empty** in a preview; when previews start
from the production variables, override these:

```ini
COMPOSE_PROFILES=                  # no backup service, no host folder
BACKUP_DIR=                        # empty, never production's: a preview mounts no host folder
TRAIL_DB_VOLUME=                   # a volume of the preview's own project
PUBLIC_URL=                        # the preview's own address (LAUNCHWAY_PUBLIC_URL)
INGEST_BASE_URL=
ALERT_NTFY_URL=                    # no alerts from test data
```

An empty `BACKUP_DIR` matters as well: `predeploy-dump` then mounts a volume
of the preview's own project, which is all a preview may mount (Launchway
refuses every host bind there), where production's folder would be refused.

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
6. Add a phone: Settings > Devices > Add device, choose its app and follow
   what Trail shows — for Overland, OwnTracks and Traccar Client a QR code that
   sets the app up ([trackers.md](trackers.md)).

```sh
curl -i https://trail.jenspenneman.com/api/health      # 200: app and database are up; "processing" says the worker is up
docker ps --filter name=launchway-trail-                # app, worker and db healthy, backup up
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

CI on the tag publishes the images (`X.Y.Z`, `X.Y`, `sha-<commit>`), waits
until the node's [checks](#checks) have passed on the tag's commit and then
**publishes the draft** (jobs `release-gate` and `release`). Launchway
deploys on that `published` event, so by then the image exists and the
checks are green. They are the checks of the push of `main` (the tag's commit
is its head), so a release takes about as long as they do. If the script
stops before the push, it moves `main` back and deletes the tag; after the
push, it prints the commands that are left. It needs git with commit
signing, an authenticated GitHub CLI and Node.js.

**The release gate.** The `release-gate` job lists the statuses of the tag's
commit every minute, for up to 300 minutes, and counts only those of the
Launchway GitHub App; its log shows the three checks' states at every turn.
The node runs one check at a time, so the release commit's checks wait
behind those queued before them, the release pull request's among them
(release-please updates it on every push to `main`). Once all three are
*success*, `release` publishes the draft. A *failure* or an *error* stops the
gate at once, and so do 300 minutes without all three: the release stays a
draft and nothing is deployed, while the version's images exist already
(they are pushed before the gate). Then:

- a check failed on the code: fix it on `main` and release the next version;
- a check could not run or did not finish (the node was down, a newer push to
  `main` superseded it): **Re-run** it on Launchway's Checks tab, or **Run
  checks** with the tag as the ref, and once it has passed re-run the job
  with the command its log ends with, `gh run rerun <run id> --failed`.

**Until the release is published, push nothing to `main` past the rules**: no
bypass push and no `gh pr merge --admin`. A newer commit on `main` supersedes
the release commit's checks that are still queued; they report *error*, and
the gate stops. Ordinary merges cannot do that: the rules make a pull request
catch up with `main` and pass its checks first, and those queue behind the
release commit's.

When the release pull request is not one commit on top of `main`,
release-please has not processed the latest push yet: wait for the Release
Please workflow, then run the script again.

Two fallbacks keep a release from getting stuck:

- **Merged on GitHub** (not the normal path): release-please creates the draft
  release itself (`"draft": true` in `release-please-config.json`). A draft has
  no tag of its own, so `"force-tag-creation": true` makes release-please
  create the `vX.Y.Z` tag on the merge commit first (it skips a tag that
  exists), and the workflow starts CI on it, which publishes the draft once
  the checks of the merge commit have passed. The tag is what release-please
  looks for as the previous release, so the next changelog starts at the right
  commit even while a draft is unpublished.
- **A tag pushed by hand** without a release: CI creates and publishes the
  release once the images exist and the checks have passed, with the
  `CHANGELOG.md` section (or generated notes) as text. A commit that was
  neither pushed to `main` nor part of a pull request into it has no checks:
  **Run checks** with the tag as the ref.

Optional: a pull request opened with `GITHUB_TOKEN` starts no workflows, which
does not matter for a release pull request that is never merged. A
fine-grained token with `contents` and `pull-requests` write access in the
`RELEASE_PLEASE_TOKEN` secret makes GitHub Actions run on it anyway. The
node's checks run on it either way: they follow Launchway's webhook, not
workflows.

## Previews

Every pull request from a branch of this repository gets a preview: Launchway
deploys its head commit as the Compose project `launchway-trail-pr-<number>`
on a host name of its own, and redeploys it on every push. Pull requests from
forks get no preview, and CI never publishes their images.

- **Image.** Built on the server from the pull request's head commit at
  every deployment ([Images](#images)), so a preview does not wait for CI and
  appears also for a commit whose checks fail; the pull request's statuses
  tell. A failed build fails the deployment.
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
- **Phones.** A phone can post to a preview like to production (Settings >
  Devices > Add device in the preview), for example with a test device. Do not
  move a real device there: its points would end up in a database that
  disappears.
- **No backups.** The `backup` service runs only with the `production`
  profile, so a preview needs no host folder.

`PUBLIC_URL` falls back to `LAUNCHWAY_PUBLIC_URL`, so a preview serves its own
address without any setting ([Preview variables](#preview-variables)).

## Images

Production and previews run an image **built on the server** from the
deployed ref: `app` and `worker` in `deploy/compose.yaml` both carry
`build: {context: .., dockerfile: Dockerfile, args: {GIT_SHA: <commit>}}` and
the tag `trail-local:<commit>` (`TRAIL_IMAGE` replaces the tag for a local
run, [Local run](#local-run)). No registry is involved, so `docker compose
pull --ignore-buildable` has nothing to fetch for Trail (`db` and the dump
service's `postgres:18-alpine` still come from Docker Hub). The commit is the
`GIT_SHA` build argument; `APP_VERSION` is not passed, so `/api/config`
reports the version of `package.json` at that commit. Each commit has its own
tag, and Launchway removes none of them: every production deployment and every
preview push leaves a `trail-local:<commit>` and a
`trail-local-predeploy-dump:<commit>` image and build cache on the server, on
the same Docker disk as the `trail-db` volume. [Pruning build
leftovers](#pruning-build-leftovers) says what removes them. Launchway builds
with `--pull` on every deployment, so a rollback to an older ref is always a
rebuild (possibly a cold one: the cache cap does not protect the previous ref) that needs Docker Hub, npm and the map-asset
downloads to be reachable, never a reuse of an old image.

### Pruning build leftovers

`deploy/prune-build-artifacts.ps1` (Windows PowerShell 5.1) removes what the
source builds leave behind. It must be running before the first deployment
that builds from source (the merge of the change that introduced it), and the
conductor installs it on the deploy host (LVJ) and registers the task; it is
not part of any deployment. It:

- removes `trail-local:*` and `trail-local-predeploy-dump:*` tags that no
  container uses, never forcing: an image a container uses survives. Per
  repository it keeps the newest 2 images built by production's Compose
  project (`-ProductionProject`, default `launchway-trail`; previews are
  `launchway-trail-pr-<n>`), and apart from those the 4 newest of everything
  else, by creation time, so preview pushes cannot push production's images
  out;
- removes dangling images of Trail's own only: one `docker image prune -f` per
  label filter, `org.opencontainers.image.title=Trail` (the images of `app` and
  `worker`) and `com.docker.compose.service=predeploy-dump` (the dump image),
  which spares images in use. Images built before these labels existed are
  not matched;
- caps the build cache with `docker builder prune -f --max-used-space 3GB`
  (`--keep-storage` is a deprecated alias of buildx's `--reserved-space`).
  This is the one step that is not scoped to Trail: the cache cannot be limited
  to a project, so it trims the whole builder, least recently used first. It
  does not promise the layers of the previous production ref, so **a rollback
  can be a cold rebuild**, which needs Docker Hub, npm and the map-asset
  downloads to be reachable.

No volume is ever touched, and no tag other than those two repositories. It
exits non-zero when Docker is unreachable, when the containers or images
cannot be listed (nothing is removed then), or when a prune command fails, so
the task's Last Run Result shows it; a removal docker refuses (in use) is only
logged.

It logs one line per action to the console and to
`%ProgramData%\trail-prune\prune-build-artifacts.log`; `-DryRun` only lists
what it would remove. Copy it to a folder outside the checkouts (Launchway
deletes those) and register it once, daily at night, as the account that runs
Docker Desktop (which only runs while that user is logged on). Run the
registration from a non-elevated PowerShell of that account, so that the log
folder belongs to it; from an elevated one, grant the account Modify first:
`icacls "$env:ProgramData\trail-prune" /grant "${env:USERDOMAIN}\${env:USERNAME}:(OI)(CI)M"`.
The task runs without elevation, and an elevated console would not prove that
it reaches Docker Desktop's pipe, so try it as a second task, with `-DryRun`:

```powershell
New-Item -ItemType Directory -Force C:\ops\trail | Out-Null
Copy-Item deploy\prune-build-artifacts.ps1 C:\ops\trail\
$script = 'C:\ops\trail\prune-build-artifacts.ps1'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$trigger = New-ScheduledTaskTrigger -Daily -At 4:15am
$live = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File $script"
$dry = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File $script -DryRun"
Register-ScheduledTask -TaskName 'Trail prune build artifacts' -Action $live -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName 'Trail prune build artifacts (dry run)' -Action $dry -Principal $principal -Settings $settings
Start-ScheduledTask -TaskName 'Trail prune build artifacts (dry run)'
# once it has finished: LastTaskResult must be 0, and the log lists only trail-local tags
(Get-ScheduledTaskInfo -TaskName 'Trail prune build artifacts (dry run)').LastTaskResult
Get-Content "$env:ProgramData\trail-prune\prune-build-artifacts.log" -Tail 40
```

The dry-run task has no trigger and stays registered for later checks.

To prove a build without deploying:

```sh
cd deploy && COMPOSE_PROFILES=production docker compose config > /dev/null   # resolves, profile on
cd deploy && docker compose config > /dev/null                               # resolves, preview
```

(with `POSTGRES_PASSWORD`, `LAUNCHWAY_PUBLIC_URL` and
`LAUNCHWAY_COMMIT_SHA_SHORT` set), then `docker compose build`.

### Published images

GitHub Actions (`.github/workflows/ci.yml`, job `image`) builds
`ghcr.io/jenspenneman/trail` for amd64 and arm64 with provenance and an SBOM,
for every commit and without waiting for the [checks](#checks):

| Trigger | Tags published |
|---|---|
| push to any branch of this repository | `sha-<commit>`, the branch name (`/` becomes `-`) |
| push to `main` | the above and `latest` |
| tag `vX.Y.Z` | `sha-<commit>`, `X.Y.Z`, `X.Y`; then, once the checks have passed, the draft release is published |
| weekly schedule (Monday 03:00 UTC) | `main`, `latest` and `sha-<commit>` of `main`, rebuilt on the current base image |
| pull request | nothing: build only (forks never publish) |

Dependabot's branches only build, because their runs have a read-only token.
These images are not what runs on the server; they remain for anyone who
wants to run a commit elsewhere. `latest` is only the newest build of `main`.

What is running: Settings > About in the dashboard, or

```sh
curl -s https://trail.jenspenneman.com/api/config   # version, commit
```

The commit is the short SHA Launchway built from. `builtAt` is empty for an
image built on the server.

### Verifying a deployment

`deploy/verify.json` says what "healthy" means, as data: `checks`, run once
after a deployment, and a `soak` that watches it afterwards. Paths start with a
single `/` (no backslash or control character, and the request must stay on the base URL's origin), methods are GET, HEAD or POST, and JSON keys are dot paths whose
values are compared as strings; `{version}` is the version in `package.json`
and `{commit}` the deployed commit. Run it from outside the app's network,
through the edge: an upload to the ingest route over plain HTTP is answered
403 ("Uploads need HTTPS") before the token is looked at, when `PUBLIC_URL`
is an `https:` address, and the check expects the 401 of an anonymous upload
over HTTPS.

## Checks

The Launchway node runs Trail's tests for every push to `main` and every pull
request into `main` from a branch of this repository, Dependabot's included:
in the development container of `.devcontainer/compose.yaml` (service `dev`
and its `db`), as a fresh Compose project with empty module volumes for every
check ([architecture.md](architecture.md) §15). The Launchway GitHub App
(`launchway-for-jenspenneman-com`) reports each one to GitHub as a commit
status:

| Status | Command | Timeout | Usually |
|---|---|---|---|
| `launchway/quality` | `npm ci --no-audit --no-fund && npm run check` | 25 min | 2½ min |
| `launchway/integration` | `npm ci --no-audit --no-fund && npm run test:integration` | 20 min | 3–4 min |
| `launchway/e2e` | `npm ci --no-audit --no-fund && npm run build && npm run test:e2e` | 60 min | 15–17 min |
| `launchway/image` | `node scripts/verify.mjs http://app:8080 deploy/verify.json` | 20 min | |

`launchway/image` has a Compose file of its own, `.devcontainer/compose.image.yaml`,
and runs in its service `probe`. Compose builds the production image from the
root `Dockerfile`, starts it as `app` with the image's own `CMD` and no
override of command or entrypoint (only `DATABASE_URL`, `PUBLIC_URL` and no map
regions), with the hardening of production's `app` (`read_only`, a `tmpfs` at
`/tmp`, `cap_drop: [ALL]`, `no-new-privileges`, `init`, `PROCESSING_ROLE:
api`), next to a `postgres:18-alpine`, and starts `probe` once the image's
own `HEALTHCHECK` reports healthy. `probe` is a Node image of its own digest with
the checkout mounted read-only; `scripts/verify.mjs` runs the `checks` of
`deploy/verify.json` against `app` ([Verifying a deployment](#verifying-a-deployment)),
with the version from `package.json` and the commit from `GIT_SHA`, which the
file passes as the same value to the build and to `probe`. A broken `CMD` path
keeps `app` from ever becoming healthy; a wrong expected status fails a check.
Locally, with Docker (about the cost of an image build):

```sh
docker compose -f .devcontainer/compose.image.yaml up --build --exit-code-from probe --abort-on-container-exit
docker compose -f .devcontainer/compose.image.yaml down -v
```

They are set up in Launchway, Trail → Settings → Checks: checks on, the
shared Compose file `.devcontainer/compose.yaml` only, branches `main`, *Skip
bots* off (Dependabot's pull requests need them to merge), the first three
checks in the service `dev`, and the `image` check with its own Compose file
`.devcontainer/compose.image.yaml` and the service `probe`. Never list
`compose.image.yaml` among the shared files: both files define `db`, and the
merged project does not resolve (`target /var/lib/postgresql already mounted as
tmpfs`), which would fail all four checks. Launchway runs a check that has a
Compose file of its own with that file only. The node runs one check at a time, oldest first across its apps, so a
commit's checks take about 25 minutes once their turn comes. A
newer push to a branch cancels the queued checks of its older commits; they
report *error*, "Superseded by a newer commit".

**Branch rules.** The ruleset "main protection" requires these status
checks, up to date with `main`:

- `launchway/quality`, `launchway/integration` and `launchway/e2e`, each with
  the Launchway GitHub App as its source, so that no workflow or token can
  report them in its place;
- `image`, from GitHub Actions ([Images](#images)).

**A failed check.** The status's *Details* link on GitHub opens its run in
Launchway: Trail → **Checks** lists every run with its log, streamed while it
runs and kept for 30 days. Nothing else outlives the run. Playwright's HTML
report and traces go with the run's volumes, so the log (its `list` reporter)
is what remains; for a closer look, run the suite in the development
container (`scripts/devc.sh npm run build && scripts/devc.sh npm run
test:e2e`), which leaves `playwright-report/` in the worktree.

**Running checks again.** A push to `main` or to the branch of a pull request
runs them for its new commit. To run a commit's checks again, open its run on
the Checks tab and **Re-run** it, or use **Run checks** with a branch, a tag
or a commit. Pushing a commit that has run once already starts nothing,
unless its checks never started (superseded, a full queue, the node offline).

**When the node is down**, the statuses of new commits stay *pending*, or
never appear for pushes that Launchway did not receive, and no pull request
can merge. (When only the node's agent is down, its queued checks end with
*error* after 10 minutes.) GitHub keeps building and publishing the images,
so they are there when the node is back, but a release's gate gives up after
300 minutes and leaves the release a draft ([Releases](#releases)). Once the
node is back, **Re-run** the checks that ended with *error*, use **Run
checks** (or push again) for commits without a status, and re-run a release
job that failed.

**Pull requests from forks** get no checks, and no preview: their code would
run on the node. A maintainer reads the change first, then pushes its branch
to this repository (`git fetch <fork URL> <branch>:<branch>`, then
`git push origin <branch>`) and opens the pull request from there; that one
runs the checks and can merge.

## Rollback

Redeploy an older release in Launchway (the app's deployments list): it
builds that release's commit again (Launchway builds with `--pull`, so it is
always a rebuild, possibly a cold one, that needs Docker Hub, npm and the
map-asset downloads to be reachable, also on the way back after a failed
dump), with that release's `compose.yaml`. The deployment takes a dump first
like any other ([the dump before an update](#the-dump-before-an-update)), of
the database as the newer release left it; a rollback has no newer migration,
so a failing dump cannot keep it from coming up. Migrations only move forward, so an older image runs against
the newer schema; when that does not work, restore the newest
`trail-*-migrate.dump` in `BACKUP_DIR/pre-update/`, the dump taken before the
release that migrated ([Backups](#backups)). A release from before the `worker` service has
none: Launchway removes the `worker` container (`up --remove-orphans`) and
that release's `app` processes in its own process, as it did then. Back on
the newer release, run `trail recompute` ([Heatmap](#heatmap)): an older release keeps
fewer sizes of the heatmap. The server also rebuilds the sizes it finds out of
step at every start.

A rollback to 0.5.x, from a release with the map regions, needs the database
rolled back too: the release rebuilds the map tables (a source per row, the
geometry in bytes), which 0.5.x can neither write nor read, so map matching
stops until the dump made before the update is restored; uploads, the
dashboard and the rest of processing keep working meanwhile.

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
| Database migration on boot | runs in one transaction under a lock; a failure rolls back and the app refuses to start, data untouched. The `integration` check upgrades a database of the first release, with data, to every new release, and a release is published only once it has passed |
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
| `pre-update/` | `trail-<UTC timestamp>-<commit>.dump`, one before every deployment ([below](#the-dump-before-an-update)), and those of the former standalone stack | the newest 3 (by `predeploy-dump`), and none older than `BACKUP_KEEP_DAYS`; `trail-<UTC timestamp>-<commit>-migrate.dump`, taken while a migration was pending, `BACKUP_KEEP_DAYS` |

Before every dump, `backup` deletes what is past its retention, except the
newest daily dump: while backups keep failing, the last good one stays (and
`predeploy-dump` needs a daily dump to exist). A file it cannot delete is
logged as a warning and skipped.

Every dump holds the whole history, so the newest one is all a restore needs.
It also dumps right after starting when the newest dump is more than a day
old, or every start with `BACKUP_ON_START=true`. A failed dump stops the
container, Docker restarts it and the restart tries again, so a failing backup
shows up as "Restarting".

```sh
docker logs launchway-trail-backup-1   # "backup complete: trail-....dump, 1234 KiB in 2 s"
```

### The dump before an update

The one-shot service `predeploy-dump` runs before `app` and `worker` on every
`docker compose up`, so a deployment has a restore point from just before it.
In order, it:

1. skips (exit 0) only when `LAUNCHWAY_ENVIRONMENT` is `preview`, or when
   `deploy/compose.dev.yaml` has set `PREDEPLOY_DUMP=skip` for a local run
   (`.env` cannot set it); anything else dumps, a missing `COMPOSE_PROFILES`
   included;
2. refuses when `BACKUP_DIR` is empty in production (`/backups` is then the
   scratch volume), and unless `/backups` already holds a daily
   `trail-*.dump` of `backup`'s or the marker file `.trail-backup-dir`, so a
   mistyped `BACKUP_DIR` is not filled (production's `D:\Backups\trail` holds
   daily dumps, so it needs no marker);
3. keeps the newest 3 files of `pre-update/` (the `-migrate` ones are not
   counted, see below) and refuses when the free space is under twice the size
   of the newest dump (`backup` prunes before it dumps too, so a full disk is
   never what stops the pruning); a file it cannot delete, or one it cannot
   size, never stops an update by itself: the first is a warning, the second
   a refusal like any other;
4. writes `BACKUP_DIR/pre-update/trail-<UTC timestamp>-<commit>.dump.partial`,
   checks it with `pg_restore --list` and only then renames it to `.dump`.
   While a migration is pending the name ends in `-migrate.dump`: that is the
   restore point of the release that migrates, so later deployments do not
   count it among the newest 3, and `backup` expires it with
   `BACKUP_KEEP_DAYS`.

**When a failed or refused dump stops the update.** Only when the target ref
ships a migration the database has not applied: the script compares the
largest `"when"` of `apps/api/drizzle/meta/_journal.json` (copied into the
dump image when it is built, so nothing from the checkout is bind-mounted)
with `select
max(created_at) from drizzle.__drizzle_migrations` (a failed query, an empty
journal, or a comparison that errors counts as pending). Then it exits 1, Compose does not start `app` and
`worker`, and the deployment fails at `up` with *service "predeploy-dump"
didn't complete successfully*. Without a pending migration, a rollback or an
update of dependencies only, it logs `WARNING: pre-update dump failed; no
migration pending` and exits 0, so the deployment goes on. It is a hard
dependency on purpose: with `required: false` Compose starts the new
containers after a failed dump, with only a warning.

**Downtime.** Compose replaces `app` and `worker` before the dump runs (every
service changes on every deployment), so each deployment is down from that
replacement until the dump, the migrations and the start are done, and a
failed dump with a pending migration leaves the replaced containers created
and never started: nothing has touched the database, and production is down.
The whole `up` has to fit Launchway's limits for it (15 minutes for the
process, `--wait-timeout 600`). A dump takes about 55 to 81 seconds for
~212 MB; one that takes minutes needs those raised.

**The way back after a failed dump.** In Launchway, Trail → Deployments,
redeploy the previous release: its journal has no newer migration than the
database, so its own dump cannot block it. Read
`docker logs launchway-trail-predeploy-dump-1` for the cause (a wrong password,
a full or wrong `BACKUP_DIR`, a database that does not answer), fix it, then
deploy the target again.

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
2. In the pull request, also bump the `FROM` of `predeploy-dump`'s
   `dockerfile_inline` in `deploy/compose.yaml` and `backup`'s image:
   Dependabot bumps `db` and `backup` but cannot see the `FROM` of
   `predeploy-dump`'s `dockerfile_inline`, and a `pg_dump` of the old major refuses the new
   server, which would fail the deployment at `up` (the new, empty database
   counts as a pending migration) until the rollback.
3. Merge the pull request and release it; the deployment starts the new,
   empty database, and the app creates an empty schema in it.
4. Restore the dump into it as under "Restore" in [Backups](#backups), which
   stops the app first and starts it again afterwards.
5. Once everything checks out, remove the old cluster:
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
2. **Move each phone.** Settings > Devices > the device > Issue new token shows
   a new QR code with the new endpoint; scan it with the phone right away (the
   old token stops working at once). Points queued on the phone are kept.
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
changed. One worker does the work a few seconds after each upload, at most
every half minute per device; after a release that changes the algorithms it
works through the whole history again, newest days first, while new uploads
keep going first. Every pass is bounded — at most 60 000 points, taken on
over at most 36 hours — so a long trip, a long time offline or the history of
a phone that records every second is worked through in passes of a few
seconds each, never in one long one.

**Where the worker runs** (`PROCESSING_ROLE`, [architecture.md
§3](architecture.md#3-runtime-topology)): in the `worker` container,
`launchway-trail-worker-1` — the app's image running `trail worker` (role
`worker`, no HTTP server) with CPUs and memory of its own — next to `app` in
role `api`, which takes the uploads and queues their work but works nothing
out: without a worker, the queue only grows, and `/api/health` says so. Run
exactly one: a second worker, or a worker next to an app in role `all`, would
take the same windows and work each out twice (the queue has no claims yet).
Both start in any order: whichever starts first applies the migrations. The
worker writes a heartbeat every 15 seconds to `processing_workers` (rows of
stopped workers go after an hour), and each finished window reaches the open
dashboards through Postgres (`NOTIFY` on `trail_processing`) whichever
process worked it out. On SIGTERM the worker takes no new window and lets the
one in progress commit (up to 50 s, within the 60 s Launchway gives a
container to stop with `up` and `down --timeout 60`, which override
`stop_grace_period`; past that it exits and the database rolls the window
back, to be worked out again). Without Compose the image runs as one process in role `all` (the
default), the API and the worker together.

**Is it working?** `/api/health` answers 200 while the API and the database
are up, whatever the worker does, and says how the worker is:

```sh
curl -s https://trail.jenspenneman.com/api/health
# {"status":"ok","db":"ok",…,"processing":{"worker":"up","lastSeenS":7,"queued":0}}
```

`worker` is `up` while the newest heartbeat is under 90 seconds old, by the
database's clock, `down` after that, and `none` with `PROCESSING_ENABLED=false`;
`lastSeenS` is the age of that heartbeat and `queued` the windows waiting
(counted up to 10 000). The answer never names a worker, host or process.
`/api/health/processing` gives the same answer with **503 while the worker is
down**: point an uptime monitor of the worker there, and keep the API's on
`/api/health`. The container checks itself as well: the worker answers
`/health/live` on port 8081 inside the container (published nowhere, only the
project's own containers reach it) with 200 `starting` while it migrates,
then 200 while its last heartbeat is under 90 seconds old, so a worker whose
loop is stuck turns *unhealthy* (the app's `/api/health/live` says `starting`
the same way, so a long migration fails no health check):

```sh
docker ps --filter name=launchway-trail-worker                         # healthy
docker exec launchway-trail-worker-1 wget -qO- http://127.0.0.1:8081/health/live
docker logs -f launchway-trail-worker-1                                # passes, map tiles, the backfill
docker restart launchway-trail-worker-1                                # the worker alone
```

Restarting the worker leaves the API alone: uploads keep arriving and their
work waits in the queue, which the new worker takes up within seconds. The
restart lets the pass in progress commit first (`docker restart` gives the
container its `stop_grace_period`, 60 s). Docker does not restart an unhealthy worker on its own: restart it,
and read its log for the cause.

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
| `PROCESSING_ROLE` | Not a setting here: `compose.yaml` fixes `app` at `api` (only queues) and `worker` at `worker` (only processes); without Compose, unset (`all`) runs both in one process |
| `PROCESSING_ENABLED=false` | Nothing is queued or processed; what was worked out stays as it is |
| `PROCESSING_OVERPASS_URL=` (empty) | No map data: stops, moves and modes are still worked out, without map evidence |
| `PROCESSING_OVERPASS_DAILY_MB=100` | A smaller daily download budget |
| `PROCESSING_MAX_ACCURACY_M`, `PROCESSING_STOP_MIN_S` | The two thresholds worth tuning: points left out as inaccurate (150 m), the shortest stop (180 s) |
| `PROCESSING_CORRECTION_WAIT_MS` | How long a mode correction waits for a pass over the device (10 000 ms) before it answers `409` and `Retry-After: 5` |
| `PROCESSING_PASS_MAX_POINTS`, `PROCESSING_PASS_MAX_SPAN_HOURS` | The most one pass reads (60 000 points) and spans (36 hours); bigger work is split into passes first. Lower them on a small machine; a very large value works everything in one pass, as before 0.6 |

**Reprocess** after changing those thresholds, or to fill in the map after a
long budget pause:

```sh
docker exec launchway-trail-app-1 trail reprocess                                   # everything, from averaging on
docker exec launchway-trail-app-1 trail reprocess --device <id> --from 2026-10-01T00:00:00Z --to 2026-11-01T00:00:00Z
docker exec launchway-trail-app-1 trail reprocess --from-level inferred              # only stops, moves and modes
```

It works through the range in day windows and prints a line per device;
tiles it lacks are left to the worker, which fetches them politely
afterwards. The modes people set are kept through every reprocessing. It does
the work itself, in the command's own process, whatever role the container
has: in an app in role `api` too. Run it in `app`, as above: in `worker` it
would share that container's 1 GB with the worker's own heap.

The worker's log (`docker logs launchway-trail-worker-1`) tells what it
does: `Trail worker started` (with its liveness port), `processing window
done` (device, range, points, segments, missing tiles, priority, whether the
work was split for being too big for one pass, milliseconds), `map tile
stored` (ways, stops, bytes, milliseconds),
`processing backfill queued` (days), and warnings when a tile fails (with the
kind of failure; it is tried again later), the daily budget is spent or a
heartbeat could not be written. The API warns `processing events: connection
lost; reconnecting` when its listening connection broke, and says `processing
events listened to again` with the number of devices it caught up on. Which
tile — a place someone has been — is logged at
`LOG_LEVEL=debug` only, like coordinates.

## Map data

Trail keeps the roads, railways and stops of the regions in
`MAP_DATA_REGIONS` (Belgium by default) on the server itself, so that map
matching inside them needs no Overpass and tells no one where anyone was
(docs/design/self-hosted-maps.md). The Map data workflow builds every region
on the 1st of the month from Geofabrik's extract of OpenStreetMap and
publishes it to `ghcr.io/jenspenneman/trail-mapdata`, a public package, so
the server pulls it anonymously. The app pulls each region's newest build
into the volume `trail-map`, checks every file against its SHA-256 and hands
it to the map tables' loader, which comes with the design's task 1: until a
version has it, the builds wait on the volume and `trail map status` says so.

**What runs.** A few minutes after every start, and then every
`MAP_DATA_REFRESH_DAYS` (30) days, the app asks the registry for the newest
build of each region and of the world overview (the basemap's low zooms; it
comes with any region and is never imported). A build the volume lacks is
pulled — only when it is not older than the newest there — then imported;
the volume keeps it and the build served before, which open maps use until
the next refresh. A failure keeps what serves, and the region is tried again
after 15 minutes, then 30, doubling up to a day.

```sh
docker exec launchway-trail-app-1 trail map status            # each region's builds, digests, imported or not
docker exec launchway-trail-app-1 trail map refresh           # ask the registry now, every region
docker exec launchway-trail-app-1 trail map refresh belgium   # one region
```

**Disk.** The volume holds two builds of a region, and a third while one
downloads; the database holds the imported region's tables besides.

| Regions | One build | Volume, usually | Volume while a build downloads |
|---|---:|---:|---:|
| `belgium` | 0.56 GB | 1.1 GB | 1.7 GB |
| `belgium,netherlands,luxembourg` | 1.5 GB | 3.0 GB | 4.5 GB |
| `europe` (`MAP_DATA_MAX_GB=40`) | about 31 GB | about 62 GB | about 93 GB |

`trail map status` ends with what the builds take on the volume (a rebuild
of the same extract links the files it shares with the build before it, so
those count once); `docker system df -v | grep trail-map` shows the
volume's size as Docker sees it. A build larger than `MAP_DATA_MAX_GB` (10)
or than the free space is refused before anything is downloaded.

**Changing the regions.** Set `MAP_DATA_REGIONS` in Launchway (comma-separated
names of `scripts/mapdata/regions.json`; empty: none) and redeploy: a new
region is pulled a few minutes after the start. A region taken off the list is
not deleted: `trail map status` marks it "not in MAP_DATA_REGIONS", and its
directory on the volume can go by hand
(`docker exec launchway-trail-app-1 rm -rf /var/lib/trail/map/regions/<region>`).

**After a restore.** The map tables come back as the dump had them; the first
refresh after the start finds the build on the volume and imports it again,
without downloading it (`trail map refresh` does it at once).

**Checking a build.** `trail map status` shows each build's digest, the
SHA-256 of the manifest the registry served (kept as `oci-manifest.json` in
the build's directory). The workflow signed a build provenance attestation
for it, which anyone can check:

```sh
gh attestation verify oci://ghcr.io/jenspenneman/trail-mapdata@<digest> -R JensPenneman/trail \
  --source-ref refs/heads/main
```

`--source-ref` insists on a build of `main`, which is where every region but
the test region comes from; the attestation names the workflow and the commit.
The server itself checks only that every byte is what the registry's
manifest says (integrity), not who built it: this command is the only check
of a build's origin for now.

**The workflow.** Actions › Map data. It runs on the 1st of every month at
04:00 UTC; `gh workflow run mapdata.yml -f region=belgium` builds and
publishes now (from `main`; from another branch it publishes Monaco only, the
test region, and builds the others without publishing them). One build and
one publication of a region run at a time: a second run waits, a third
cancels the waiting one. Each run keeps the newest three builds of a region
in the package. Should its last step warn
that old builds could not be deleted, the package's settings (Manage Actions
access) must give the repository the Admin role.

**A region built by hand** (Europe, which no runner can build, or a server
without a route out): `scripts/mapdata/build.sh <region>` on a machine with
osmium-tool, Java 21 and the disk, then copy the directory to the server and
import it with `trail map import <dir>` (task 1), or publish it to the
registry: `oras login ghcr.io`, `scripts/mapdata/publish.sh <dir>`.

**Another registry.** `MAP_DATA_REGISTRY=registry.example.com/trail-mapdata`
takes the artefacts from a mirror or a private registry, over HTTPS, from
that host only (a redirect elsewhere is refused); a private one needs
`MAP_DATA_REGISTRY_TOKEN=<user>:<token>` (for a private GHCR package a
classic token with `read:packages`).

**Previews** pull their regions at every deployment, into a volume of their
own that goes with the preview: Belgium is 0.56 GB and a minute. Set
`MAP_DATA_REGIONS=luxembourg` (51 MB), or empty, for previews where that
hurts.

The log tells what happened, per region: `map data refresh scheduled`, `map
region pulled` (build, digest, bytes, seconds), `map region imported` (ways,
stops), `map region up to date`, and warnings `map region refresh failed`
with the stage and the reason, `map region import failed`, and `map region
data is old` when a region's data is older than three refresh periods (the
refresh keeps failing).

## The basemap

The map under Trail's tracks comes from the server itself: vector tiles of
the region the map data was built from (OpenStreetMap in the OpenMapTiles
schema, cut by Planetiler, `basemap.pmtiles` in each build), with the world
overview's for the zooms that show more than the region, drawn with
OpenFreeMap's `liberty` (Light) and `dark` (Dark) styles, which Trail keeps
in its repository, and their fonts and icons, which come in the image. No
browser that opens Trail asks another server for the map any more, except
for satellite imagery ([Satellite imagery](#satellite-imagery)).

**What is served**, all under `/map/` on the app's own address, without a
sign-in (the public links draw the map too) and behind its own limit of
`RATE_LIMIT_MAP_PER_MINUTE` (3000) requests a minute per address:

| Path | What | Cached |
|---|---|---|
| `/map/styles/light.json`, `dark.json` | the style, pointing at the tiles of the current bundle | `no-cache` (a new bundle reaches a map at its next load) |
| `/map/tiles/<bundle>/<z>/<x>/<y>.pbf` | a tile as stored, gzipped; `204` where the archives have none | a year, immutable |
| `/map/assets/<hash>/fonts/…`, `…/sprites/…` | the labels' glyphs and the icons, from the image | a year, immutable |

A *bundle* is the pair of builds the map draws: the newest build of
`MAP_BASEMAP_REGION` (the first of `MAP_DATA_REGIONS` unless set) whose
`basemap.pmtiles` checks out, and the newest world overview. Zooms 0–4 come
from the overview (from the region until the overview is there), 5–14 from
the region and, abroad, the overview's 5–6; beyond 14 the browser enlarges
zoom 14. One region draws in detail, even with more in `MAP_DATA_REGIONS`;
elsewhere the map shows coastlines, rivers and country borders to zoom 4,
and no names (docs/design/self-hosted-maps.md §3.1). The app looks at the
volume every minute and after each refresh, so a newly pulled build serves
within a minute. Maps open on an earlier bundle keep their tiles while its
builds are on the volume (the refresh keeps the build before for a period),
so the region's and the overview's refreshes, minutes apart, cut no map off.

```sh
docker exec launchway-trail-app-1 trail map status   # … "Basemap: served by Trail from belgium 20261027-85fbe901 …"
curl -s https://trail.example.com/api/health          # … "basemap":"self"
```

`/api/health` says `basemap`: `self` (Trail's), `external` (`MAP_STYLE_LIGHT`
and `MAP_STYLE_DARK`, OpenFreeMap's by default) or `none` (a plain ground).

**When the basemap is missing** — a new install for its first minutes,
while its region downloads; a server whose `MAP_DATA_REGIONS` is empty; a
region whose build has no `basemap.pmtiles` (a hand build without one) —
the map uses the external styles while `MAP_BASEMAP_FALLBACK=true` (the
default for now: the browser then loads the map from OpenFreeMap, as before
this version), or, with `false`, a plain ground in the page's colours and
"Basemap not installed yet" over it; Trail's tracks are drawn either way.
What to do:

1. `trail map status`: is the region's build on the volume, and what does
   the Basemap line say?
2. No build: `trail map refresh` (the log of the refresh says why it failed;
   [Map data](#map-data)). A build but no basemap: the log says "basemap:
   the build's basemap.pmtiles was refused" with the reason, or the build
   has no `basemap.pmtiles`.
3. "The image has no map fonts or sprites": the image was built without
   `scripts/map-assets.mjs` (a hand build of the app); Trail's styles need
   them, so the map uses the fallback. Rebuild the image.

`MAP_BASEMAP=openfreemap` uses the external styles always, whatever the
volume holds (the map's detail abroad is OpenFreeMap's, worldwide), and
widens the Content Security Policy to their origins, as the fallback does;
with Trail's own basemap the map needs no other origin.

**Fonts and sprites** are pinned by SHA-256 in `scripts/map-assets.json`
and fetched when the image is built (Noto Sans from openmaptiles/fonts, the
icons from OpenFreeMap): 11 MB in `apps/web/dist/map-assets/`, the glyph
ranges MapLibre asks for (it draws Chinese, Japanese, Korean and the Indic
scripts with the browser's own fonts). A change of the pins is a pull
request, like the styles in `apps/api/map/styles/`.

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
Dark and — once the server has imagery — Satellite. Light and dark are the
basemap Trail serves itself ([The basemap](#the-basemap)). Trail ships no
imagery: `MAP_STYLE_SATELLITE` names it, in one of two forms.

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
origins*), and rotate it there if it leaks. Unlike the basemap, which comes
from Trail itself, the imagery tiles a browser loads tell the provider which
areas it shows, from the browser's address: not the tracks, and not who is
looking.

## Logs

Launchway shows each service's logs; on the server:

```sh
docker logs -f launchway-trail-app-1     # the app logs JSON lines (pino)
docker logs -f launchway-trail-worker-1  # the processing worker, the same way
docker logs --since 1h launchway-trail-app-1 2>&1 | grep '"level":50'   # errors
docker logs launchway-trail-app-1 2>&1 | grep '"msg":"API token'      # API tokens created, changed, rolled, revoked
docker logs launchway-trail-app-1 2>&1 | grep '"msg":"map region'     # map data pulled, imported, failed
```

Every container keeps at most 5 files of 10 MB of logs. Device and API tokens,
cookies, coordinates and map tiles never appear in the app's logs at the
default level; the API token lines carry the token's and the user's id only.

Once a minute the app logs its `load` line — event-loop delay, the database
pool, open streams, the minute's uploads and points, memory and the
processing queue's age, numbers only ([docs/perf/README.md](perf/README.md#what-a-run-does)):

```sh
docker logs --since 1h launchway-trail-app-1 2>&1 | grep '"msg":"load"'
```

## Request latency

Every request's line in the app's log carries its route pattern (`route`),
status, duration (`ms`), the bytes it sent, whether the browser asked
conditionally and got a 304 (`cache`: `hit` or `miss`) and the days a range
spans (`days`) — never the URL's ids or values ([architecture.md
§12](architecture.md#12-security)). The app also keeps, per route, the last 15
minutes and 24 hours against the route's budget
([architecture.md §8.10](architecture.md#810-request-budgets-and-timing)):

The summary is for administrators: send an API token whose owner is one
(`TRAIL_ADMIN_TOKEN` below); without it the answer is 401.

```sh
docker exec launchway-trail-app-1 wget -qO- --header "Authorization: Bearer $TRAIL_ADMIN_TOKEN" http://127.0.0.1:8080/api/health/requests   # or https://trail.jenspenneman.com/api/health/requests
docker logs --since 15m launchway-trail-app-1 2>&1 | grep '"route":"/api/v1/tracks"'       # one route's requests
```

| Route | p95 budget |
|---|---|
| session, configuration, devices, people, shares and incoming shares | 100 ms |
| the timeline (`/api/v1/segments`) | 200 ms |
| tracks (`/api/tracks`, `/api/v1/tracks`) | 400 ms |
| heatmap | 150 ms |
| Insights' overview | 1 s |
| every other `GET` of the API | 1 s |

The uploads are held to their own targets by batch size, from
`ingest_log.duration_ms` ([docs/perf/README.md](perf/README.md)); the event
stream, the export and writes have no budget.

`"status":"over_budget"` names a route whose last 15 minutes had more than
5 % of its requests over the budget (`overBudget: true`, first in the list).
Then:

1. **Which requests.** Its lines say whether a long range (`days`: History
   allows 93), a large answer (`bytes`), stale copies (`cache: miss`), one
   account (`account`) or a moment (`time`) makes them slow.
2. **What else ran.** `docker stats`: `app` at its two CPUs, `db` at its two,
   the worker busy with a backfill; the app's `load` line (event-loop p99,
   pool `waiting`, [Logs](#logs)); the backup at 03:00; a check on the node.
3. **The route itself.** Measure it on a copy of production in the
   development container (restore the newest dump from `BACKUP_DIR`, replay
   the pages' requests) and profile it (`node --cpu-prof`, `EXPLAIN (ANALYZE,
   BUFFERS)`): rows read without an index, an answer built from more rows
   than it shows, a query per row, work on the request path that could wait.
4. **Not the budget.** The budgets are the capacity targets
   ([docs/design/capacity.md](design/capacity.md) §3.2); a budget changes
   there first, then in `apps/api/src/requests/requestBudgets.ts` and
   `tools/load/lib/targets.js` together (a test keeps them equal).

The summary is the app's memory: a restart (a deploy) begins it again.

## Load tests

Load tests run on the Mac against a capped copy of this stack
(`npm run load -- fleet-10`), never against production; how to run one, how
to read its report and the targets are in [docs/perf/README.md](perf/README.md).
Their synthetic people come from `trail load-fleet`, which refuses unless
`LOAD_TEST=true`, the deployment is not Launchway's `production` and its
database holds no passkey and no real account. A load test on the node (a
later milestone) is a preview with `LOAD_TEST=true` in its variables; never
set it in production's.

## Local run

`deploy/compose.dev.yaml` builds the working tree into an image and runs the
stack — `app`, `worker` and `db`, with the caps of production — on
`http://localhost:8080`, like a preview (no backup, a volume of its own). Its
header lists the four variables `deploy/.env` needs; then, in `deploy/`:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
E2E_BASE_URL=http://localhost:8080 npm run test:e2e   # from the repository root, on a fresh database
docker compose -f compose.yaml -f compose.dev.yaml down -v
```

To see the worker's health check fail, start a worker whose loop stands
still after its first heartbeat (`PROCESSING_TEST_STALL`, which only this
file passes on):

```sh
PROCESSING_TEST_STALL=true docker compose -f compose.yaml -f compose.dev.yaml up -d worker
curl -s http://localhost:8080/api/health          # "worker":"down" 90 s later, still 200
docker compose -f compose.yaml -f compose.dev.yaml ps worker   # unhealthy after about 3 minutes
docker compose -f compose.yaml -f compose.dev.yaml up -d worker   # a normal worker again
```

Day-to-day development uses `npm run dev` instead (README).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The deployment fails at the build | The log of the deployment shows `docker compose build`: a failing `npm ci`, a download of the map assets (`scripts/map-assets.mjs`) or the build itself. Nothing in the registry is involved. |
| The deployment fails at `up` with *predeploy-dump didn't complete successfully* | The dump before the update failed and the update ships a migration ([The dump before an update](#the-dump-before-an-update)); `app` and `worker` were not started. Redeploy the previous release first, then read `docker logs launchway-trail-predeploy-dump-1`, fix the cause and deploy again. |
| A release was tagged but nothing deployed | The release is still a draft: CI publishes it after the images and the checks. Check the tag's CI run, job `release-gate`: its log shows the checks it waits for, or why it stopped ([Releases](#releases)). |
| A pull request's `launchway/*` statuses stay *pending* | The node runs one check at a time and others are ahead, or it is down ([Checks](#checks)). |
| A `launchway/*` status is *error* | The check could not run: the description names why (superseded, the image build, the node offline, a full queue). **Re-run** it on the Checks tab once the cause is gone. |
| A pull request has no `launchway/*` statuses | It comes from a fork ([Checks](#checks)), or Launchway missed the push: **Run checks** for its branch on the Checks tab. |
| `required variable POSTGRES_PASSWORD is missing a value` | Set it in Launchway (production and previews). |
| `required variable LAUNCHWAY_COMMIT_SHA_SHORT is missing` | Outside Launchway: a local run sets `TRAIL_IMAGE` ([Local run](#local-run)). |
| `backup` does not start: "bind source path does not exist" | `BACKUP_DIR` is unset or the folder does not exist; create it, absolute path. |
| No `backup` container in production | `COMPOSE_PROFILES=production` is missing. |
| Compose warns that volume `trail-db` "was not created by Docker Compose" | Expected: the volume was created by hand, which keeps `down -v` away from it. |
| `app` keeps restarting; its log says "Invalid configuration" | A value is invalid; the log names it. Fix it in Launchway and redeploy. |
| `/api/health` answers 503 | The database is down: `docker logs launchway-trail-db-1`. |
| `/api/health` says `"worker":"down"` (and `/api/health/processing` 503) | No worker beat for 90 s: `docker ps --filter name=launchway-trail-worker` and `docker logs launchway-trail-worker-1`. `docker restart launchway-trail-worker-1` is safe; uploads wait in the queue meanwhile (`queued`). |
| The dashboard is slow; `/api/health/requests` says `"status":"over_budget"` | A route's last 15 minutes went over its budget: [Request latency](#request-latency) tells which requests and what to look at. |
| `worker` is *unhealthy* | Its loop stopped writing heartbeats: the database refused them (the log says "worker heartbeat could not be written") or the process is stuck. Restart it; Docker does not on its own. |
| `worker` restarts in a loop with `trail: unknown command "worker"` | The newer `compose.yaml` runs with an image from before the worker (a run by hand). Harmless: that image's `app` processes by itself. Deploy a release, or the older release with its own `compose.yaml`. |
| Requests all share one client address, or the session cookie is not `Secure` | `TRUST_PROXY` does not name Launchway's edge address. |
| `app` will not start: "TRUST_PROXY: PUBLIC_URL is https://, but Trail serves plain HTTP and trusts no proxy …" | Trail serves plain HTTP, so only a trusted proxy can say a phone's upload came over HTTPS; without one every upload would be refused. Set `TRUST_PROXY` to the proxy that terminates TLS (Launchway's edge, `10.210.0.2`, is the compose default). |
| Phones get 403 "Uploads need HTTPS" while the dashboard works; the log says "a proxy that TRUST_PROXY does not trust says they came over HTTPS" | `TRUST_PROXY` names another proxy than the one in front of Trail: the log line shows the address it came from. |
| An API token with an IP allowlist is refused (401) from an allowed address | The same: without the edge in `TRUST_PROXY` every request seems to come from the edge. Settings › API tokens shows the address a token was last used from. |
| "No passkey for this address" | Passkeys are per host name: a preview needs its own account; a new production address needs [a new passkey](#changing-the-public-address). |
| `backup` restarts with "pg_dump failed" | The database is not reachable; the log line before it shows why. |
| Backups happen at the wrong hour | `TZ`. |
| The mapped level shows averaged lines | No map data for that area yet: the tiles wait for the daily budget (log: "daily map download budget spent") or failed (log: "map tile could not be fetched"; tried again later). `PROCESSING_OVERPASS_URL` empty switches map data off altogether. |
| "Basemap not installed yet" on the map, or `/api/health` says `"basemap":"external"` | No basemap of `MAP_BASEMAP_REGION` on the volume yet, or the image lacks the map's fonts and sprites: `trail map status` says which ([The basemap](#the-basemap)). |
| The map is blank outside the basemap's region, or shows no names there | Expected: outside `MAP_BASEMAP_REGION` the world overview has coastlines, rivers and borders only. `MAP_BASEMAP=openfreemap` draws OpenFreeMap's map everywhere instead. |
| The map's style control has no Satellite | `MAP_STYLE_SATELLITE` is unset, or the app refused it at boot (the log names the variable). |
| Satellite stays blank or shows only some tiles | The browser console names the refused host: add it to `MAP_CONNECT_SRC`. Otherwise the provider refuses the key (usage limit, or the key is restricted to other origins). |
| "map region refresh failed", reason `unreachable` or `timeout` | The registry did not answer; tried again after 15 minutes, doubling up to a day. The old build serves on. |
| "map region refresh failed", reason `denied` | The package is private, or `MAP_DATA_REGISTRY_TOKEN` is wrong or may not read it ([Map data](#map-data)). |
| "map region refresh failed", reason `not_found` | The registry has no build of that region: is it a name of `scripts/mapdata/regions.json`, and has the workflow published it? |
| "map region refresh failed", reason `digest`, `truncated` or `malformed` | A download that did not check out: deleted, the old build serves on, tried again later. If it keeps happening, the build in the registry is broken: run the workflow for the region again. |
| "map region refresh failed", reason `too_large` or `disk` | The build is larger than `MAP_DATA_MAX_GB` or the free space, or the volume is not writable. |
| "map region import failed" | The loader refused the build (the log says why); the build it replaced serves on. |
| "map region data is old" | The region's refresh has failed for three periods: the lines above say why. |
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
