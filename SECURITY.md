# Security policy

## Supported versions

Only the `main` branch and the image built from it
(`ghcr.io/jenspenneman/trail:latest`) are supported. There are no release
branches to patch; fixes ship as a new `latest`, which servers install
automatically.

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
the respective vendor. A self-hosted server's own configuration (router,
Cloudflare account, Windows) is the operator's responsibility.

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
- **Requests**: origin checks against cross-site requests, input validation of
  every request with zod, body size limits, rate limits per IP and per device
  token; client addresses and HTTPS are taken from forwarded headers of the
  stack's own proxies only.
- **Headers**: a strict Content Security Policy without inline scripts or
  styles, HSTS on HTTPS, `frame-ancestors 'none'`, COOP/CORP, a
  Permissions-Policy that denies everything except passkeys.
- **Privacy**: tokens, cookies and coordinates are kept out of the logs at the
  default log level; every query is scoped to the signed-in person's devices.
- **Container**: runs as an unprivileged user on a read-only root file system
  with all Linux capabilities dropped and `no-new-privileges`; the database
  sits on an internal network without a published port; the app receives only
  its own settings, never the tunnel or DNS credentials.
- **Supply chain**: GitHub Actions pinned to commit SHAs; the base image
  pinned by digest; images built in CI only, with BuildKit provenance and an
  SBOM, and a signed GitHub build provenance attestation when the repository
  is public; Dependabot updates for npm, Actions and Docker, with majors
  reviewed by hand.
