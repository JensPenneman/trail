import { describe, expect, it } from "vitest";
import { createDeviceRequestSchema, deviceCredentialsSchema } from "../src/device";
import {
  appsSpeaking,
  deviceAppInfo,
  deviceApps,
  ingestProtocols,
  platformsLabel,
} from "../src/deviceApp";
import { gpsloggerHeaders, gpsloggerUrl } from "../src/gpsloggerSetup";
import { osmandUrlTemplate } from "../src/osmandSetup";
import {
  type OwnTracksConnection,
  owntracksConfiguration,
  owntracksSetupUrl,
  trackerIdFor,
} from "../src/owntracksSetup";
import { traccarSetupUrl } from "../src/traccarSetup";

const token = "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS";

describe("device apps", () => {
  it("sends every app to one protocol and speaks of platforms in words", () => {
    expect(appsSpeaking("overland")).toEqual(["overland"]);
    expect(appsSpeaking("owntracks")).toEqual(["owntracks"]);
    expect(appsSpeaking("osmand")).toEqual(["traccar", "osmand", "gpslogger"]);
    expect(ingestProtocols.flatMap(appsSpeaking).sort()).toEqual([...deviceApps].sort());
    expect(platformsLabel(deviceAppInfo.overland.platforms)).toBe("iOS");
    expect(platformsLabel(deviceAppInfo.owntracks.platforms)).toBe("iOS and Android");
    expect(platformsLabel(deviceAppInfo.gpslogger.platforms)).toBe("Android");
  });

  it("creates Overland devices unless asked for another app", () => {
    expect(createDeviceRequestSchema.parse({ name: "iPhone" }).source).toBe("overland");
    expect(createDeviceRequestSchema.parse({ name: "Pixel", source: "owntracks" }).source).toBe(
      "owntracks",
    );
    expect(createDeviceRequestSchema.safeParse({ name: "Pixel", source: "garmin" }).success).toBe(
      false,
    );
  });
});

describe("OwnTracks setup", () => {
  const connection: OwnTracksConnection = {
    url: "https://trail.example.com/api/owntracks",
    username: "pixel-8-k3f9",
    token,
    deviceId: "pixel-8-k3f9",
    trackerId: "P8",
  };

  /** What the app imports: the link's query decoded as Android's URLDecoder does it, then base64. */
  const imported = (link: string): unknown => {
    const inline = link.slice("owntracks:///config?inline=".length);
    // URLDecoder turns `+` into a space: the link must have none left unencoded.
    expect(inline).not.toMatch(/[+/=]/);
    const bytes = Uint8Array.from(atob(decodeURIComponent(inline)), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  };

  it("links an iPhone to the HTTP configuration, the token in a bearer header", () => {
    expect(imported(owntracksSetupUrl(connection, "ios"))).toEqual({
      _type: "configuration",
      mode: 3,
      url: "https://trail.example.com/api/owntracks",
      // OwnTracks for iOS adds its HTTP headers to every request: no password in Basic.
      auth: false,
      username: "pixel-8-k3f9",
      httpHeaders: `Authorization: Bearer ${token}`,
      deviceId: "pixel-8-k3f9",
      tid: "P8",
      extendedData: true,
      monitoring: 2,
      locatorDisplacement: 30,
      locatorInterval: 60,
    });
  });

  it("offers an iPhone significant changes too, with Trail's values for Move kept", () => {
    const significant = owntracksConfiguration(connection, "iosSignificant");
    expect(significant).toEqual({
      ...owntracksConfiguration(connection, "ios"),
      monitoring: 1,
    });
    expect(imported(owntracksSetupUrl(connection, "iosSignificant"))).toEqual(significant);
  });

  it("links to Android's own tracking settings, which read the keys differently", () => {
    expect(owntracksConfiguration(connection, "android")).toMatchObject({
      mode: 3,
      // Android sends HTTP Basic, and only with a user name and a password.
      auth: true,
      username: "pixel-8-k3f9",
      password: token,
      monitoring: 1,
      locatorDisplacement: 25,
      locatorInterval: 15,
      moveModeLocatorInterval: 15,
      // By name: Android reads a number as a position in its list (0 would be High Accuracy, 3 No Power).
      locatorPriority: "HighAccuracy",
      pegLocatorFastestIntervalToInterval: true,
    });
    expect(owntracksConfiguration(connection, "android")).not.toHaveProperty("httpHeaders");
    expect(imported(owntracksSetupUrl(connection, "android"))).toEqual(
      owntracksConfiguration(connection, "android"),
    );
  });

  it("makes a tracker ID of two letters or digits from the name", () => {
    expect(trackerIdFor("Jens’s Pixel 8")).toBe("JP");
    expect(trackerIdFor("Pixel")).toBe("PI");
    expect(trackerIdFor("Ålesund-telefoon")).toBe("AT");
    expect(trackerIdFor("📱")).toBe("TR");
    expect(trackerIdFor("8")).toBe("8");
  });
});

describe("Traccar Client, OsmAnd and GPSLogger setup", () => {
  it("links Traccar Client to the server with the token as its identifier", () => {
    const link = new URL(
      traccarSetupUrl({ serverUrl: "https://trail.example.com/api/osmand", identifier: token }),
    );
    expect(link.protocol).toBe("org.traccar.client:");
    expect(Object.fromEntries(link.searchParams)).toEqual({
      url: "https://trail.example.com/api/osmand",
      id: token,
      accuracy: "highest",
      distance: "30",
      interval: "30",
      angle: "30",
      buffer: "true",
      stop_detection: "true",
    });
  });

  it("fills OsmAnd's placeholders, the accuracy instead of hdop", () => {
    expect(
      osmandUrlTemplate({ endpoint: "https://trail.example.com/api/osmand", accessToken: token }),
    ).toBe(
      `https://trail.example.com/api/osmand?token=${token}&lat={0}&lon={1}&timestamp={2}&accuracy={3}&altitude={4}&speed={5}&bearing={6}&batt={11}`,
    );
  });

  it("keeps GPSLogger's token in a header", () => {
    const url = gpsloggerUrl("https://trail.example.com/api/osmand");
    expect(url).not.toContain("trl_");
    expect(url).toContain("timestamp=%TIME&");
    expect(url).toContain("speed=%SPD&");
    expect(gpsloggerHeaders(token)).toBe(`Authorization: Bearer ${token}`);
  });
});

describe("device credentials", () => {
  it("are told apart by their app", () => {
    const owntracks = deviceCredentialsSchema.parse({
      app: "owntracks",
      endpoint: "https://trail.example.com/api/owntracks",
      username: "pixel",
      accessToken: token,
      deviceId: "pixel",
      trackerId: "PI",
      setupUrls: {
        ios: "owntracks:///config?inline=e30%3D",
        iosSignificant: "owntracks:///config?inline=e30%3D",
        android: "owntracks:///config?inline=e30%3D",
      },
    });
    expect(owntracks.app).toBe("owntracks");
    expect(
      deviceCredentialsSchema.safeParse({
        app: "traccar",
        endpoint: "https://trail.example.com/api/osmand",
        accessToken: token,
        setupUrl: "overland://setup?url=x",
      }).success,
    ).toBe(false);
  });
});
