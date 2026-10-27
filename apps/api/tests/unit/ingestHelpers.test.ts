import { describe, expect, it } from "vitest";
import { deviceCredentials } from "../../src/devices/deviceCredentials";
import { checkCoordinates } from "../../src/ingest/checkCoordinates";
import {
  authorizationScheme,
  basicPassword,
  bearerCredential,
  isDeviceToken,
} from "../../src/ingest/deviceToken";
import { batteryPercentOf, positiveRealOrNull } from "../../src/ingest/ingestValues";
import { checkRecordTime } from "../../src/ingest/recordTime";
import { withoutSecrets } from "../../src/ingest/withoutSecrets";

const token = "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS";

describe("device credentials in requests", () => {
  it("takes the shape of a device token, nothing else", () => {
    expect(isDeviceToken(token)).toBe(true);
    expect(isDeviceToken(`${token}x`)).toBe(false);
    expect(isDeviceToken(`trlk_${token.slice(4)}`)).toBe(false);
    expect(isDeviceToken(12)).toBe(false);
  });

  it("reads the scheme, a bearer value and a Basic password", () => {
    expect(authorizationScheme(`  basic abc`)).toBe("basic");
    expect(authorizationScheme("Bearer x")).toBe("bearer");
    expect(authorizationScheme(undefined)).toBeNull();
    expect(bearerCredential(`bearer ${token} `)).toBe(token);
    expect(bearerCredential(`Basic ${token}`)).toBeNull();
    const basic = (pair: string) => `Basic ${Buffer.from(pair).toString("base64")}`;
    expect(basicPassword(basic(`any name:${token}`))).toBe(token);
    // A password may hold colons; a user name may not (RFC 7617).
    expect(basicPassword(basic("user:pa:ss"))).toBe("pa:ss");
    expect(basicPassword(basic("no colon"))).toBeNull();
    expect(basicPassword("Basic ***")).toBeNull();
  });
});

describe("shared ingest checks", () => {
  it("checks positions and times as every protocol needs them", () => {
    expect(checkCoordinates(51.05, 3.72)).toEqual({ ok: true, lat: 51.05, lon: 3.72 });
    expect(checkCoordinates(null, 3.72)).toEqual({ ok: false, reason: "invalid coordinates" });
    expect(checkCoordinates(0, 0)).toEqual({ ok: false, reason: "coordinates are exactly 0,0" });
    expect(checkCoordinates(51, 181)).toEqual({ ok: false, reason: "coordinates out of range" });
    const received = new Date("2026-10-27T10:00:00Z");
    expect(checkRecordTime(new Date(Number.NaN), received)).toEqual({
      ok: false,
      reason: "invalid timestamp",
    });
    expect(checkRecordTime(new Date("2026-10-28T09:59:59Z"), received).ok).toBe(true);
  });

  it("reads 0 as no accuracy and a percentage as Trail's battery level", () => {
    expect([positiveRealOrNull(0), positiveRealOrNull(4.5), positiveRealOrNull(-1)]).toEqual([
      null,
      4.5,
      null,
    ]);
    expect([batteryPercentOf(0), batteryPercentOf(55), batteryPercentOf(100.5)]).toEqual([
      0,
      0.55,
      null,
    ]);
  });

  it("keeps no credential of a record: keys that hold one and token-shaped text", () => {
    expect(
      withoutSecrets({
        password: token,
        Token: "x",
        nested: [{ encryptionKey: "k", note: `id=${token}&x=1`, [`${token}`]: 1 }],
        apiToken: `trlk_${token.slice(4)}`,
        count: 3,
      }),
    ).toEqual({
      nested: [{ note: "id=[redacted]&x=1", "[redacted]": 1 }],
      apiToken: "[redacted]",
      count: 3,
    });
  });
});

describe("credentials for each app", () => {
  const ingestUrls = {
    overland: "https://trail.example.com/api/overland",
    owntracks: "https://trail.example.com/api/owntracks",
    osmand: "https://trail.example.com/api/osmand",
  };
  const forApp = (app: Parameters<typeof deviceCredentials>[0]["app"]) =>
    deviceCredentials({
      app,
      ingestUrls,
      accessToken: token,
      deviceKey: "pixel-k3f9",
      deviceName: "Jens’s Pixel",
    });

  it("points every app at its endpoint with the token where the app sends it", () => {
    expect(forApp("overland")).toMatchObject({ app: "overland", endpoint: ingestUrls.overland });
    expect(forApp("owntracks")).toMatchObject({
      app: "owntracks",
      endpoint: ingestUrls.owntracks,
      username: "pixel-k3f9",
      deviceId: "pixel-k3f9",
      trackerId: "JP",
      accessToken: token,
    });
    const traccar = forApp("traccar");
    expect(traccar).toMatchObject({ app: "traccar", endpoint: ingestUrls.osmand });
    if (traccar.app !== "traccar") throw new Error("not Traccar's");
    expect(new URL(traccar.setupUrl).searchParams.get("id")).toBe(token);
    expect(forApp("osmand")).toMatchObject({
      app: "osmand",
      urlTemplate: expect.stringContaining(`${ingestUrls.osmand}?token=${token}&lat={0}`),
    });
    const gpslogger = forApp("gpslogger");
    if (gpslogger.app !== "gpslogger") throw new Error("not GPSLogger's");
    expect(gpslogger.url).not.toContain(token);
    expect(gpslogger.headers).toBe(`Authorization: Bearer ${token}`);
  });
});
