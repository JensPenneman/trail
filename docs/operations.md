# Operations: running Trail on a Windows laptop

This runbook installs and runs the production stack (`deploy/compose.yaml`) on
a Windows laptop with Docker Desktop, first on the home network only, later on
a public address. The architecture behind it is in
[architecture.md](architecture.md) (sections 3 and 13); phone setup is in
[overland.md](overland.md).

Commands are for PowerShell and run in `C:\trail\deploy` unless noted.
Windows PowerShell 5.1 and PowerShell 7 both work. Use `curl.exe`, not `curl`:
in Windows PowerShell `curl` is an alias for `Invoke-WebRequest`.

## What runs

| Service | Image | Role |
|---|---|---|
| `app` | `ghcr.io/jenspenneman/trail` | API, Overland ingest and the dashboard on port 8080 |
| `db` | `postgres:18-alpine` | the database, reachable only by `app` and `backup` |
| `backup` | `postgres:18-alpine` | daily `pg_dump` into `BACKUP_DIR` |
| `watchtower` | `nickfedor/watchtower:1` | checks for new images every 5 minutes and installs them |
| `cloudflared` | `cloudflare/cloudflared` | profile `tunnel`: Cloudflare Tunnel to `app` |
| `caddy`, `ddns` | `caddy:2-alpine`, `favonia/cloudflare-ddns:1` | profile `direct`: HTTPS on ports 80/443 and the DNS record |

The stack runs in two phases:

1. **LAN phase** (start here): phones on the home Wi-Fi post to
   `http://<laptop-ip>:8080`, and you use the dashboard on the laptop itself at
   `http://localhost:8080`.
2. **Public**: once data arrives reliably, `trail.jenspenneman.com` is served
   through a Cloudflare Tunnel (recommended) or directly from the laptop.

Nothing on the laptop needs a manual update: every push to `main` that passes
CI publishes a new image and Watchtower installs it (see [Updates](#updates)).

## 1. Prepare the laptop

### Docker Desktop

1. Enable virtualisation in the firmware if it is off (Task Manager >
   Performance > CPU shows "Virtualization: Enabled").
2. In an administrator PowerShell: `wsl --install --no-distribution`, then
   restart.
3. Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)
   (`winget install Docker.DockerDesktop`) with the WSL 2 backend.
4. Docker Desktop > Settings > General: enable **Use the WSL 2 based engine**
   and **Start Docker Desktop when you sign in to your computer**.
5. Install Git: `winget install Git.Git`.

Docker Desktop only runs inside a signed-in Windows session. After a restart
(Windows Update restarts laptops on its own), nothing runs until someone signs
in. Pick one:

- **Automatic sign-in** (simplest). Configure it with Sysinternals
  [Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon),
  which stores the password encrypted, and add a Task Scheduler task "At log on
  of <you>" that runs `rundll32.exe user32.dll,LockWorkStation`, so the
  session locks right after it starts. Trade-off: whoever can switch the laptop
  on gets a signed-in session for a moment. Keep BitLocker enabled.
- **Headless alternative**: skip Docker Desktop and run Docker Engine in a WSL 2
  Ubuntu distribution: enable systemd in `/etc/wsl.conf` (`[boot]`,
  `systemd=true`), install Docker Engine from Docker's apt repository, set
  `networkingMode=mirrored` in `%UserProfile%\.wslconfig` (Windows 11) so the
  home network reaches published ports, allow inbound traffic for WSL in the
  Hyper-V firewall, and create a Task Scheduler task that runs **At startup**,
  **whether the user is logged on or not**, with the action
  `wsl.exe -d Ubuntu --exec sleep infinity` to boot the distribution and keep
  it running. The rest of this runbook then runs in the Ubuntu shell
  (`/etc/trail` instead of `C:\trail`, `openssl rand -hex 32` for the password).

### Power settings

A sleeping laptop receives nothing. In an administrator PowerShell:

```powershell
powercfg /change standby-timeout-ac 0     # never sleep on mains power
powercfg /change hibernate-timeout-ac 0
powercfg /hibernate off
# closing the lid does nothing, on mains power and on battery
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
```

Keep it plugged in; if the laptop offers a battery charge limit (often 80 %),
use it.

### A fixed address on the home network

Phones reach the laptop by its IP address during the LAN phase, and the
`direct` profile forwards router ports to it. In the router, reserve the
laptop's current address for its MAC address (often called "DHCP reservation"
or "static lease"). `ipconfig` shows both (Physical Address, IPv4 Address) for
the Wi-Fi or Ethernet adapter.

### Firewall

The home network must have the **Private** profile, and port 8080 must be open
on it. In an administrator PowerShell:

```powershell
Get-NetConnectionProfile                    # NetworkCategory should be Private
# Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private
New-NetFirewallRule -DisplayName 'Trail (TCP 8080)' -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPort 8080 -Profile Private
```

## 2. Install

```powershell
git clone https://github.com/JensPenneman/trail.git C:\trail
cd C:\trail\deploy
```

Only `deploy\` is needed at runtime: copying that folder instead of cloning
works too, but a clone makes later changes to the stack a `git pull`.

Create `.env`. The helper copies `.env.example`, generates the database
password and fills in the laptop's LAN address:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\new-env.ps1
notepad .env
```

Or by hand: `Copy-Item .env.example .env`, then set `POSTGRES_PASSWORD` to the
output of

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

and `INGEST_BASE_URL` to `http://<laptop-ip>:8080`. In either case set
`SIGNUP_ALLOWLIST` to your e-mail address and, for an off-site copy of the
backups, `BACKUP_DIR` to a OneDrive folder
(`C:/Users/<you>/OneDrive/Backups/trail`, forward slashes). Every variable is
explained in `.env.example`.

If the image is private, log in to GHCR first ([Private image](#private-image)).
Then start the stack and check it:

```powershell
docker compose up -d
docker compose ps                         # app and db "healthy", backup and watchtower "Up"
curl.exe -i http://localhost:8080/api/health   # HTTP 200: app and database are up
```

From another device on the Wi-Fi, `http://<laptop-ip>:8080/api/health/live`
must answer too; if it does not, see [Troubleshooting](#troubleshooting).

## 3. First sign-in

Open `http://localhost:8080` **on the laptop itself**, enter the e-mail address
from `SIGNUP_ALLOWLIST` and create a passkey (Windows Hello, a security key, or
a phone via the QR code the browser offers). The first account is the admin;
others join through the allowlist or an invite (Settings > People).

Why only on the laptop: passkeys (WebAuthn) work only in a secure context,
which means HTTPS or `localhost`. `http://192.168.x.x:8080` is neither, so
browsers refuse passkeys there, and the dashboard cannot be used from other
devices until Trail has an HTTPS address. Phones do not need a passkey to send
data: Overland authenticates with a device token and may use plain HTTP.

## 4. Add a phone

On the laptop: Devices > Add device, give it a name and scan the QR code with
the iPhone's Camera app; Overland opens with endpoint, token and device ID
filled in. The page confirms the first upload as soon as it arrives. Details,
recommended Overland settings and iOS permissions: [overland.md](overland.md).

## 5. The LAN phase

- Phones upload only while they are on the home Wi-Fi. Elsewhere, Overland
  keeps recording and queues the points; they arrive when the phone is back
  home.
- The Live page on the laptop shows each device's last upload; Devices > a
  device shows every upload in its ingest log.
- Leave `TRAIL_HTTP_BIND=0.0.0.0` so phones can reach port 8080.
- Everything that reaches port 8080 arrives from Docker's own address, and
  the app believes no `X-Forwarded-For` from there: every phone and browser
  shares one address for the per-address rate limits
  ([architecture.md](architecture.md) §12), and nobody on the network can
  pretend to be someone else.

When uploads have arrived reliably for a while, go public.

## 6. Go public

Pick one of the two ways. Both end at `https://trail.jenspenneman.com` with a
valid certificate; after either, follow [After the address
changes](#after-the-address-changes).

### A. Cloudflare Tunnel (recommended)

The laptop opens an outbound connection to Cloudflare; nothing is opened on the
router, and it works behind carrier-grade NAT and on any network the laptop
moves to. Cloudflare terminates TLS: it can see the traffic, including
positions and session cookies. If that is not acceptable, use B.

1. **Universal SSL.** Cloudflare dashboard > jenspenneman.com > SSL/TLS > Edge
   Certificates: enable Universal SSL (it is off because the zone is DNS-only)
   and wait until the edge certificate is active (minutes, at most a day).
   Cloudflare then adds CAA records for its own certificate authorities next to
   the existing `letsencrypt.org` one. Enable **Always Use HTTPS** there too.
2. **Tunnel.** Zero Trust > Networks > Tunnels > Create a tunnel > Cloudflared,
   name it `trail`, choose Docker as the environment and copy the token: the
   long string after `--token` in the command shown. Do not run that command.
3. **Public hostname** (newer dashboards call it a published application
   route): subdomain `trail`, domain `jenspenneman.com`, no path, service type
   `HTTP`, URL `app:8080`. This creates a proxied `trail` CNAME to the tunnel;
   delete an existing `trail` record first if Cloudflare reports a conflict.
4. **Let Overland through.** Phones are not browsers and cannot solve
   challenges, so no bot or challenge feature may touch `POST /api/overland`:
   - Security > Bots: **Bot Fight Mode off**. On the Free plan no rule can
     exempt a path from it.
   - Security > WAF > Custom rules: create a rule with the expression
     `(http.host eq "trail.jenspenneman.com" and http.request.uri.path eq "/api/overland")`
     and the action **Skip**, skipping all remaining custom rules, rate
     limiting rules and managed rules, plus Browser Integrity Check and
     Security Level under "More components to skip".
   - Keep "I'm Under Attack" mode off.
5. **`.env`:**
   ```ini
   PUBLIC_URL=https://trail.jenspenneman.com
   INGEST_BASE_URL=
   ADDITIONAL_ORIGINS=http://localhost:8080
   TUNNEL_TOKEN=<token from step 2>
   COMPOSE_PROFILES=tunnel
   ```
   `COMPOSE_PROFILES` makes every plain `docker compose` command include the
   tunnel, so it cannot be forgotten.
6. `docker compose up -d`, then `docker compose logs cloudflared` shows
   "Registered tunnel connection" (four times), and from a phone on mobile data
   `https://trail.jenspenneman.com/api/health/live` answers.

Client addresses stay correct: Cloudflare and cloudflared pass them in
`X-Forwarded-For`, which the app believes only from the tunnel container
(its fixed address `10.201.8.10` on the stack's `edge` network, `TRUST_PROXY`).

### B. Direct: Caddy and Let's Encrypt on the laptop

End-to-end TLS with no third party in the path. It needs a public IPv4
address at home and a router that forwards ports.

1. **Check for carrier-grade NAT.** Compare the WAN address on the router's
   status page with the `ip=` line of
   `curl.exe https://www.cloudflare.com/cdn-cgi/trace`. If they differ, or the
   router's address is in 100.64.0.0/10, the laptop cannot be reached from the
   internet: use the tunnel.
2. **Router:** forward TCP 80, TCP 443 and UDP 443 (HTTP/3) to the laptop's
   reserved address.
3. **Firewall** (administrator PowerShell):
   ```powershell
   New-NetFirewallRule -DisplayName 'Trail HTTPS (TCP 80, 443)' -Direction Inbound `
     -Action Allow -Protocol TCP -LocalPort 80,443 -Profile Private
   New-NetFirewallRule -DisplayName 'Trail HTTP/3 (UDP 443)' -Direction Inbound `
     -Action Allow -Protocol UDP -LocalPort 443 -Profile Private
   ```
4. **Cloudflare API token** for the DNS updater: My Profile > API Tokens >
   Create Token > template **Edit zone DNS**; permission Zone / DNS / Edit,
   zone resources: Include > Specific zone > `jenspenneman.com`. Nothing
   else. Delete a `trail` CNAME left over from a tunnel; the updater creates
   the DNS-only `A` record itself. Universal SSL can stay off, and the
   existing CAA record already allows Let's Encrypt, the only issuer Caddy is
   configured to use.
5. **`.env`:**
   ```ini
   PUBLIC_URL=https://trail.jenspenneman.com
   INGEST_BASE_URL=
   ADDITIONAL_ORIGINS=http://localhost:8080
   TRAIL_DOMAIN=trail.jenspenneman.com
   CLOUDFLARE_API_TOKEN=<token from step 4>
   COMPOSE_PROFILES=direct
   ```
   `ACME_EMAIL` is optional (a contact address for the Let's Encrypt account).
6. `docker compose up -d`; `docker compose logs ddns` shows the `A` record being
   set and `docker compose logs caddy` shows "certificate obtained
   successfully".

Two things to know about this setup:

- **NAT loopback.** At home, `trail.jenspenneman.com` resolves to the public
  address, and many routers cannot connect from the LAN to their own public
  address. The symptom: everything works on mobile data but not on the home
  Wi-Fi. Fix it with the router's NAT loopback (hairpin NAT) option, or a
  local DNS entry in the router (or Pi-hole) that points
  `trail.jenspenneman.com` at the laptop's LAN address; Caddy serves the same
  certificate there. The laptop's own `hosts` file only helps the laptop.
- **Client addresses.** Docker Desktop's port forwarding hides the visitor's
  address: the app sees every request coming from one internal address, so
  the per-IP rate limits are shared by all clients. The tunnel does not have
  this limitation.

### After the address changes

Passkeys are bound to a host name, so the passkey created on `localhost` does
not work on `trail.jenspenneman.com`, and every phone still posts to the old
LAN address.

1. **Add a passkey for the new address.** On the laptop at
   `http://localhost:8080` (still allowed through `ADDITIONAL_ORIGINS`):
   Settings > "Add a passkey on another device or address", pick
   `https://trail.jenspenneman.com` and open the link (or its QR code) on the
   device that should hold the passkey. The link is valid for 15 minutes and
   works once. Without a working sign-in, create the link with the CLI:
   ```powershell
   docker compose exec app trail passkey-link you@example.com --origin https://trail.jenspenneman.com
   ```
2. **Move each phone to the public endpoint.** Devices > the device > Rotate
   token shows a new QR code with the new endpoint; scan it with the phone.
   The old token stops working at once, so re-scan right away. Points queued
   on the phone are kept and sent to the new endpoint.
3. Optional: `TRAIL_HTTP_BIND=127.0.0.1` and `docker compose up -d` stop
   plain-HTTP access from the home network once no phone uses it.

## Backups

The `backup` service dumps the database every day at `BACKUP_HOUR` (local time
in `TZ`) to `BACKUP_DIR\trail-<UTC timestamp>.dump` (PostgreSQL custom format)
and deletes dumps older than `BACKUP_KEEP_DAYS`. It also dumps right after
starting when the newest dump is more than a day old: the first start, a day
the laptop was off, or a failed run. A failed dump stops the container, Docker
restarts it and the restart tries again, so a failing backup shows up as
"Restarting" in `docker compose ps`.

```powershell
docker compose logs backup               # "backup complete: trail-....dump, 1234 KiB in 2 s"
Get-ChildItem C:\Users\<you>\OneDrive\Backups\trail
```

**Off-site copy:** point `BACKUP_DIR` at a OneDrive folder. OneDrive uploads
each dump; retention deletes old ones there as well.

**Dump now** (before a risky change):

```powershell
docker compose exec backup sh -c 'pg_dump --format=custom --file=/backups/trail-$(date -u +%Y%m%dT%H%M%SZ).dump && ls -l /backups'
```

**Restore** into the running stack (replaces the current data):

```powershell
docker compose stop app
docker compose exec backup pg_restore --clean --if-exists --single-transaction --dbname=trail /backups/trail-20261001T010000Z.dump
docker compose start app
```

**Restore on a new laptop:** install as above, copy the dumps into
`BACKUP_DIR`, then restore before the rest of the stack starts:

```powershell
docker compose up -d db
docker compose run --rm --no-deps --entrypoint pg_restore backup --clean --if-exists --single-transaction --dbname=trail /backups/trail-20261001T010000Z.dump
docker compose up -d
```

The app applies newer migrations on boot. Restore a dump now and then to be
sure the backups work.

## Updates

How a change reaches the laptop:

1. A push to `main` runs CI: lint, type check, unit tests, integration tests,
   end-to-end tests. Only when all pass does CI build the multi-platform image
   and push it to GHCR as `latest`, `main` and `sha-<short commit>`.
2. Watchtower checks GHCR every 5 minutes. For a new `latest` it pulls the
   image, stops the app, starts it on the new image (one container at a time,
   waiting for health checks) and removes the old image.
3. The app applies database migrations on boot.

An update restarts the app for a few seconds; phones retry and nothing is lost.
Watchtower updates the other services the same way when their tags move:
`postgres:18-alpine` (only within Postgres 18), `caddy:2-alpine`, `cloudflared`,
`cloudflare-ddns:1` and Watchtower itself (within version 1). CI also rebuilds
the image every Monday at 03:00 UTC, which restarts the app once that night.

What is running:

```powershell
Invoke-RestMethod http://localhost:8080/api/config | Select-Object version, commit, builtAt
docker compose logs --since 24h watchtower  # "Found new image", "Started new container"
docker compose images
```

The dashboard shows the same under Settings > About. The commit is the short
SHA of the image's `sha-<commit>` tag.

Update right away instead of waiting for Watchtower:
`docker compose pull; docker compose up -d`. Pause automatic updates with
`docker compose stop watchtower`.

Watchtower does not touch `compose.yaml` or `.env`. When the stack itself
changes in the repository:

```powershell
git -C C:\trail pull
docker compose up -d
```

## Rollback

Pin the app to an earlier build: every commit on `main` has an image tag
`sha-<first 7 characters of the commit>` (GitHub > Packages > trail lists
them).

```powershell
# in .env: TRAIL_IMAGE_TAG=sha-1a2b3c4
docker compose up -d app
```

Watchtower leaves a pinned tag alone, because it never moves. To follow `main`
again, set `TRAIL_IMAGE_TAG=latest` and run `docker compose up -d app`.

Migrations only move forward: an older image runs against the newer schema.
When that does not work, restore the dump made before the update.

## Private image

GHCR packages start out private. Making the `trail` package public (GitHub >
Packages > trail > Package settings > Change visibility) removes every step
below. For a private package:

1. Create a classic personal access token with only the `read:packages` scope
   (GHCR does not accept fine-grained tokens).
2. Log in the laptop's Docker, so `docker compose pull` works:
   `docker login ghcr.io -u JensPenneman` and paste the token.
3. Give Watchtower its own credentials, because Docker Desktop keeps the
   login in the Windows Credential Manager where Watchtower cannot read it:
   ```powershell
   New-Item -ItemType Directory -Force secrets | Out-Null
   $auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('JensPenneman:<token>'))
   [IO.File]::WriteAllText("$PWD\secrets\watchtower-config.json", "{`"auths`":{`"ghcr.io`":{`"auth`":`"$auth`"}}}")
   ```
   then remove the `#` in front of the `./secrets/watchtower-config.json`
   line of the `watchtower` service in `compose.yaml` and run
   `docker compose up -d`. `deploy/secrets/` is git-ignored.

## Postgres major upgrade

The `db` image stays on Postgres 18. Dependabot opens a pull request when a new
major exists; it never merges itself. Postgres 18+ images keep the cluster in
`/var/lib/postgresql/<major>/docker`, so a new major starts next to the old
data in the same volume, empty. Move the data with a dump:

1. `docker compose stop app`, then [dump now](#backups).
2. Update `compose.yaml` to the new major (merge the pull request,
   `git -C C:\trail pull`) and start only the new, empty database:
   `docker compose up -d db`.
3. Restore the dump as under "Restore on a new laptop" in
   [Backups](#backups), which ends with `docker compose up -d`.
4. Once everything checks out, remove the old cluster:
   `docker compose exec db rm -rf /var/lib/postgresql/18`.

## Change the database password

`POSTGRES_PASSWORD` is applied only when the database is created. To change
it, set it in the database first, then in `.env`:

```powershell
docker compose exec db psql -U trail -d trail -c "ALTER USER trail PASSWORD '<new hex password>'"
# set POSTGRES_PASSWORD=<new hex password> in .env
docker compose up -d
```

## Logs

```powershell
docker compose logs -f app                  # follow; the app logs JSON lines (pino)
docker compose logs --since 1h app | Select-String '"level":50'   # errors
docker compose logs backup watchtower
```

Every container keeps at most 5 files of 10 MB of logs. Device tokens, cookies
and coordinates never appear in the app's logs at the default level.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `required variable POSTGRES_PASSWORD is missing a value` | `.env` is missing or not in the folder you run `docker compose` from (`C:\trail\deploy`). |
| `app` keeps restarting; its log says "Invalid configuration" | A value in `.env` is invalid; the log names it (for example `INGEST_BASE_URL` still containing `<laptop-lan-ip>`). Fix it and run `docker compose up -d`. |
| `/api/health` answers 503 | The database is down: `docker compose ps db`, `docker compose logs db`. |
| Compose builds the image instead of pulling it | The pull failed, usually a private package without `docker login ghcr.io`. |
| Nothing runs after a Windows restart | Docker Desktop starts only at sign-in; see [Docker Desktop](#docker-desktop). |
| Phone uploads do not arrive (LAN phase) | The phone is not on the home Wi-Fi; the laptop's address changed (reserve it); the firewall rule or the Private profile is missing; Overland's "Local Network" permission is off ([overland.md](overland.md)). Test with `http://<laptop-ip>:8080/api/health/live` in the phone's browser. |
| The browser offers no passkey at `http://<laptop-ip>:8080` | Expected: passkeys need HTTPS or localhost. Use `http://localhost:8080` on the laptop. |
| "No passkey for this address" after going public | Add one with a passkey link ([After the address changes](#after-the-address-changes)). |
| cloudflared logs "Provided Tunnel token is not valid" | `TUNNEL_TOKEN` is incomplete; copy the whole string after `--token`. |
| `https://trail.jenspenneman.com` shows a Cloudflare 502 or 1033 | The route's service must be `HTTP` / `app:8080`, and `app` must be running. |
| Overland reports HTML or 403 errors after going public | A Cloudflare challenge hit the ingest path: Bot Fight Mode and the Skip rule (tunnel step 4). |
| Caddy logs "CAA record ... prevents issuance" | The CAA records must allow `letsencrypt.org`. |
| Caddy logs a timeout or connection refused from Let's Encrypt | Port forwarding, the firewall rules, or carrier-grade NAT (direct step 1). |
| Public address works on mobile data, not on the home Wi-Fi | NAT loopback (see the direct setup). |
| Watchtower logs "unauthorized" or "denied" | Private package: set up [Private image](#private-image). |
| A service is missing after an automatic update | Watchtower could not recreate it; `docker compose up -d` brings it back. `docker compose logs watchtower` has the reason. |
| `backup` restarts with "is not a writable directory" | `BACKUP_DIR` does not exist or is not writable; use forward slashes in the Windows path. |
| `backup` restarts with "pg_dump failed" | The database is not reachable; the log line before it shows why. |
| Backups happen at the wrong hour | `TZ` in `.env`. |
| Port 8080 is already in use | Set `TRAIL_HTTP_PORT` and change `PUBLIC_URL` and `INGEST_BASE_URL` with it. |
| `docker compose up` fails with "Pool overlaps with other one on this address space" | Another Docker network uses `10.201.8.0/24`. Pick a free subnet for `edge` in `compose.yaml` and move the `ipv4_address` of cloudflared and caddy and the default of `TRUST_PROXY` with it. |
