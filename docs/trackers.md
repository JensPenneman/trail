# Setting up a phone

Trail records the locations that a tracking app on a phone sends it. It takes
five apps, on iPhones and on Android phones:

| App | Phones | Set up with | Guide |
|---|---|---|---|
| [Overland](https://github.com/aaronpk/Overland-iOS) | iPhone | a QR code or link | [overland.md](overland.md) |
| [OwnTracks](https://owntracks.org) | iPhone, Android | a QR code or link | [below](#owntracks) |
| [Traccar Client](https://www.traccar.org/client/) | iPhone, Android | a QR code or link | [below](#traccar-client) |
| [OsmAnd](https://osmand.net) | Android | one web address to paste | [below](#osmand) |
| [GPSLogger](https://gpslogger.app) | Android | a URL and a header to paste | [below](#gpslogger) |

All five are free. Each phone is a *device* in Trail with its own access
token: Devices › Add device, give it a name and choose the app. Trail then
shows exactly what that app needs — a setup code where the app takes one,
every value with a copy button, and the settings Trail recommends — and waits
for the first upload. The token is shown once; Trail keeps only its hash.
"Issue new token" on the device's page shows the setup again with a new token,
and can move the device to another app without losing its history.

## Which app

| | Overland | OwnTracks | Traccar Client | OsmAnd | GPSLogger |
|---|---|---|---|---|---|
| Phones | iPhone | iPhone, Android | iPhone, Android | Android | Android |
| Sends | batches | one point per request | one point per request | one point per request, while a trip is recorded | one point per request |
| Offline | keeps everything until Trail confirms | keeps its queue (iPhone: see below) | keeps points with *Offline buffering* | drops points older than its *Time buffer* | retries each point three times |
| Motion activity (walking, driving …) | yes | iPhone, with extended data | Traccar Client 9 only | no | no |
| Visits and trips | yes | no | no | no | no |
| Battery | level, charging or full | level, charging or full | level, charging | level | level, charging |
| Wi-Fi network | yes | yes | no | no | no |
| Settings sent from Trail | four presets | no | no | no | no |
| Battery use for detailed tracks | low to medium (pauses when still) | high on an iPhone (GPS stays on), medium on Android | medium | high (a navigation app) | medium |

On an iPhone, Overland records the most detail for the least battery. On
Android, OwnTracks and Traccar Client are the most complete; GPSLogger is the
lightest. Transport modes ([transport.md](transport.md)) need a point every 10
to 30 seconds while you move — the recommended settings below give that — and
are better with motion activity, which Overland and OwnTracks on iPhones send
(and Traccar Client 9, the version before the current one).

What every app gets alike: a point sent twice is stored once; a point Trail
cannot store (a broken time, the position 0,0) is kept in a reject log while
the upload is still acknowledged, so it never blocks the phone; the device's
page lists every upload; Live shows each one within seconds.

## OwnTracks

[OwnTracks](https://owntracks.org) for iPhone (App Store) and Android (Google
Play, F-Droid), in its **HTTP mode**: every point is one request to
`<Trail>/api/owntracks` with the device's access token — as the password of
HTTP Basic on Android (any user name), in an `Authorization: Bearer` header on
an iPhone.

1. In Trail: Devices › Add device, choose **OwnTracks**.
2. On the phone, let OwnTracks take a configuration link:
   - iPhone: OwnTracks › Settings › **Allow external configuration** on.
   - Android: OwnTracks 2.6 and later ask for it too: Preferences › Remote
     Control › **Allow external configuration** on (2.5 takes links without it).
3. Choose *iPhone* or *Android* above the setup code — on an iPhone also how
   it tracks, below — and scan the code with the camera, or tap **Open in
   OwnTracks** on the phone itself. (If an Android camera does not offer to
   open the code, open the setup page on the phone.) The link sets HTTP mode,
   the URL, the access token (Android: user name and password; iPhone: the
   *HTTP Headers*, with *Authentication* off), the device ID, the tracker ID
   and Trail's tracking settings.
4. Allow location access *Always* (Android: *Allow all the time*), and on
   Android let OwnTracks run without battery restrictions.

By hand: in OwnTracks' connection settings choose the mode **HTTP** and enter
the URL, the user name (any; Trail suggests the device's key), the device ID
and the tracker ID (two letters or digits, shown in OwnTracks); then the token:
on an iPhone leave *Authentication* off and set *HTTP Headers* to
`Authorization: Bearer trl_…`; on Android enter the access token as password.

**Tracking on an iPhone.** *Move*, the setup's default, keeps GPS on and
records the detail transport modes need, at a high battery cost: expect the
battery to run down noticeably faster. *Significant changes* leaves the fixes
to iOS — a point every few hundred metres or minutes, for very little battery —
enough for where you were, not for how you travelled. Trail offers a setup code
for each; OwnTracks' own mode button switches between them later.

Recommended settings (the setup link sets them):

| Setting | iPhone | Android |
|---|---|---|
| Mode | HTTP | HTTP |
| Token | HTTP Headers `Authorization: Bearer …`, Authentication off | user name and password |
| Monitoring | Move (or Significant changes, see above) | Significant changes |
| locatorDisplacement / Minimal location displacement | 30 m | 25 m |
| locatorInterval / Location interval | 60 s | 15 s |
| Location interval (Move mode) | — | 15 s |
| Limit max locator frequency | — | on |
| Locator priority | — | High accuracy (only through the link, which names it: Android reads a number as a place in its own list) |
| extendedData / Extended data | on | on |

The two apps read the same settings differently. On an iPhone, *Move* keeps
GPS on and reports a point after every 30 m, and at least once a minute. On
Android, *Move* reports every
interval whether the phone moves or not, so *Significant changes* with a
high-accuracy locator, a 15 s interval and a 25 m displacement reports every 15
to 30 seconds while you move and nothing while you stand still.

What Trail keeps of OwnTracks' messages:

| `_type` | Stored as |
|---|---|
| `location` | a point: `lat`, `lon`, `tst` (time), `acc`, `alt`, `vac`, `vel` (km/h, stored as m/s), `cog`, `batt` (%), `bs` (unknown, unplugged, charging, full), `SSID` as the Wi-Fi network, iOS's `motionactivities` as motion activity; `t`, `tid`, `topic`, `conn`, `BSSID`, `m`, `inregions`, `inrids`, `created_at`, `p` and the rest as they came |
| `transition` | an event `region_enter:<region>` or `region_leave:<region>` with its position |
| `lwt` | an event `lwt` |
| `waypoint`, `waypoints`, `status`, `cmd`, `card`, `beacon`, `steps` | acknowledged and left alone |
| `encrypted` | the reject log: Trail does not have the key — turn encryption off |

Trail answers every message it takes with `200 []`: no friends, cards or
commands go back to the phone.

Good to know:

- OwnTracks for iPhone **drops a message** that Trail answers with an error
  4xx — a wrong or replaced token, say — and shows an alert. After *Issue new
  token* scan the new setup code (or put the new token into *HTTP Headers*)
  right away. When a phone sends a
  long backlog faster than Trail takes it, Trail answers 503 instead, which
  OwnTracks retries.
- An empty request (OwnTracks sends one when a friend is removed) is
  acknowledged and logged as an upload of nothing.

To test the URL and token without the phone — a `status` message is
acknowledged and listed among the device's uploads, but adds no point:

```sh
curl -u phone:trl_... -H 'Content-Type: application/json' -d '{"_type":"status"}' \
  https://trail.example.com/api/owntracks
# []        (a wrong token: 401; plain http:// to a Trail with an https:// address: 403)
```

## Traccar Client

[Traccar Client](https://www.traccar.org/client/) for iPhone (App Store) and
Android (Google Play) sends Traccar's *OsmAnd format* to `<Trail>/api/osmand`:
one point per request, buffered while the phone is offline.

1. In Trail: Devices › Add device, choose **Traccar Client**.
2. Scan the setup code with the camera, or with Traccar Client's own scanner
   (Settings, the code icon at the top), or tap **Open in Traccar Client** on
   the phone. Traccar Client asks *Apply new configuration?*: OK. The link
   sets the server URL, the device identifier and Trail's tracking settings.
3. Turn **Continuous tracking** on and allow location access all the time.

By hand: Settings › **Server URL** `<Trail>/api/osmand`, **Device identifier**
the access token.

**The device identifier is the token.** Traccar Client sends nothing else to
tell phones apart, so Trail makes its token the identifier. The app shows it on
its main screen: keep screenshots to yourself. Traccar Client 10 sends it in
the request body; older Traccar Clients for Android put it in the URL, which
Trail's logs never show (a proxy in front of Trail may log URLs).

Recommended settings (the setup link sets the first six):

| Setting | Value |
|---|---|
| Location accuracy | Highest |
| Distance | 30 m |
| Interval | 30 s |
| Angle | 30° |
| Offline buffering | on |
| Stop detection | on |
| Stationary heartbeat | off |

With the highest accuracy, Traccar Client takes every fix and sends one after
30 m, 30 s or a 30° turn, whichever comes first; stop detection pauses it while
you stand still. It sends the speed in knots; Trail stores m/s. *Send SOS* is
stored as an `alarm` event, and a stationary heartbeat without a fix as a
`heartbeat` event that still updates the battery.

## OsmAnd

[OsmAnd](https://osmand.net) (Google Play, F-Droid) sends its *online
tracking* in the OsmAnd format, from Android only — OsmAnd for iPhone has no
online tracking — and only while it records a trip.

1. In Trail: Devices › Add device, choose **OsmAnd**, and copy the web address.
2. In OsmAnd: Menu › Plugins › **Trip recording** on. In its settings turn
   **Online tracking** on and paste the address as its **Web address**.
3. Start recording a trip.

The address carries OsmAnd's placeholders and the token (OsmAnd cannot send
headers):

```
<Trail>/api/osmand?token=trl_…&lat={0}&lon={1}&timestamp={2}&accuracy={3}&altitude={4}&speed={5}&bearing={6}&batt={11}
```

OsmAnd fills in the time in milliseconds, the accuracy (OsmAnd's own examples
call it *hdop*: Trail reads an `hdop` from OsmAnd as the accuracy too), the
speed in m/s and the battery in percent. Never add `{12}` or `{13}`: they are
your OsmAnd Cloud account's device and access token.

Recommended settings: *Tracking interval* 10 seconds, *Time buffer* as long as
it offers (OsmAnd drops points it could not send within it), *Logging interval*
5 seconds or less, and *Logging minimum displacement*, *accuracy* and *speed*
off.

## GPSLogger

[GPSLogger](https://gpslogger.app) for Android (F-Droid, GitHub releases)
sends every point it logs to a custom URL.

1. In Trail: Devices › Add device, choose **GPSLogger**.
2. In GPSLogger: Logging details › **Log to custom URL** on, then enter the URL,
   the HTTP header and the method Trail shows:

   ```
   URL:          <Trail>/api/osmand?lat=%LAT&lon=%LON&timestamp=%TIME&accuracy=%ACC&altitude=%ALT&speed=%SPD&bearing=%DIR&batt=%BATT&charge=%ISCHARGING
   HTTP Headers: Authorization: Bearer trl_…
   HTTP Method:  GET
   ```

3. Start logging.

`%TIME` is ISO 8601 in UTC and `%SPD` metres per second. Recommended
settings: *Discard offline locations* off (points logged offline are sent
later), *Logging interval* 15 s, *Distance filter* 25 m (no points while you
stand still), *Accuracy filter* 50 m, *Keep GPS on between fixes* on, location
provider GPS/GNSS. GPSLogger gives up on a point after three failed tries, so
keep Trail's address reachable from the phone.

## Other clients of the OsmAnd format

`/api/osmand` reads Traccar's OsmAnd protocol: `GET` or `POST`, the parameters
in the query or a form — `lat`, `lon` (or `location=lat,lon`), `timestamp`
(UNIX seconds, milliseconds or ISO 8601 with a zone), `speed`, `bearing` or
`heading`, `altitude`, `accuracy`, `batt`, `charge`, `valid`, `alarm`; the rest
is kept as it came — and Traccar Client 9's JSON, one location per request.
The token goes in `Authorization: Bearer`, as `?token=`, as the device
identifier `id`, or as the password of HTTP Basic. A request is at most 64 kB
and never compressed.

The speed's unit comes with the app chosen for the device, never with the
request: Traccar Client sends knots, OsmAnd and GPSLogger m/s. For another
client, choose the app whose unit it uses. [PhoneTrack for
Android](https://gitlab.com/eneiluj/phonetrack-android), for example, sends
m/s: add the device as GPSLogger and give PhoneTrack a *custom* log job with

```
<Trail>/api/osmand?lat=%LAT&lon=%LON&timestamp=%TIMESTAMP&altitude=%ALT&accuracy=%ACC&speed=%SPD&bearing=%DIR&batt=%BATT&token=trl_…
```

## When something does not arrive

The device's page lists every upload, newest first; Live shows each within
seconds.

- **401 Invalid access token**: the token is wrong or was replaced. Copy the
  current one (Issue new token shows a new setup).
- **403 This device is set up for … in Trail**: the token belongs to a device of
  another app. Each token works at its app's endpoint only; Issue new token can
  move the device to the app on the phone.
- **403 Uploads need HTTPS**: the phone posts to `http://`, but Trail gives
  phones an `https://` address, and then takes no token over plain HTTP — no
  bearer token, password, `?token=` or identifier. Use the address the setup
  shows.
- **415 Unsupported request body encoding**: the client compresses its
  uploads. None of these apps does; turn compression off.
- **429 / 503 Too many requests**: a phone sends a long backlog; it tries again
  and gets through.
- **Points arrive, but no transport modes**: too few points — OwnTracks in
  *Significant changes* on an iPhone, or a long interval. Use the recommended
  settings.
- **OsmAnd sends nothing**: it sends only while it records a trip, with
  online tracking on.
