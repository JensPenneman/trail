# Security policy

## Supported versions

Only the newest release (`ghcr.io/jenspenneman/trail:<version>`) and `main`
are supported. There are no release branches to patch; fixes ship in a new
release, which Launchway deploys as soon as it is published.

## Reporting a vulnerability

Please report vulnerabilities **privately**, never in a public issue or pull
request:

1. Preferred: GitHub private vulnerability reporting —
   https://github.com/JensPenneman/trail/security/advisories/new
2. Alternative: email jenspenneman26@gmail.com.

Include what you found, how to reproduce it and, if you have one, a suggested
fix. You will get an acknowledgement within 72 hours and a resolution or a
status update within 14 days. Credit is given in the advisory if you want it.
There is no bug bounty.

## Scope

- the application: the API, the Overland ingest endpoint, authentication and
  the web app;
- the container image `ghcr.io/jenspenneman/trail`;
- the deployment configuration in `deploy/` and the CI/CD workflows in
  `.github/`.

Third-party software and services (Overland, Cloudflare, GitHub, Docker,
PostgreSQL, the map tile provider) are out of scope; report issues there to
the respective vendor. A self-hosted server's own configuration (router, DNS,
the host and its deployment platform) is the operator's responsibility.

## Safe harbour

Good-faith research that respects this policy, avoids privacy violations,
destruction of data and service disruption, and gives reasonable time to fix
before disclosure will not be pursued. Only test against a server you run
yourself: location data is personal data.

## What is already in place

- **Authentication**: passkeys only (WebAuthn with user verification, bound to
  the origin), no passwords. Session, device, invite and passkey-link tokens
  are random and stored as SHA-256 hashes only; session cookies are
  `HttpOnly`, `SameSite=Lax` and `__Host-`/`Secure` on HTTPS.
- **API tokens**: 32 random bytes (`trlk_…`), stored as SHA-256 hashes only
  and shown once, when created or rolled. Each token has scopes (positions
  only with `locations:read`), can be limited to some devices and to IP
  addresses or networks, and expires unless
  its owner chooses otherwise; rolling replaces its secret at once, revoking
  ends it at once. Tokens are accepted only in the `Authorization` header of
  `/api/v1`, are shape-checked before any lookup, and are never logged; only
  a person signed in with a passkey can create, change, roll or revoke them,
  and no token reaches sign-in, passkeys, device credentials or other tokens.
  Creating, changing, rolling and revoking are logged with the token's id.
- **Requests**: origin checks against cross-site requests, input validation of
  every request with zod, body size limits, rate limits per IP, per device
  token and per API token (and for refused tokens per IP); client addresses
  and HTTPS are taken from forwarded headers of the stack's own proxies only.
- **Headers**: a strict Content Security Policy without inline scripts or
  styles, HSTS on HTTPS, `frame-ancestors 'none'`, COOP/CORP, a
  Permissions-Policy that denies everything except passkeys.
- **Privacy**: tokens, cookies and coordinates are kept out of the logs at the
  default log level; every query is scoped to the signed-in person's devices,
  or to the devices an API token is limited to, and to what other people share
  with them (below).
- **Container**: runs as an unprivileged user on a read-only root file system
  with all Linux capabilities dropped and `no-new-privileges`; the database
  sits on an internal network without a published port; the app receives only
  its own settings, never those of Launchway or the backup.
- **Supply chain**: GitHub Actions pinned to commit SHAs; the base image
  pinned by digest; images built in CI only, with BuildKit provenance and an
  SBOM, and a signed GitHub build provenance attestation when the repository
  is public; Dependabot updates for npm, Actions and Docker, with majors
  reviewed by hand.

## Sharing: who sees what

Location sharing (People and public links, [docs/sharing.md](docs/sharing.md))
is opt-in, one way and limited to what its owner picks.

- **A person you share with** sees, for the devices you picked: the device
  name, the newest position inside the share's window (for a live-only share
  the last 12 hours by default, `STALE_AFTER_HOURS`; else the days of history
  you allowed), and battery and
  activity when you include them. With `approximate` or `area` they see the
  centre of a cell about 560 m or 5.6 km across instead of the position, with
  no altitude or course (and no speed for `area`); history is only ever shared
  precisely. They see your name and address, and you see when they last
  looked. They never see your device tokens or keys, settings, alerts, upload
  logs, older points, exports, other devices or anything of other people.
- **A holder of a public link** sees the label, the names of the devices it
  names, their positions at its precision, optionally their route of up to 7
  days (precise links only) and battery and activity — never your name,
  address, account or device ids. The page is not indexed and sends no
  referrer; its secret is stored as a hash, shown once and kept out of the
  logs.
- **Stopping is immediate**: a stopped, ended or hidden share and a turned-off
  or expired link show nothing from that request on, in reads and in live
  updates. Deleting a device or the account ends what it shared.
- **Coarse positions cannot be averaged back**: the cell of each share and
  device is fixed by a key the server generates and keeps to itself, so
  reading again returns the same centre. What a cell does reveal: when a
  person crosses into the next cell, the change shows that they were near
  its edge at about that time; and people who pool what different shares
  showed them (cells of different shares are offset differently) can narrow
  the area down to the overlap of their cells.
- **Addresses are not verified**: Trail treats an account as the owner of the
  address it signed up with, and a share with an address that has no account
  yet goes to whoever signs up with it first. Only the allow-list and
  invitations decide who may sign up, so this is as safe as they are: with a
  wildcard entry (`*@example.com`) or an open invitation, anyone allowed in
  could take an address that is still free. Share with a pending address only
  when that is acceptable, or ask an administrator to invite it (the share
  dialog offers it) and share once the account exists.
- **API tokens** need `people:read` to see people, `locations:read` as well for
  distances (they start from your own position), and `shares:read` or
  `shares:write` for shares and links. A token limited to some devices shares
  only those and cannot widen a share that shows others.
