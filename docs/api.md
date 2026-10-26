# Trail API

The Trail API gives scripts, apps and agents what a Trail server holds for an
account: its devices, where they are now, where they have been — every point,
visit and trip, statistics per day and an all-time heatmap — and how they
travelled. It is JSON over HTTPS under `/api/v1`. The
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
and `_`); [Tokens](#tokens) explains how to get one. On the server's own
origin, a signed-in browser session works as well: the dashboard uses it.
Cookies never cross origins, so a page on another site can only use a token.

A request that has no valid credential gets `401` and a `WWW-Authenticate`
header (RFC 6750): `Bearer realm="trail"` when no credential was sent, with
`error="invalid_token"` when a token was refused. The body's code is
`token_expired` for a token past its expiry and `unauthorized` for everything
else: unknown, revoked or malformed tokens, or a token used from an address
it does not allow. A token that lacks a scope gets `403 insufficient_scope`,
with the missing scopes in the message and in the header's `scope` attribute.

## Tokens

Create a token in the dashboard, under **Settings › API tokens › Create
token**. You choose:

- **a name**, to recognise it later (where it is used, such as "Home
  Assistant");
- **what it may do**: its [scopes](#scopes). Three templates fill them in,
  and you can adjust them afterwards:

  | Template | Scopes |
  |---|---|
  | Read-only | every `:read` scope |
  | Agent | every `:read` scope and `locations:write` |
  | Full access | every scope |

- **its devices**: all of them (also the ones you add later), or some. The
  others then look as if they did not exist: they are missing from lists and
  answer `404`. Deleting a device takes it out of every token; a token whose
  last device was deleted reaches no device at all (it never falls back to
  all of them);
- **when it expires**: in 30 days, 90 days, a year, on a date, or never. A
  token without an expiry works until you revoke it, also when it has leaked
  unnoticed: prefer an expiry;
- optionally, **the addresses it may be used from**: IPv4 and IPv6
  addresses and networks in CIDR notation (`203.0.113.7`,
  `192.168.1.0/24`, `2001:db8::/32`; IPv4 networks in IPv4 notation). A
  request from anywhere else is refused like an unknown token. The address is
  the client's as the server sees it: behind a proxy the server trusts, the
  address that proxy reports.

The secret is shown **once**, right after you create the token: copy it into
the program that uses it, or into a password manager. Trail stores only a
hash of it, so nobody can show it again. An account can have 50 active
tokens, and keeps at most 200 in all, the expired and revoked ones it still
lists included.

Settings lists every token with its hint (the last four characters), scopes,
devices, addresses, expiry and when and from where it was last used (updated
at most once a minute). There you can also:

- **Roll** a token: it gets a new secret, shown once, and keeps its name,
  scopes, devices, addresses and expiry. The old secret stops working at
  once.
- **Revoke** a token: it stops working at once and cannot be restored. It
  stays in the list as revoked for 30 days, like an expired one, and is then
  removed.

Tokens are managed only there, signed in with a passkey: no token can create,
change, roll or revoke tokens, or manage sign-in, passkeys or device
credentials.

To check a token, or to see when it expires, ask the API about it:

```sh
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/tokens/verify"
```

```json
{
  "id": "019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b",
  "name": "Home Assistant",
  "scopes": ["devices:read", "locations:read"],
  "deviceIds": ["0199a0f3-5fec-72ad-a30c-5ab9d8908cd3"],
  "expiresAt": "2027-01-24T09:00:00.000Z",
  "status": "active"
}
```

A token that is refused gets `401` instead, and the reason, as far as it is
safe to tell:

| Answer | `error.code` | `WWW-Authenticate` |
|---|---|---|
| The token has expired | `token_expired` | `Bearer realm="trail", error="invalid_token"` |
| Unknown, revoked or malformed, or used from an address it does not allow | `unauthorized` | `Bearer realm="trail", error="invalid_token"` |
| No credential at all | `unauthorized` | `Bearer realm="trail"` |
| The token lacks a scope (`403`) | `insufficient_scope` | `Bearer realm="trail", error="insufficient_scope", scope="…"` |

A caller outside a token's addresses learns nothing about it, not even that
it has expired. `tokens/verify` with a signed-in session (which has no token)
answers `400 bad_request`.

Keep tokens out of URLs, shared files and source code: send them in the
`Authorization` header only. Should one end up in a URL anyway, the server
keeps it out of its logs.

## Scopes

A token can do what its scopes allow. Each operation lists the scopes that
grant access to it; one of them is enough unless the operation says that it
needs them all. A signed-in session holds every scope.

| Scope | Allows |
|---|---|
| `profile:read` | Read the account's name and time zone. |
| `devices:read` | List the devices with their name, status, last-seen time and battery, not where they are. |
| `devices:write` | Rename devices, switch their alerts and queue settings presets; never their tokens. |
| `locations:read` | Read positions: where the devices are now and where they have been (points, visits, the heatmap, tracks, the timeline). |
| `locations:write` | Correct how you travelled (transport mode overrides). |
| `history:read` | Read trips, daily statistics and activity: the history without coordinates. |
| `people:read` | See the people who share their location with you. |
| `shares:read` | List your shares, the ones you receive and your public links. |
| `shares:write` | Start and stop sharing, hide people and manage public links. |

Coordinates are what `locations:read` is for: every answer with a place in it
needs it — points, visits, the heatmap and a device's position. A device in
`GET /api/v1/devices` (and wherever else the API answers with a device, such as
after `PATCH /api/v1/devices/{id}`) carries its `lastLocation` only for a
credential with that scope; with `devices:read` alone the field is left out,
so a token for a status display never learns where anyone is. `history:read`
is the history without coordinates: trips, statistics per day and activity.
The same goes for everything else that can yield coordinates: a share or a
public link shows your positions, so making, changing or confirming one needs
`locations:read` as well as `shares:write`.

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
`cursor=<nextCursor>` for the next page until `nextCursor` is `null`. A
cursor is opaque: pass it back as it is, with the same other parameters. Other
lists cover a bounded range and come whole: at most 400 days for visits,
trips and statistics per day.

`GET /api/v1/locations` returns one device's points oldest first, up to 1000
a page, exactly as the phone recorded them: the documented fields, not the
Wi-Fi network or Overland's own ids, which stay on the server. A phone uploads when it can, so points
may arrive later than newer ones: to keep a copy current, ask again for a
range that overlaps the end of the previous one.

## Levels, tracks and the timeline

Trail works out from the recorded points how a device travelled, in four
levels of calculation, each built on the one before:

| Level | What it is |
|---|---|
| `raw` | The points as the phone sent them. |
| `averaged` | Outliers dropped and GPS noise smoothed; a phone lying still is one position. |
| `mapped` | Snapped to OpenStreetMap roads and railways, with the way's shape between points — a train recorded every few minutes follows the rails. |
| `inferred` | Stops and moves; each move with a transport mode and a confidence, the corrections people made applied. |

`GET /api/v1/tracks?from=…&to=…&level=…` returns the tracks at a level (at
most 93 days; `devices` narrows it, `maxPoints` caps each device's points,
8000 by default). Every point is served at the asked level or the best one
below it that exists yet — points that arrived seconds ago are still raw,
areas without map data averaged — and `availableLevel` names the level every
point reached, each segment's `level` its own. Points are `[lon, lat, t]`:
WGS84 degrees and epoch seconds (the way's shape between two mapped points
carries interpolated times). At `inferred` the segments are the timeline's
stops and moves with their modes; at the other levels they are pieces of
track, split where the recording paused for more than ten minutes.

`GET /api/v1/segments?from=…&to=…` is the timeline itself: stops (with their
place, `centroid`, and duration) and moves (with `mode`, `modeInferred`,
`modeUser`, `confidence`, `needsReview`, distance, duration and speeds), a
page of up to `limit` (500 by default, at most 1000) at a time. `pending` is
true while points of the range still wait for processing — ask again a little
later. Transport modes: `stationary`, `walking`, `running`, `cycling`, `car`,
`bus`, `tram`, `metro`, `train`, `boat`, `plane` and `unknown`. `mode` is the
one that counts: a person's choice (`modeUser`), else the inferred one.

People (and agents) can put a mode right, with `locations:write` and
`locations:read` together (the answers carry the segment or the current mode):

- `PUT /api/v1/segments/{id}/mode` with `{ "mode": "train" }` sets a move's
  mode; it wins over the inference, also when the history is worked out
  again. `DELETE` on the same path hands the move back to the inference.
- `POST /api/v1/devices/{id}/mode` with `{ "mode": "train" }` says how the
  device travels from now on — until `until`, if given, or the next detected
  stop, whichever comes first. The same mode again changes nothing;
  `{ "mode": null }` ends it. `GET` on the same path tells the mode now.

`GET /api/v1/stats/modes?from=2026-10-01&to=2026-10-31` (`history:read`, local
days, at most 400) gives distance, time and segments per day, device and
mode. Segment ids stay the same while a segment keeps its start; after a
correction or new data, read the timeline again.

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
| 401 | `unauthorized`, `token_expired` | No credential, or a refused one (see [Tokens](#tokens)) |
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

## People and sharing

Sharing works like Find My: one person shares their location with another,
one way, for as long as they choose; the other may share back. Each share has
a precision:

| Precision | What the recipient gets |
|---|---|
| `precise` | the position as recorded |
| `approximate` | the centre of a cell about 560 m across, accuracy 556 m or more; no altitude or course |
| `area` | the centre of a cell about 5.6 km across, accuracy 5560 m or more; no altitude, course or speed |

Each person has one grid for all their devices, shares and links, and an
`area` cell is a block of whole `approximate` cells: the same position always
gives the same answer, so neither reading it often nor holding several
shares or links reveals anything more. Only `precise` shares
can include history (`historyDays`); the others are live only. Battery and
activity (`motion`, a running Overland trip's mode, and the current transport
mode as `GET /api/v1/devices/{id}/mode` gives it to the owner — the quick
toggle, else the latest stop or move while it is recent) come along when
`includeDetails` is true.

- `GET /api/v1/people` (`people:read`) lists the people who share with you,
  each with their devices and the newest position inside the share's window:
  the last `historyDays` days, or the last 12 hours for live-only shares.
  `distanceM` starts from your own most recently located device and needs
  `locations:read` as well. `GET /api/v1/people/{userId}/track` returns
  their track for shares with history, never older than the history allows.
- `GET`, `POST /api/v1/shares` and `PATCH`, `DELETE /api/v1/shares/{id}`
  manage your own shares: listing needs `shares:read`, stopping
  `shares:write`, starting and changing `shares:write` and `locations:read`.
  A `duration` (`hour`, `endOfDay` in your time zone, `week`,
  `indefinitely`) counts from the request. The answer shows whether the
  address has an account, and its name.
- An address without an account gets a `pending` share. Trail does not verify
  addresses, so it starts by itself only when someone signs up with an
  invitation to that very address. After any other sign-up with it the share
  is `joined`: the new account's name and address appear in the share, they
  see nothing yet, and `POST /api/v1/shares/{id}/confirm` (`shares:write` and
  `locations:read`) starts it once you know it is the person you meant — or
  `DELETE` withdraws it.
- `GET /api/v1/shares/incoming` lists the shares with you, and
  `POST /api/v1/shares/incoming/{id}/hide` and `…/unhide` hide or show a
  person. The owner sees that you hid them. Hiding holds for the person: a
  later share from them starts hidden too.
- `POST /api/v1/share-links` (`shares:write` and `locations:read`) makes a
  public link: anyone with its address sees your location without an
  account, until it expires (24 hours by default, at least an hour, at most
  30 days) or you delete it. Without a `label` the page reads “Shared
  location”, never your name. `GET /api/v1/share-links` lists the working
  links, then expired ones, at most 50. The answer carries the `secret` and the
  `url` (`<server>/s#<secret>`) once; Trail keeps only a hash. The secret is
  the address's fragment, which browsers never send to a server, a proxy or
  as a referrer. The page sends it in a header instead:
  `GET /api/public/share` with `X-Share-Secret: trls_…` — no other
  credential, 60 requests a minute per address, `404 not_found` for a
  missing or unknown secret and `404 share_expired` for an ended link. That
  endpoint belongs to the page and is not part of `/api/v1`.

A token limited to some devices shares only those, named in `deviceIds`, and
changes or confirms only shares that show nothing but its devices, before and
after the change (`403 forbidden`); it can always stop one.

```sh
# Share your location with someone until the end of your day, within about 560 m
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"email": "ana@example.com", "precision": "approximate", "duration": "endOfDay"}' \
  "$TRAIL/api/v1/shares"

# Who shares with you, and where they are
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/people"
```

## Examples

```sh
export TRAIL=https://trail.example.com
export TRAIL_TOKEN=trlk_…
export DEVICE=0199a0f3-5fec-72ad-a30c-5ab9d8908cd3

# The token itself: its scopes, devices and expiry
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/tokens/verify"

# The account behind the token
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/me"

# All devices (with their latest positions when the token has locations:read)
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/devices"

# Where one device is now
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/devices/$DEVICE/location"

# One day of points, page by page (needs jq); an empty cursor is the first page
cursor=""
while :; do
  page=$(curl -sS -G -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/locations" \
    --data-urlencode "device=$DEVICE" \
    --data-urlencode "from=2026-10-26T00:00:00+01:00" \
    --data-urlencode "to=2026-10-27T00:00:00+01:00" \
    --data-urlencode "limit=1000" --data-urlencode "cursor=$cursor")
  echo "$page" | jq -c '.items[]'
  cursor=$(echo "$page" | jq -r '.nextCursor // empty')
  [ -n "$cursor" ] || break
done

# Visits (locations:read) and trips (history:read) of a week, the statistics of a month
curl -sS -G -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/visits" \
  --data-urlencode "from=2026-10-19T00:00:00+02:00" --data-urlencode "to=2026-10-26T00:00:00+01:00"
curl -sS -G -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/trips" \
  --data-urlencode "from=2026-10-19T00:00:00+02:00" --data-urlencode "to=2026-10-26T00:00:00+01:00"
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" \
  "$TRAIL/api/v1/stats/days?from=2026-10-01&to=2026-10-31&devices=$DEVICE"

# Is data still coming in? Points and uploads per hour, the last 24 hours
curl -sS -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/stats/activity?hours=24"

# Rename a device and queue a settings preset for its next upload (devices:write)
curl -sS -X PATCH -H "Authorization: Bearer $TRAIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "Work phone", "pendingSettings": "high-resolution"}' \
  "$TRAIL/api/v1/devices/$DEVICE"

# Yesterday's stops and moves, and the tracks by transport mode
curl -sS -G -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/segments" \
  --data-urlencode "from=2026-10-25T00:00:00+02:00" --data-urlencode "to=2026-10-26T00:00:00+01:00"
curl -sS -G -H "Authorization: Bearer $TRAIL_TOKEN" "$TRAIL/api/v1/tracks" \
  --data-urlencode "from=2026-10-25T00:00:00+02:00" --data-urlencode "to=2026-10-26T00:00:00+01:00" \
  -d level=inferred

# That move was a train ride; and from now on I am on a bus
curl -sS -X PUT -H "Authorization: Bearer $TRAIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"train"}' "$TRAIL/api/v1/segments/019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d4e/mode"
curl -sS -X POST -H "Authorization: Bearer $TRAIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"bus"}' "$TRAIL/api/v1/devices/0199a0f3-5fec-72ad-a30c-5ab9d8908cd3/mode"

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

A page of points:

```json
{
  "items": [
    {
      "deviceId": "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
      "recordedAt": "2026-10-26T08:41:07.000Z",
      "receivedAt": "2026-10-26T08:45:12.000Z",
      "lat": 51.0543,
      "lon": 3.7174,
      "accuracy": 5,
      "verticalAccuracy": 3,
      "speed": 4.2,
      "speedAccuracy": 0.5,
      "course": 87,
      "courseAccuracy": 12,
      "altitude": 12,
      "motion": ["cycling"],
      "battery": { "level": 0.82, "state": "unplugged", "recordedAt": "2026-10-26T08:41:07.000Z" }
    }
  ],
  "nextCursor": "MjAyNi0xMC0yNlQwODo0MTowNy4wMDBa"
}
```
