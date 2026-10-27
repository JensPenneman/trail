import type { PhonePlatform } from "./deviceApp";

/** What OwnTracks needs to post to Trail in HTTP mode. */
export interface OwnTracksConnection {
  /** The endpoint, `<ingest base>/api/owntracks`. */
  url: string;
  /** Any user name works: Trail reads the password only. */
  username: string;
  /** The device token, sent with HTTP Basic authentication. */
  password: string;
  deviceId: string;
  /** Up to two letters or digits, shown for the device in OwnTracks. */
  trackerId: string;
}

/*
 * Per platform, because the apps read the same keys differently. On iOS,
 * "move" monitoring (2) keeps GPS on and reports a point after every
 * `locatorDisplacement` metres and every `locatorInterval` seconds. Android's
 * move mode reports every `moveModeLocatorInterval` seconds whether the phone
 * moves or not, so Android gets "significant" monitoring (1) with the
 * high-accuracy locator (`locatorPriority` 0), a short interval and a small
 * displacement: a point every 15 to 30 s while moving, none while still.
 * Points every 10–30 s, at most ~30 m apart, are what transport inference
 * needs (docs/transport.md).
 */
export const owntracksTracking = {
  ios: { monitoring: 2, locatorDisplacement: 30, locatorInterval: 60 },
  android: {
    monitoring: 1,
    locatorDisplacement: 25,
    locatorInterval: 15,
    moveModeLocatorInterval: 15,
    locatorPriority: 0,
    pegLocatorFastestIntervalToInterval: true,
  },
} as const satisfies Record<PhonePlatform, Record<string, number | boolean>>;

/** The configuration message (`_type: configuration`, an `.otrc` file's content) for one platform. */
export function owntracksConfiguration(
  connection: OwnTracksConnection,
  platform: PhonePlatform,
): Record<string, string | number | boolean> {
  return {
    _type: "configuration",
    mode: 3,
    url: connection.url,
    auth: true,
    username: connection.username,
    password: connection.password,
    deviceId: connection.deviceId,
    tid: connection.trackerId,
    // Battery, connection and (on iPhones) motion activity come only with extended data.
    extendedData: true,
    ...owntracksTracking[platform],
  };
}

const base64 = (text: string): string => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/**
 * OwnTracks' configuration link: `owntracks:///config?inline=` and the
 * configuration in base64, which both apps import once "Allow external
 * configuration" is on. The base64 is percent-encoded: Android decodes the
 * query with `URLDecoder`, which turns a bare `+` into a space.
 */
export function owntracksSetupUrl(
  connection: OwnTracksConnection,
  platform: PhonePlatform,
): string {
  const json = JSON.stringify(owntracksConfiguration(connection, platform));
  return `owntracks:///config?inline=${encodeURIComponent(base64(json))}`;
}

/** Initials of the device's name ("Jens’s Pixel 8" → "JP"), as OwnTracks takes up to two letters or digits. */
export function trackerIdFor(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
  const [first = "", second] = words;
  const initials =
    second === undefined ? first.slice(0, 2) : `${first.charAt(0)}${second.charAt(0)}`;
  return initials.length > 0 ? initials.toUpperCase() : "TR";
}
