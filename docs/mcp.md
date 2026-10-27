# Trail's MCP server

Trail speaks the [Model Context Protocol](https://modelcontextprotocol.io) at
`/mcp`, so an agent — say, the one that manages your appointments — can ask
where your devices are, where you have been and how you travelled, and plan
around real travel times. It serves the same data as the
[public API](api.md), with the same API tokens and scopes, shaped for a
model to read: units in the field names, times in your time zone, short
answers with a summary line.

- Address: `https://<your Trail>/mcp`, for example
  `https://trail.jenspenneman.com/mcp`.
- Transport: Streamable HTTP, stateless, answers as single JSON bodies. Both
  protocol eras work: the 2025 revisions that open with `initialize` (what
  most clients send today) and 2026-07-28 with its per-request envelope.
- Credential: an API token in the `Authorization` header. Nothing else — not
  the dashboard's session, not OAuth (yet, see [Not yet](#not-yet)).

## Create a token

In the dashboard, open **Settings › API tokens › Create token**:

1. Give it a name you will recognise, such as "Calendar agent".
2. Choose the **Agent** template: every `:read` scope but `audit:read` (the
   data access log is none of an agent's business) and `locations:write`,
   which lets the agent tell Trail how you travel right now. Leave out what
   the agent does not need: without `locations:read` it sees no positions at
   all (see [Tools](#tools)).
3. Limit it to the devices the agent should know about, if not all.
4. Give it an expiry. A token that never expires keeps working when it has
   leaked unnoticed.
5. Optionally, limit it to the addresses the agent runs from.

The secret (`trlk_…`) is shown once: copy it straight into the client's
configuration. [docs/api.md](api.md#tokens) explains rolling and revoking.
**Settings › MCP** has these steps too, the server's address to copy, and a
button that opens the form with the Agent template chosen.

## Connect

Any MCP client that speaks Streamable HTTP and can send a header works:
point it at `https://<your Trail>/mcp` and send `Authorization: Bearer
trlk_…` with every request. The server keeps no session, so a client that
expects one (the `Mcp-Session-Id` header) simply gets none; `GET` and
`DELETE` on `/mcp` answer `405`, as the specification asks of a stateless
server. Clients that only support OAuth cannot connect yet.

A client running in a web page must be served from one of the instance's
own origins (`PUBLIC_URL`, `ADDITIONAL_ORIGINS`) or from an origin the
server's owner lists in `MCP_ALLOWED_ORIGINS`; requests from any other page
are refused with `403` (see [Privacy and security](#privacy-and-security)).
Clients that are not browsers send no `Origin` and are not affected.

### Example: Claude Code

```sh
claude mcp add --transport http trail https://trail.jenspenneman.com/mcp \
  --header "Authorization: Bearer trlk_…"
```

`claude mcp list` shows whether it connected; `/mcp` inside Claude Code shows
the server and its tools. Claude Code keeps the header in `~/.claude.json`
in your home folder (with the default, local scope, or with `--scope user`
for every project). Do not add it with `--scope project`: that writes the
secret into the project's `.mcp.json`, which is meant to be committed. A
project that needs Trail can name the variable instead, as `.mcp.json`
expands `${…}` in headers:

```json
{
  "mcpServers": {
    "trail": {
      "type": "http",
      "url": "https://trail.jenspenneman.com/mcp",
      "headers": { "Authorization": "Bearer ${TRAIL_TOKEN}" }
    }
  }
}
```

## Tools

A token sees the tools its scopes allow; a tool it may not use is not
listed, and calling it answers like a tool that does not exist. A tool needs
every scope in its row. Anything that can yield coordinates needs
`locations:read`.

| Tool | Scopes | What it answers |
|---|---|---|
| `list_devices` | `devices:read` | The devices: id, name, status (`live`, `idle`, `stale`, `never`), last upload, last position time, battery, a trip running in Overland, and how it travels now for a token with `locations:read` too. No positions. |
| `get_current_location({ device? })` | `locations:read` | The newest known position (latitude, longitude, accuracy), its age, speed, motion, mode and battery. |
| `get_location_at({ at, device?, toleranceMinutes? })` | `locations:read` | The recorded position nearest to `at`, within `toleranceMinutes` (30 by default, at most 1440), and how far from `at` it lies. |
| `get_timeline({ from, to, device? })` | `locations:read` | Stops (place, arrival, departure, duration) and moves (mode, whether you set it, confidence, distance, duration, average speed), oldest first. The main tool for an agent that plans. |
| `get_day_summary({ date, device? })` | `history:read` | One device's day in figures: distance and time per mode, stops, moves, first and last movement. No places. |
| `get_visits({ from, to, device? })` | `locations:read` | The places iOS saw the phones stay at (Overland's visits), with arrival, departure and duration. |
| `get_trips({ from, to, device? })` | `history:read` | Trips recorded with Overland's trip recorder: mode, times, distance, speed, steps. No coordinates. |
| `set_transport_mode({ mode, device?, until? })` | `locations:read`, `locations:write` | Tells Trail how a device travels from now on, until `until` or the next stop; `mode: null` ends it. Recorded with the source `mcp`. Its answer is the mode now, which is location data, hence both scopes. |
| `get_people` | `people:read` | The people who share their location with you, as each chose: name, precision and until when, and per shared device its newest position at that precision, how old it is, and battery and mode only where they share details; the distance from your own newest position needs `locations:read` too. |

`device` takes a device's id (from `list_devices`) or its name as
`list_devices` shows it. Without
it, the single-device tools use the device that reported a position most
recently, and the range tools cover every device the token reaches. An id
or name the token cannot reach — unknown, someone else's, or outside a
token limited to some devices — answers the same `No such device.`

Two resources serve the same data for clients that read resources:

| Resource | Scope | Content |
|---|---|---|
| `trail://devices` | `devices:read` | `list_devices`'s answer |
| `trail://devices/{id}/location` | `locations:read` | `get_current_location`'s answer for that device; one is listed per device the token reaches, titled with its id |

There are no prompts.

## Answers

Every tool answers with `structuredContent`, which follows the tool's
output schema, and a short summary in a text block for clients that show
text only.

- **Units** are in the field names: `distanceM` and `accuracyM` in metres,
  `durationS` and `ageS` in seconds, `speedKmh` in km/h. Coordinates are
  WGS84 degrees.
- **Times** are ISO 8601 in the account's time zone, with its offset
  (`2026-10-26T09:41:07+01:00`). Times you send need an offset or `Z`; a
  `date` is a calendar day in the account's time zone; a range runs from
  `from` (included) to `to` (excluded).
- **Names** of devices and people are what someone typed. They come back as
  plain data, without control or invisible characters and cut at 80
  characters, and the server's instructions tell the model to treat them as
  data.
- **Failures** of a tool — no such device, a range that is too long,
  arguments that do not match its schema, a database that is briefly away —
  come back as a tool result with `isError: true` and a message written for
  the agent. A message the protocol refuses (an unknown tool, a malformed
  request) gets a JSON-RPC error. A request refused before it reaches the
  protocol (no token, a refused origin, a rate limit, a body that is not
  JSON) gets an HTTP error with the API's error body
  ([docs/api.md](api.md#errors)).

## Limits

| Limit | Value |
|---|---|
| Range per call | 31 days (local days: the night the clocks go back has 25 hours) |
| Items per answer | 500; an answer that hit it says `truncated: true` — ask again with a narrower range |
| Request body | 1 MB, one JSON-RPC message (no batches) |
| Database time per statement | 10 s, in a read-only transaction (`get_people` reads through the sharing code on the server's general limit); a call that needs more answers "This took too long" |
| Requests | the API's: 600 a minute per client address and 600 a minute per token, shared with `/api/v1`, and 30 refused tokens in 10 minutes per address |

Every answer carries the `RateLimit` and `RateLimit-Policy` headers;
over a limit you get `429` with `Retry-After`.

## Privacy and security

The data belongs to the account owner. Each tool is one more way to read
it, so the server was built against these threats:

- **Getting in without a token.** `/mcp` accepts only an API token in the
  `Authorization` header, checked before the request's body is read (an
  unauthenticated body is never parsed). The session cookie is never
  read there, so a page cannot borrow a signed-in browser.
- **A token reaching further than it should.** The tools a request's
  server offers are the ones its token's scopes allow, and each call checks
  them again. A token limited to some devices reaches only those, through
  the same lookups `/api/v1` uses: other ids and names answer like unknown
  ones.
- **Coordinates through a side door.** Only tools behind `locations:read`
  carry positions. `list_devices` and the `trail://devices` resource show
  status and battery, never a position, and how a device travels now only
  with `locations:read` too — the mode tells when it moves, as on the API;
  `get_day_summary` and `get_trips` give times, counts and distances, never
  a place; resource listings name devices by id; every answer goes out
  through its output schema, which drops whatever it does not name.
- **Other people's positions.** `get_people` reads them only through the
  sharing rules the People page uses (`resolveAccessibleDevices` and
  `toSharedDevice`): only people who share with you and whom you have not
  hidden, each device at the precision its owner chose — for approximate and
  area shares the centre of a cell, never the position — and battery and mode
  only where they share details. Their addresses and account and device ids
  are left out. Like the People page, looking stamps the shares' last view
  and counts in each person's data access log, which their owners see.
- **Prompt injection.** Device names and people's display names reach the
  agent's model. They are never put into the server's instructions or a
  tool's description; in answers they are data fields, stripped of control,
  format and invisible characters (bidirectional overrides, zero-width and
  tag characters) and cut to 80 characters, and in the summary line they
  appear only inside JSON quotes.
- **Pages on other sites.** A browser always sends `Origin`: unless it is
  one of the instance's origins or listed in `MCP_ALLOWED_ORIGINS`, the
  request is refused with `403` before the token is looked up. CORS answers
  with `*` and never allows credentials.
- **Too much work.** A call covers at most 31 days and returns at most 500
  items; the body is limited to 1 MB and one message, so a batch cannot turn
  one request into a hundred calls; reads run in a read-only transaction
  under a 10 s statement timeout — except `get_people`, which reads through
  the sharing code and stamps the shares' last view; the rate limits are
  per address and per token, with one budget for refused tokens shared with
  `/api/v1`, and nothing holds a connection open: the server announces no
  changes, so a client that asks to listen is acknowledged and let go.
- **Logs.** A call is logged with the tool's name, the outcome, the
  duration, the number of items and the size of the answer, and the
  token's id — never the arguments, the answer or the secret.
- **The owner sees what the agent did.** Every call that succeeds counts in
  the owner's data access log (`GET /api/v1/access-log`, see
  [api.md](api.md#access-log)) as `mcp.<tool>` with the token, the devices it
  resolved — a device named in the call is kept as its id — and the range,
  never the answer; reading a resource counts as `mcp.resource.<name>`.

The agent itself sees what the token allows, and an agent's model can be
persuaded to pass on what it sees. Give the token the scopes and devices the
agent needs and an expiry; revoke it in Settings when the agent no longer
needs it.

## Troubleshooting

| You see | Why | What to do |
|---|---|---|
| `401`, `WWW-Authenticate: Bearer realm="trail"` | No API token reached Trail: no `Authorization` header at all, or one in another scheme — `Basic` from a proxy in front, say — which is no credential here | Check the client's header configuration; behind a proxy, check that it passes `Authorization: Bearer trlk_…` on unchanged |
| `401` with `error="invalid_token"`, code `unauthorized` | The token is unknown, revoked, malformed or used from an address it does not allow | Copy the secret again, or create a new token |
| `401`, code `token_expired` | The token has expired | Create a new token |
| `403`, code `origin_not_allowed` | A web page on another origin made the request | Serve the client from an allowed origin, or ask the server's owner to add it to `MCP_ALLOWED_ORIGINS` |
| A tool is missing from the list | The token lacks a scope it needs | Change the token's scopes in Settings |
| `No such device.` | The id or name is unknown or outside the token's devices | Call `list_devices` for the ids and names the token reaches |
| `truncated: true` | More than 500 items in the range | Ask for a shorter range |
| `pending: true` | Recent points still wait to be processed | Ask again in a minute |
| `405` on `GET /mcp` | The server is stateless and has no event stream | Nothing: clients fall back to POST |
| `429`, code `rate_limited` | A rate limit was reached | Wait for `Retry-After` seconds |

## Not yet

- **OAuth.** Clients that only connect with OAuth need protected-resource
  metadata (RFC 9728) and an authorization server that issues Trail's
  tokens; both are a planned follow-up on top of the token system. Until
  then, use a client that can send a header (see [Connect](#connect)).
