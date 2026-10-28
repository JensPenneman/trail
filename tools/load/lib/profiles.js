/*
 * How the phones of a load test record and upload (docs/design/capacity.md
 * §2): the ten profiles of §2.2 with the rates that give its points and
 * uploads a day at 91.5 moving minutes, the three behaviours of §2.1 and the
 * hourly weights of the moving minutes. trail load-fleet assigns the profiles
 * (apps/api/src/load/fleetProfiles.ts); a test keeps the names equal.
 */

/**
 * @typedef {"overland" | "owntracks-ios" | "owntracks-android" | "traccar" | "osmand" | "gpslogger"} Encoder
 * @typedef {{ kind: "batch", intervalS: number, batchSize: number } | { kind: "each" }} UploadRule
 * @typedef {{
 *   app: "overland" | "owntracks" | "traccar" | "osmand" | "gpslogger",
 *   endpoint: "overland" | "owntracks" | "osmand",
 *   encoder: Encoder,
 *   movingPerMin: number,
 *   stillPerMin: number,
 *   tailPerDay: number,
 *   upload: UploadRule,
 *   accuracyM: { moving: number, still: number },
 *   visits: boolean,
 *   transitions: boolean,
 * }} Profile
 */

/** @type {Readonly<Record<string, Profile>>} */
export const profiles = {
  // send_interval 5m, min_time 5 s, min_distance 10 m, pauses: 1 100 points and 22 uploads a day
  "overland-balanced": {
    app: "overland",
    endpoint: "overland",
    encoder: "overland",
    movingPerMin: 10,
    stillPerMin: 0,
    tailPerDay: 185,
    upload: { kind: "batch", intervalS: 300, batchSize: 200 },
    accuracyM: { moving: 10, still: 30 },
    visits: true,
    transitions: false,
  },
  // 1 Hz while moving, still pauses: 6 570 points and 22 uploads a day
  "overland-balanced-plus": {
    app: "overland",
    endpoint: "overland",
    encoder: "overland",
    movingPerMin: 60,
    stillPerMin: 0,
    tailPerDay: 1080,
    upload: { kind: "batch", intervalS: 300, batchSize: 500 },
    accuracyM: { moving: 5, still: 10 },
    visits: true,
    transitions: false,
  },
  // 1 Hz, never pauses: iOS hands about one fix in two while the phone lies still (42 000 a day,
  // production 45 400), and the app sends every minute (1 440 uploads)
  "overland-high-resolution": {
    app: "overland",
    endpoint: "overland",
    encoder: "overland",
    movingPerMin: 60,
    stillPerMin: 27.07,
    tailPerDay: 0,
    upload: { kind: "batch", intervalS: 60, batchSize: 500 },
    accuracyM: { moving: 5, still: 12 },
    visits: true,
    transitions: false,
  },
  // significant changes: about 37 wake-ups a day decide when it sends, not its 10-minute interval
  "overland-battery-saver": {
    app: "overland",
    endpoint: "overland",
    encoder: "overland",
    movingPerMin: 0.4,
    stillPerMin: 0.084,
    tailPerDay: 0,
    upload: { kind: "batch", intervalS: 2340, batchSize: 200 },
    accuracyM: { moving: 65, still: 100 },
    visits: true,
    transitions: false,
  },
  // move mode: every 30 m and at least every 60 s
  "owntracks-ios-move": {
    app: "owntracks",
    endpoint: "owntracks",
    encoder: "owntracks-ios",
    movingPerMin: 12,
    stillPerMin: 1,
    tailPerDay: 0,
    upload: { kind: "each" },
    accuracyM: { moving: 5, still: 15 },
    visits: false,
    transitions: true,
  },
  // significant changes
  "owntracks-ios-significant": {
    app: "owntracks",
    endpoint: "owntracks",
    encoder: "owntracks-ios",
    movingPerMin: 0.4,
    stillPerMin: 0.05,
    tailPerDay: 0,
    upload: { kind: "each" },
    accuracyM: { moving: 65, still: 100 },
    visits: false,
    transitions: true,
  },
  // 15 s, 25 m, high accuracy
  "owntracks-android": {
    app: "owntracks",
    endpoint: "owntracks",
    encoder: "owntracks-android",
    movingPerMin: 3,
    stillPerMin: 0,
    tailPerDay: 0,
    upload: { kind: "each" },
    accuracyM: { moving: 12, still: 20 },
    visits: false,
    transitions: false,
  },
  // 30 s, 30 m, 30°, stop detection
  traccar: {
    app: "traccar",
    endpoint: "osmand",
    encoder: "traccar",
    movingPerMin: 2,
    stillPerMin: 0,
    tailPerDay: 0,
    upload: { kind: "each" },
    accuracyM: { moving: 5, still: 10 },
    visits: false,
    transitions: false,
  },
  // live tracking every 5 s while a trip is recorded
  osmand: {
    app: "osmand",
    endpoint: "osmand",
    encoder: "osmand",
    movingPerMin: 12,
    stillPerMin: 0,
    tailPerDay: 0,
    upload: { kind: "each" },
    accuracyM: { moving: 6, still: 10 },
    visits: false,
    transitions: false,
  },
  // every 60 s, no distance filter
  gpslogger: {
    app: "gpslogger",
    endpoint: "osmand",
    encoder: "gpslogger",
    movingPerMin: 1,
    stillPerMin: 1,
    tailPerDay: 0,
    upload: { kind: "each" },
    accuracyM: { moving: 8, still: 15 },
    visits: false,
    transitions: false,
  },
};

/** The SSE probe's phone (sse-probe.mjs): OwnTracks for iOS, one marked point at a time. */
export const probeProfile = "probe";

/**
 * The behaviours of §2.1: share of people, moving minutes a day, the length of
 * one move, and how they travel.
 * @type {Readonly<Record<"commuter" | "driver" | "stationary", { share: number, movingMinutes: number, moveMinutes: readonly [number, number], modes: readonly (readonly [Mode, number])[] }>>}
 */
export const behaviours = {
  commuter: {
    share: 0.5,
    movingMinutes: 90,
    moveMinutes: [15, 35],
    modes: [
      ["driving", 0.6],
      ["cycling", 0.25],
      ["walking", 0.15],
    ],
  },
  driver: {
    share: 0.15,
    movingMinutes: 240,
    moveMinutes: [20, 40],
    modes: [["driving", 1]],
  },
  stationary: {
    share: 0.35,
    movingMinutes: 30,
    moveMinutes: [10, 20],
    modes: [
      ["walking", 0.7],
      ["driving", 0.3],
    ],
  },
};

/** @typedef {"walking" | "cycling" | "driving"} Mode */

/** Typical speed of a mode in m/s, and what CoreMotion and the Android activity APIs call it. */
export const modes = {
  walking: { speedMs: 1.4, motion: "walking", android: "on_foot" },
  cycling: { speedMs: 5, motion: "cycling", android: "on_bicycle" },
  driving: { speedMs: 13, motion: "automotive", android: "in_vehicle" },
};

/**
 * The hourly weights of the moving minutes (§2.1), scaled to a mean of 1: the
 * share of people moving at hour h is `weights[h] × (minutes a day / 1440)`.
 */
export const hourlyWeights = (() => {
  const raw = [
    0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.6, 2.2, 2.6, 1.4, 1.0, 1.0, 1.3, 1.1, 1.0, 1.2, 1.9, 2.5, 2.0,
    1.2, 0.8, 0.6, 0.4, 0.2,
  ];
  const sum = raw.reduce((total, weight) => total + weight, 0);
  return raw.map((weight) => (weight * 24) / sum);
})();
