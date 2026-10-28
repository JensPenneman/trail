/*
 * What each app sends (docs/architecture.md §6), as the integration tests'
 * samples have it (apps/api/tests/support/trackerSamples.ts, the fixture of
 * tests/fixtures/overland-batch.json): Overland's batches with its tracking
 * stats, `current`, `trip` and visits; OwnTracks' messages from iOS and
 * Android with their extended data; Traccar Client 10's form; OsmAnd's and
 * GPSLogger's addresses with Trail's templates. Pure functions: k6 sends what
 * they return, the probe too.
 */

/**
 * @typedef {import("./schedule.js").Point} Point
 * @typedef {{
 *   method: "GET" | "POST",
 *   path: string,
 *   body: string | null,
 *   headers: Record<string, string>,
 *   points: number,
 * }} IngestRequest
 */

const userAgents = {
  overland: "Overland/2025.9 CFNetwork Darwin",
  "owntracks-ios": "OwnTracks/27.1.2 CFNetwork/3826.500 Darwin/25.0.0",
  "owntracks-android": "Owntracks-Android/gms/420509000",
  traccar: "Dart/3.8 (dart:io)",
  osmand: "Dalvik/2.1.0 (Linux; U; Android 15; Pixel 8 Build/AP4A)",
  gpslogger: "okhttp/4.12.0",
};

/**
 * Overland's timestamps: whole seconds, UTC.
 * @param {number} epochS
 */
const overlandTime = (epochS) => new Date(epochS * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** @param {number | null} value */
const orUnknown = (value) => (value === null ? -1 : value);

/**
 * Overland's trip modes for the harness's modes.
 * @param {string | null} mode
 */
const tripMode = (mode) =>
  mode === "cycling"
    ? "bicycle"
    : mode === "driving"
      ? "car"
      : mode === "walking"
        ? "walking"
        : "unknown";

/**
 * One point as an Overland feature, tracking stats included (604 bytes for the fixture's).
 * @param {Point} point
 * @param {number} epochS
 * @param {{ deviceKey: string, uniqueId: string, desiredAccuracy: number, inPayload: number }} phone
 */
function overlandFeature(point, epochS, phone) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    properties: {
      timestamp: overlandTime(epochS + point.t),
      altitude: point.altitudeM,
      speed: point.moving ? orUnknown(point.speedMs) : 0,
      course: orUnknown(point.course),
      horizontal_accuracy: point.accuracyM,
      vertical_accuracy: 3,
      speed_accuracy: point.moving ? 0.6 : -1,
      course_accuracy: point.moving ? 9.5 : -1,
      motion: point.motion,
      pauses: false,
      activity: "other",
      desired_accuracy: phone.desiredAccuracy,
      deferred: 0,
      significant_change: "disabled",
      locations_in_payload: phone.inPayload,
      unique_id: phone.uniqueId,
      device_id: phone.deviceKey,
      wifi: point.moving ? "" : "Home-5G",
      battery_state: "unplugged",
      battery_level: point.battery,
    },
  };
}

/**
 * An Overland batch (`POST /api/overland`): the points, iOS's visits, the
 * newest position as `current` and, while moving, the trip in progress.
 * @param {string} token
 * @param {readonly Point[]} points
 * @param {number} epochS
 * @param {{
 *   deviceKey: string, uniqueId: string, desiredAccuracy: number,
 *   visits: readonly { at: number, arrived: number, departed: number | null, place: { lon: number, lat: number } }[],
 *   trip: { mode: string, startedAt: number, distanceM: number, start: { lon: number, lat: number } } | null,
 * }} phone
 * @returns {IngestRequest}
 */
export function overlandBatch(token, points, epochS, phone) {
  const features = points.map((point) =>
    overlandFeature(point, epochS, { ...phone, inPayload: points.length }),
  );
  const visits = phone.visits.map((visit) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [visit.place.lon, visit.place.lat] },
    properties: {
      action: "visit",
      timestamp: overlandTime(epochS + visit.at),
      arrival_date: overlandTime(epochS + visit.arrived),
      departure_date: visit.departed === null ? null : overlandTime(epochS + visit.departed),
      horizontal_accuracy: 35,
      device_id: phone.deviceKey,
      wifi: "",
      battery_state: "unplugged",
      battery_level: points.at(-1)?.battery ?? 0.8,
    },
  }));
  const newest = points.at(-1);
  /** @type {Record<string, unknown>} */
  const body = { locations: [...features, ...visits] };
  if (newest !== undefined) {
    body["current"] = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [newest.lon, newest.lat] },
      properties: {
        timestamp: overlandTime(epochS + newest.t),
        altitude: newest.altitudeM,
        speed: orUnknown(newest.speedMs),
        course: orUnknown(newest.course),
        horizontal_accuracy: newest.accuracyM,
        vertical_accuracy: 3,
        motion: newest.motion,
        device_id: phone.deviceKey,
        wifi: "",
        battery_state: "unplugged",
        battery_level: newest.battery,
      },
    };
  }
  if (phone.trip !== null && newest !== undefined) {
    const location = (
      /** @type {{ lon: number, lat: number }} */ place,
      /** @type {number} */ t,
    ) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [place.lon, place.lat] },
      properties: {
        timestamp: overlandTime(epochS + t),
        horizontal_accuracy: 8,
        altitude: 10,
        speed: 0,
        course: -1,
      },
    });
    body["trip"] = {
      mode: tripMode(phone.trip.mode),
      start: overlandTime(epochS + phone.trip.startedAt),
      distance: Math.round(phone.trip.distanceM * 10) / 10,
      start_location: location(phone.trip.start, phone.trip.startedAt),
      current_location: location(newest, newest.t),
    };
  }
  return {
    method: "POST",
    path: "/api/overland",
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": userAgents.overland,
    },
    points: points.length,
  };
}

/**
 * The person's initials OwnTracks shows on the map.
 * @param {string} deviceKey
 */
const trackerId = (deviceKey) =>
  deviceKey
    .replace(/[^a-z0-9]/gi, "")
    .slice(-2)
    .toUpperCase();

/**
 * One OwnTracks message (`POST /api/owntracks`): a location as OwnTracks for
 * iOS or Android sends it, with the token as the iPhone's bearer header or
 * Android's HTTP Basic password.
 * @param {"ios" | "android"} platform
 * @param {string} token
 * @param {Point} point
 * @param {number} epochS
 * @param {string} deviceKey
 * @returns {IngestRequest}
 */
export function owntracksLocation(platform, token, point, epochS, deviceKey) {
  const tst = epochS + point.t;
  const common = {
    _type: "location",
    lat: point.lat,
    lon: point.lon,
    tst,
    acc: point.accuracyM,
    alt: point.altitudeM,
    vac: 4,
    vel: Math.round((point.speedMs ?? 0) * 3.6),
    batt: Math.round(point.battery * 100),
    bs: 1,
    tid: trackerId(deviceKey),
    topic: `owntracks/${deviceKey}/${deviceKey}`,
  };
  const message =
    platform === "ios"
      ? {
          ...common,
          ...(point.moving ? {} : { t: "t" }),
          cog: point.course ?? -1,
          p: 101.325,
          motionactivities: point.moving ? point.motion : ["stationary"],
          conn: point.moving ? "m" : "w",
          ...(point.moving ? {} : { ssid: "Home-5G", bssid: "11:22:33:44:55:66" }),
          m: 2,
          inregions: point.moving ? [] : ["Home"],
          inrids: point.moving ? [] : ["rid-home"],
        }
      : {
          ...common,
          _id: (tst % 0xffffffff).toString(16).padStart(8, "0"),
          created_at: tst + 1,
          ...(point.course === null ? {} : { cog: point.course }),
          m: 1,
          conn: point.moving ? "m" : "w",
          ...(point.moving ? {} : { SSID: "Home-5G", BSSID: "aa:bb:cc:dd:ee:ff" }),
          source: "fused",
        };
  return {
    method: "POST",
    path: "/api/owntracks",
    body: JSON.stringify(message),
    headers: {
      Authorization:
        platform === "ios" ? `Bearer ${token}` : `Basic ${base64(`${deviceKey}:${token}`)}`,
      "Content-Type": "application/json",
      "User-Agent": userAgents[platform === "ios" ? "owntracks-ios" : "owntracks-android"],
      ...(platform === "android" ? { "X-Limit-U": deviceKey, "X-Limit-D": deviceKey } : {}),
    },
    points: 1,
  };
}

/**
 * OwnTracks for iOS leaving or reaching its home region (`transition`).
 * @param {string} token
 * @param {{ lon: number, lat: number }} place
 * @param {number} epochS
 * @param {number} t
 * @param {"enter" | "leave"} event
 * @param {string} deviceKey
 * @returns {IngestRequest}
 */
export function owntracksTransition(token, place, epochS, t, event, deviceKey) {
  return {
    method: "POST",
    path: "/api/owntracks",
    body: JSON.stringify({
      _type: "transition",
      lat: Math.round(place.lat * 1e6) / 1e6,
      lon: Math.round(place.lon * 1e6) / 1e6,
      tst: epochS + t,
      acc: 10,
      tid: trackerId(deviceKey),
      event,
      t: "c",
      desc: "Home",
      wtst: epochS - 86_400,
      rid: "rid-home",
      topic: `owntracks/${deviceKey}/${deviceKey}/event`,
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": userAgents["owntracks-ios"],
    },
    points: 0,
  };
}

/**
 * Parameters as a form or query: `encodeURIComponent` for every value, as `URLSearchParams` would.
 * @param {Record<string, string>} values
 */
function formOf(values) {
  return Object.entries(values)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

/** @param {number} value @param {number} digits */
const fixed = (value, digits) => value.toFixed(digits);

/**
 * Traccar Client 10's form (`POST /api/osmand`): the token as `id`, speed in knots.
 * @param {string} token
 * @param {Point} point
 * @param {number} epochS
 * @returns {IngestRequest}
 */
export function traccarForm(token, point, epochS) {
  return {
    method: "POST",
    path: "/api/osmand",
    body: formOf({
      id: token,
      lat: fixed(point.lat, 7),
      lon: fixed(point.lon, 7),
      timestamp: String(epochS + point.t),
      accuracy: fixed(point.accuracyM, 1),
      altitude: fixed(point.altitudeM, 1),
      speed: fixed((point.speedMs ?? 0) / 0.514444, 2),
      bearing: fixed(point.course ?? 0, 1),
      batt: String(Math.round(point.battery * 100)),
      charge: "false",
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgents.traccar,
    },
    points: 1,
  };
}

/**
 * OsmAnd's online tracking (`GET /api/osmand?token=…`): Trail's template filled in, the time in ms.
 * @param {string} token
 * @param {Point} point
 * @param {number} epochS
 * @returns {IngestRequest}
 */
export function osmandQuery(token, point, epochS) {
  const query = formOf({
    token,
    lat: fixed(point.lat, 5),
    lon: fixed(point.lon, 5),
    timestamp: String((epochS + point.t) * 1000),
    accuracy: fixed(point.accuracyM, 1),
    altitude: fixed(point.altitudeM, 1),
    speed: fixed(point.speedMs ?? 0, 1),
    bearing: fixed(point.course ?? 0, 1),
    batt: String(Math.round(point.battery * 100)),
  });
  return {
    method: "GET",
    path: `/api/osmand?${query}`,
    body: null,
    headers: { "User-Agent": userAgents.osmand },
    points: 1,
  };
}

/**
 * GPSLogger's custom URL (`GET /api/osmand?lat=…`), the token in a bearer header.
 * @param {string} token
 * @param {Point} point
 * @param {number} epochS
 * @returns {IngestRequest}
 */
export function gpsloggerQuery(token, point, epochS) {
  const query = formOf({
    lat: fixed(point.lat, 6),
    lon: fixed(point.lon, 6),
    timestamp: new Date((epochS + point.t) * 1000).toISOString(),
    accuracy: fixed(point.accuracyM, 1),
    altitude: fixed(point.altitudeM, 1),
    speed: fixed(point.speedMs ?? 0, 1),
    bearing: fixed(point.course ?? 0, 1),
    batt: fixed(point.battery * 100, 1),
    charge: "false",
  });
  return {
    method: "GET",
    path: `/api/osmand?${query}`,
    body: null,
    headers: { Authorization: `Bearer ${token}`, "User-Agent": userAgents.gpslogger },
    points: 1,
  };
}

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 of ASCII text (k6 has its own encoding module; this keeps the encoders importable anywhere).
 * @param {string} text
 */
export function base64(text) {
  let output = "";
  for (let index = 0; index < text.length; index += 3) {
    const a = text.charCodeAt(index);
    const b = index + 1 < text.length ? text.charCodeAt(index + 1) : Number.NaN;
    const c = index + 2 < text.length ? text.charCodeAt(index + 2) : Number.NaN;
    const triple = (a << 16) | ((b || 0) << 8) | (c || 0);
    output += base64Alphabet[(triple >> 18) & 63] ?? "";
    output += base64Alphabet[(triple >> 12) & 63] ?? "";
    output += Number.isNaN(b) ? "=" : (base64Alphabet[(triple >> 6) & 63] ?? "");
    output += Number.isNaN(c) ? "=" : (base64Alphabet[triple & 63] ?? "");
  }
  return output;
}
