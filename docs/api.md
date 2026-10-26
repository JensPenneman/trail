# Trail API

The Trail API gives scripts, apps and agents what a Trail server holds for an
account: its devices, where they are now and, in later releases, where they
have been and how they travelled. It is JSON over HTTPS under `/api/v1`. The
OpenAPI 3.1 document at `/api/v1/openapi.json` describes every operation, and
the reference at `/docs` renders it with this guide on top.

## Versioning

`/api/v1` is Trail's documented, stable interface:

- Operations, fields, query parameters and error codes are only ever added;
  what exists keeps its meaning. Ignore fields you do not know: new ones
  arrive with new releases.
- A change that would break a client gets a new base path, `/api/v2`, never
  a silent change in v1.
- The dashboard's own routes under `/api/` without `v1` are private. They
  change with the dashboard and are not meant for other clients.

## Authentication

Send an API token as a bearer token:

```http
GET /api/v1/devices HTTP/1.1
Host: trail.example.com
Authorization: Bearer trlk_…
```

Tokens look like `trlk_` followed by 43 characters (`A–Z`, `a–z`, `0–9`, `-`
and `_`). On the server's own origin, a signed-in browser session works as
well: the dashboard uses it. Cookies never cross origins, so a page on
another site can only use a token.

A request that has no valid credential gets `401` and a `WWW-Authenticate`
header (RFC 6750): `Bearer realm="trail"` when no credential was sent, with
`error="invalid_token"` when a token was refused. The body's code is
`token_expired` for a token past its expiry and `unauthorized` for everything
else: unknown, revoked or malformed tokens, or a token used from an address
it does not allow. A token that lacks a scope gets `403 insufficient_scope`,
with the missing scopes in the message and in the header's `scope` attribute.

## Tokens

API tokens arrive in the next release: you will create them under
Settings › API tokens, pick their scopes, their devices and when they expire,
and see each secret exactly once. Until then the API accepts the signed-in
session only.

## Scopes

A token can do what its scopes allow. Each operation lists the scopes that
grant access to it; one of them is enough unless the operation says that it
needs them all. A signed-in session holds every scope.

| Scope | Allows |
|---|---|
| `profile:read` | Read the account's name and time zone. |
| `devices:read` | List the devices with their name, status, last-seen time and battery, not where they are. |
| `devices:write` | Rename devices, switch their alerts and queue settings presets; never their tokens. |
| `locations:read` | Read positions: where the devices are now and where they have been (points, tracks, the timeline). |
| `locations:write` | Correct how you travelled (transport mode overrides). |
| `history:read` | Read visits, trips, daily statistics, activity and the heatmap. |
| `people:read` | See the people who share their location with you. |
| `shares:read` | List your shares, the ones you receive and your public links. |
| `shares:write` | Start and stop sharing, hide people and manage public links. |

Positions are what `locations:read` is for: a device in `GET /api/v1/devices`
carries its `lastLocation` only for a credential with that scope. With
`devices:read` alone the field is left out, so a token for a status display
never learns where anyone is.

A token can also be limited to some of the account's devices. The other
devices then look as if they did not exist: they are missing from lists and
answer `404`.

## Requests and responses

- JSON in UTF-8. Request bodies are `application/json`, at most 100 kB.
- Times are ISO 8601. Responses give UTC (`2026-10-26T08:41:07.000Z`);
  requests may use any offset. A range `from`–`to` includes `from` and
  excludes `to`. Local days, like statistics per day, follow the account's
  time zone (see `GET /api/v1/me`).
- Units are metres, metres per second and degrees (WGS84).
- Ids are UUIDs. Address a device by its id: names need not be unique.
- An id that does not exist, belongs to someone else, is malformed or lies
  outside the token's devices answers `404 not_found`, whichever it is.
- `HEAD` works wherever `GET` does.
- Responses are `Cache-Control: no-store`, except the OpenAPI document,
  which may be cached for five minutes and revalidated with its `ETag`.

## Pagination

Lists that grow without bound, such as recorded points, come in pages: ask for
`limit` items and get `{ "items": […], "nextCursor": "…" }`; pass
`cursor=<nextCursor>` for the next page until `nextCursor` is `null`. Other
lists cover a bounded range (at most 93 days) and come whole.

## Errors

Every error has the same body:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Invalid request — limit: Too big: expected number to be <=1000",
    "fields": { "limit": ["Too big: expected number to be <=1000"] }
  }
}
```

`code` is stable and meant for programs; `message` is for people and may
change. `fields` appears with `validation_failed` and maps each request field
(a dot-joined path) to its problems.

| Status | Codes | Meaning |
|---|---|---|
| 400 | `validation_failed`, `bad_request` | Invalid query or body; unreadable JSON |
| 401 | `unauthorized`, `token_expired` | No credential, or a refused one |
| 403 | `insufficient_scope`, `forbidden`, `origin_not_allowed` | A missing scope; something only a signed-in browser may do; a session request from another site |
| 404 | `not_found` | No such resource or route |
| 409 | `conflict` | The change conflicts with the current state |
| 413 | `payload_too_large` | The body is over 100 kB |
| 415 | `bad_request` | The body is not JSON |
| 429 | `rate_limited` | A rate limit was reached (see below) |
| 500 | `internal` | A server error; it has been logged |
| 503 | `unavailable` | The database is down for a moment; retry |

## Rate limits

| Limit | Default | Counts |
|---|---|---|
| Per client address | 600 a minute | every API request from the address, the dashboard's included |
| Per API token | 600 a minute | every request with the token, from any address |
| Refused tokens | 30 in 10 minutes | requests with an invalid token, per address; valid tokens are never held back by it |

The server's owner can change them. Responses carry the limits that applied in
`RateLimit-Policy` and the remaining quota in `RateLimit` (IETF draft 8), one
entry per limit (`"ip"`, `"token"`), for example
`RateLimit: "ip"; r=597; t=41, "token"; r=598; t=41`. Over a limit you get
`429 rate_limited` with `Retry-After` in seconds.

## CORS

Any origin may call the API: responses carry `Access-Control-Allow-Origin: *`
and expose `ETag`, `RateLimit`, `RateLimit-Policy`, `Retry-After`,
`WWW-Authenticate` and `X-Request-Id` to scripts. Requests may send
`Authorization`, `Content-Type` and `Last-Event-ID`; preflight requests need
no credential. There are no credentialed cross-origin requests: a page on
another site uses a token, never the visitor's session. A token in a web page
can be read by anyone who opens that page, so give such a token as few
scopes and devices as it needs.

## Examples

```sh
export TRAIL=https://trail.example.com
export TRAIL_TOKEN=trlk_…

# The account behind the token
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/me"

# All devices (with their latest positions when the token has locations:read)
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/devices"

# Where one device is now
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" \
  "$TRAIL/api/v1/devices/0199a0f3-5fec-72ad-a30c-5ab9d8908cd3/location"

# The OpenAPI document, for a code generator or an HTTP client
curl -sS "$TRAIL/api/v1/openapi.json" -o trail-openapi.json
```

A device's location:

```json
{
  "location": {
    "deviceId": "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
    "lat": 51.0543,
    "lon": 3.7174,
    "recordedAt": "2026-10-26T08:41:07.000Z",
    "accuracy": 5,
    "speed": 4.2,
    "course": 87,
    "altitude": 12,
    "motion": ["cycling"],
    "battery": { "level": 0.82, "state": "unplugged", "recordedAt": "2026-10-26T08:41:07.000Z" }
  }
}
```
