import type { PhonePlatform } from "./deviceApp";

/** What OwnTracks needs to post to Trail in HTTP mode. */
export interface OwnTracksConnection {
  /** The endpoint, `<ingest base>/api/owntracks`. */
  url: string;
  /** Any user name works: Trail reads the token only. OwnTracks names the device's topic with it. */
  username: string;
  /** The device token: the HTTP Basic password on Android, a bearer token in a header on iPhones. */
  token: string;
  deviceId: string;
  /** Up to two letters or digits, shown for the device in OwnTracks. */
  trackerId: string;
}

/**
 * The setups Trail offers: one per platform, and on iPhones a second one with
 * the battery-saving tracking (`iosSignificant`).
 */
export const owntracksProfiles = ["ios", "iosSignificant", "android"] as const;
export type OwnTracksProfile = (typeof owntracksProfiles)[number];

/*
 * Per profile, because the apps read the same keys differently. On iOS,
 * "move" monitoring (2) keeps GPS on and reports a point after every
 * `locatorDisplacement` metres and at least every `locatorInterval` seconds:
 * the detail transport inference needs, at a high battery cost. "Significant
 * changes" (1) leaves the fixes to iOS — a point every few hundred metres or
 * every few minutes — for very little battery; it keeps Trail's move values for
 * when the person switches to Move in the app. Android's move mode reports every
 * `moveModeLocatorInterval` seconds whether the phone moves or not, so Android
 * gets significant monitoring (1) with the high-accuracy locator, a short
 * interval and a small displacement: a point every 15 to 30 s while moving,
 * none while still. The locator goes by name: Android reads a number as a
 * position in its own list, which does not match its documented values.
 * Points every 10–30 s, at most ~30 m apart, are what transport inference
 * needs (docs/transport.md).
 */
export const owntracksTracking = {
  ios: { monitoring: 2, locatorDisplacement: 30, locatorInterval: 60 },
  iosSignificant: { monitoring: 1, locatorDisplacement: 30, locatorInterval: 60 },
  android: {
    monitoring: 1,
    locatorDisplacement: 25,
    locatorInterval: 15,
    moveModeLocatorInterval: 15,
    locatorPriority: "HighAccuracy",
    pegLocatorFastestIntervalToInterval: true,
  },
} as const satisfies Record<OwnTracksProfile, Record<string, number | string | boolean>>;

/** The phone a profile is for. */
export const platformOfProfile = (profile: OwnTracksProfile): PhonePlatform =>
  profile === "android" ? "android" : "ios";

/**
 * How each app sends the token. Android sends HTTP Basic only, and only with
 * a user name and a password. OwnTracks for iOS sends the lines of its "HTTP
 * Headers" setting (`Name: value`, lines separated by a literal `\n`) with every
 * request, so its link sends the token as a bearer token and leaves
 * authentication off.
 */
const credentialsFor = (
  connection: OwnTracksConnection,
  profile: OwnTracksProfile,
): Record<string, string | boolean> =>
  platformOfProfile(profile) === "android"
    ? { auth: true, username: connection.username, password: connection.token }
    : {
        auth: false,
        username: connection.username,
        httpHeaders: `Authorization: Bearer ${connection.token}`,
      };

/** The configuration message (`_type: configuration`, an `.otrc` file's content) for one profile. */
export function owntracksConfiguration(
  connection: OwnTracksConnection,
  profile: OwnTracksProfile,
): Record<string, string | number | boolean> {
  return {
    _type: "configuration",
    mode: 3,
    url: connection.url,
    ...credentialsFor(connection, profile),
    deviceId: connection.deviceId,
    tid: connection.trackerId,
    // Battery, connection and (on iPhones) motion activity come only with extended data.
    extendedData: true,
    ...owntracksTracking[profile],
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
  profile: OwnTracksProfile,
): string {
  const json = JSON.stringify(owntracksConfiguration(connection, profile));
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
