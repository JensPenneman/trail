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
  or to the devices an API token is limited to.
- **Container**: runs as an unprivileged user on a read-only root file system
  with all Linux capabilities dropped and `no-new-privileges`; the database
  sits on an internal network without a published port; the app receives only
  its own settings, never those of Launchway or the backup.
- **Supply chain**: GitHub Actions pinned to commit SHAs; the base image
  pinned by digest; images built in CI only, with BuildKit provenance and an
  SBOM, and a signed GitHub build provenance attestation when the repository
  is public; Dependabot updates for npm, Actions and Docker, with majors
  reviewed by hand.
