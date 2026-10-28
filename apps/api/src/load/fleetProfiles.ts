import type { DeviceApp } from "@trail/contracts/deviceApp";

/**
 * The phones of a load test (docs/design/capacity.md §2.2): a tracking app and
 * its setting. How each one records and uploads lives with the harness
 * (tools/load/lib/profiles.js); the names link the two, and a test of the
 * harness keeps both lists equal.
 */
export const fleetProfiles = [
  { name: "overland-balanced", app: "overland" },
  { name: "overland-balanced-plus", app: "overland" },
  { name: "overland-high-resolution", app: "overland" },
  { name: "overland-battery-saver", app: "overland" },
  { name: "owntracks-ios-move", app: "owntracks" },
  { name: "owntracks-ios-significant", app: "owntracks" },
  { name: "owntracks-android", app: "owntracks" },
  { name: "traccar", app: "traccar" },
  { name: "osmand", app: "osmand" },
  { name: "gpslogger", app: "gpslogger" },
] as const satisfies readonly { name: string; app: DeviceApp }[];

export type FleetProfileName = (typeof fleetProfiles)[number]["name"];

/**
 * How many of a thousand phones run each profile: as people would choose
 * (`default`, the design's scenario A) or with the presets steered
 * (`steered`, scenario B: high resolution for ten phones, balanced-plus for
 * the forty others that would have chosen it).
 */
export const fleetMixes = {
  default: {
    "overland-balanced": 250,
    "overland-balanced-plus": 50,
    "overland-high-resolution": 50,
    "overland-battery-saver": 50,
    "owntracks-ios-move": 50,
    "owntracks-ios-significant": 100,
    "owntracks-android": 100,
    traccar: 200,
    osmand: 50,
    gpslogger: 100,
  },
  steered: {
    "overland-balanced": 250,
    "overland-balanced-plus": 90,
    "overland-high-resolution": 10,
    "overland-battery-saver": 50,
    "owntracks-ios-move": 50,
    "owntracks-ios-significant": 100,
    "owntracks-android": 100,
    traccar: 200,
    osmand: 50,
    gpslogger: 100,
  },
} as const satisfies Record<string, Record<FleetProfileName, number>>;

export type FleetMix = keyof typeof fleetMixes;

export const isFleetMix = (value: string): value is FleetMix => Object.hasOwn(fleetMixes, value);
