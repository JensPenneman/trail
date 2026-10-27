import { z } from "zod";

/**
 * The apps a device records with (docs/trackers.md). Each speaks one of
 * Trail's ingest protocols (docs/architecture.md §6): the app decides which
 * endpoint takes the device's token and, for the OsmAnd format, the units of
 * what it sends — never a guess at request time.
 */
export const deviceApps = ["overland", "owntracks", "traccar", "osmand", "gpslogger"] as const;
export const deviceAppSchema = z.enum(deviceApps);
export type DeviceApp = z.infer<typeof deviceAppSchema>;

/** The protocols of the ingest endpoints: `/api/overland`, `/api/owntracks`, `/api/osmand`. */
export const ingestProtocols = ["overland", "owntracks", "osmand"] as const;
export type IngestProtocol = (typeof ingestProtocols)[number];

export const phonePlatforms = ["ios", "android"] as const;
export type PhonePlatform = (typeof phonePlatforms)[number];

export interface DeviceAppInfo {
  /** The app's name as its stores list it. */
  name: string;
  /** Where it runs (OsmAnd's iOS app has no online tracking). */
  platforms: readonly PhonePlatform[];
  protocol: IngestProtocol;
  homepage: string;
  /** One line for choosing it. */
  summary: string;
}

export const deviceAppInfo: Readonly<Record<DeviceApp, DeviceAppInfo>> = {
  overland: {
    name: "Overland",
    platforms: ["ios"],
    protocol: "overland",
    homepage: "https://github.com/aaronpk/Overland-iOS",
    summary:
      "Batches of points with motion activity, visits and trips; Trail can send it settings presets.",
  },
  owntracks: {
    name: "OwnTracks",
    platforms: ["ios", "android"],
    protocol: "owntracks",
    homepage: "https://owntracks.org",
    summary: "One point per request; sets itself up from a link. Motion activity on iPhones.",
  },
  traccar: {
    name: "Traccar Client",
    platforms: ["ios", "android"],
    protocol: "osmand",
    homepage: "https://www.traccar.org/client/",
    summary: "One point per request, buffered while offline; sets itself up from a link.",
  },
  osmand: {
    name: "OsmAnd",
    platforms: ["android"],
    protocol: "osmand",
    homepage: "https://osmand.net",
    summary: "The map app’s online tracking, while a trip is being recorded.",
  },
  gpslogger: {
    name: "GPSLogger",
    platforms: ["android"],
    protocol: "osmand",
    homepage: "https://gpslogger.app",
    summary: "A light logger that sends every point to a custom URL.",
  },
};

/** The apps whose devices an ingest endpoint takes. */
export function appsSpeaking(protocol: IngestProtocol): DeviceApp[] {
  return deviceApps.filter((app) => deviceAppInfo[app].protocol === protocol);
}

const platformNames: Readonly<Record<PhonePlatform, string>> = { ios: "iOS", android: "Android" };

/** "iOS", "Android" or "iOS and Android". */
export function platformsLabel(platforms: readonly PhonePlatform[]): string {
  return platforms.map((platform) => platformNames[platform]).join(" and ");
}
