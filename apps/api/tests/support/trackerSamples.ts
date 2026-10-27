/*
 * Uploads as the tracking apps send them, built from the apps' sources (the
 * versions current on 2026-10-27), so the tests read what phones really post:
 *
 * - OwnTracks Android 2.5.9: `MessageLocation` serialised by `Parser` (keys
 *   with default values are left out), `fromLocation` and the extended data of
 *   `LocationProcessor.publishLocationMessage`; `HttpMessageProcessorEndpoint`
 *   adds `topic` and sends `Owntracks-Android/gms/<version>`.
 * - OwnTracks iOS 27.1.2: `OwnTracking.waypointAsJSON` (`ssid`/`bssid` in
 *   lower case, `motionactivities`, `p`), `Connection.sendData` adds `topic`;
 *   transitions from `OwnTracksAppDelegate`.
 * - Traccar Client 10.2 (traccar-client-sdk 1.1.3 `HttpUploader`): a form with
 *   id, lat, lon, timestamp (s), accuracy, altitude, speed (knots), bearing,
 *   batt, charge — and only id, timestamp and battery in a heartbeat without a fix.
 * - Traccar Client for Android 7.9 (`ProtocolFormatter`): the same as a query
 *   on a POST without body; accuracy 0.0 for GPS fixes, `charge` only when true.
 * - Traccar Client 9.7 (`Preferences._locationTemplate`): JSON with
 *   `device_id`, `location.coords` in m/s, `battery.level` 0..1, `activity`.
 * - OsmAnd for Android (`LiveSender.getLiveUrl`): Trail's template filled in —
 *   the time in milliseconds, the accuracy as {3}, speed in m/s.
 * - GPSLogger 137 (`CustomUrlManager.getFormattedTextblock`): Trail's template
 *   with %TIME as ISO 8601 with milliseconds, %SPD m/s, %BATT and %ISCHARGING.
 */

/** UNIX seconds of a date. */
export const seconds = (date: Date): number => Math.floor(date.getTime() / 1000);

/** `Owntracks-Android/<flavour>/<version code>`, as `HttpMessageProcessorEndpoint` sets it. */
export const owntracksAndroidUserAgent = "Owntracks-Android/gms/420509000";

/** OwnTracks for Android, extended data on, in move mode while cycling. */
export function owntracksAndroidLocation(at: Date, overrides: Record<string, unknown> = {}) {
  return {
    _type: "location",
    _id: "a1b2c3d4",
    created_at: seconds(at) + 2,
    t: "u",
    batt: 76,
    bs: 1,
    acc: 12,
    vac: 3,
    lat: 51.0543,
    lon: 3.7174,
    alt: 45,
    vel: 18,
    cog: 271,
    tst: seconds(at),
    m: 2,
    conn: "w",
    inregions: ["Home"],
    BSSID: "aa:bb:cc:dd:ee:ff",
    SSID: "Home Wi-Fi",
    tid: "P8",
    source: "fused",
    topic: "owntracks/pixel-8-k3f9/pixel-8-k3f9",
    ...overrides,
  };
}

/** OwnTracks for iOS, extended data on, walking. */
export function owntracksIosLocation(at: Date, overrides: Record<string, unknown> = {}) {
  return {
    _type: "location",
    t: "t",
    lat: 51.05012,
    lon: 3.722845,
    tst: seconds(at),
    acc: 5,
    alt: 12,
    vac: 4,
    vel: 5,
    cog: 87,
    p: 101.325,
    motionactivities: ["walking"],
    conn: "m",
    ssid: "Office",
    bssid: "11:22:33:44:55:66",
    m: 2,
    tid: "JP",
    batt: 55,
    bs: 2,
    inregions: [],
    inrids: [],
    topic: "owntracks/jens/iphone",
    ...overrides,
  };
}

/** OwnTracks for iOS entering or leaving a region. */
export function owntracksTransition(at: Date, event: "enter" | "leave", region = "Home") {
  return {
    _type: "transition",
    lat: 51.0543,
    lon: 3.7174,
    tst: seconds(at),
    acc: 10,
    tid: "JP",
    event,
    t: "c",
    desc: region,
    wtst: 1_700_000_000,
    rid: `rid-${region.toLowerCase()}`,
    topic: "owntracks/jens/iphone/event",
  };
}

/** Traccar Client 10's form (traccar-client-sdk `HttpUploader`), speed in knots. */
export function traccarForm(token: string, at: Date, overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    id: token,
    lat: "51.0543",
    lon: "3.7174",
    timestamp: String(seconds(at)),
    accuracy: "4.8",
    altitude: "11.5",
    speed: "9.72",
    bearing: "92.5",
    batt: "81",
    charge: "false",
    ...overrides,
  }).toString();
}

/** OsmAnd's online tracking with Trail's template ({2} is milliseconds, {3} the accuracy). */
export function osmandQuery(token: string, at: Date, overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    token,
    lat: "51.05430",
    lon: "3.71740",
    timestamp: String(at.getTime()),
    accuracy: "6.0",
    altitude: "9.0",
    speed: "1.5",
    bearing: "180.0",
    batt: "64",
    ...overrides,
  }).toString();
}

/** GPSLogger's custom URL with Trail's template; the token travels in a header. */
export function gpsloggerQuery(at: Date, overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    lat: "51.054321",
    lon: "3.717401",
    timestamp: at.toISOString(),
    accuracy: "8.0",
    altitude: "13.0",
    speed: "12.5",
    bearing: "45.0",
    batt: "92.0",
    charge: "true",
    ...overrides,
  }).toString();
}

/** Traccar Client 9's JSON (Transistorsoft's location template), speed in m/s. */
export function traccarJson(token: string, at: Date) {
  return {
    location: {
      timestamp: at.toISOString(),
      coords: {
        latitude: 51.0543,
        longitude: 3.7174,
        accuracy: 7.5,
        speed: 13.9,
        heading: -1,
        altitude: 10.2,
      },
      is_moving: true,
      odometer: 18_420,
      event: "",
      battery: { level: 0.42, is_charging: true },
      activity: { type: "in_vehicle" },
      extras: {},
      _: `&id=${token}&lat=51.0543&lon=3.7174&timestamp=${at.toISOString()}&`,
    },
    device_id: token,
  };
}
