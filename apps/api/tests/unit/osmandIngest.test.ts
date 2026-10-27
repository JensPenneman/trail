import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { normaliseOsmandPoint } from "../../src/osmand/normaliseOsmandPoint";
import {
  type OsmandRequest,
  osmandRequestOf,
  readOsmandRequest,
} from "../../src/osmand/osmandRequest";
import { osmandToken } from "../../src/osmand/osmandToken";
import { booleanOf, decimalOf, timestampOf } from "../../src/osmand/osmandValues";
import { prepareOsmand } from "../../src/osmand/prepareOsmand";
import {
  gpsloggerQuery,
  osmandQuery,
  seconds,
  traccarForm,
  traccarJson,
} from "../support/trackerSamples";

const receivedAt = new Date("2026-10-27T10:00:00.000Z");
const at = new Date("2026-10-27T09:59:30.000Z");
const token = "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS";

const paramsOf = (query: string) => new Map(new URLSearchParams(query));
const point = (query: string, app: "traccar" | "osmand" | "gpslogger") => {
  const result = normaliseOsmandPoint(paramsOf(query), app, receivedAt);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};
const reasonOf = (query: string) => {
  const result = normaliseOsmandPoint(paramsOf(query), "traccar", receivedAt);
  return result.ok ? null : result.reason;
};

describe("values of the OsmAnd format", () => {
  it("reads decimals and booleans as Traccar does", () => {
    expect(decimalOf("51.0543")).toBe(51.0543);
    expect(decimalOf("-3.5")).toBe(-3.5);
    expect(decimalOf(".5")).toBe(0.5);
    expect(decimalOf("1e-3")).toBe(0.001);
    expect(decimalOf(" 12 ")).toBe(12);
    for (const value of ["", "NaN", "Infinity", "51,05", "0x10", "1e999", undefined]) {
      expect(decimalOf(value), String(value)).toBeNull();
    }
    expect([booleanOf("true"), booleanOf("1"), booleanOf("False"), booleanOf("0")]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(booleanOf("yes")).toBeNull();
  });

  it("takes seconds, milliseconds and ISO 8601 with a zone, nothing that needs a guess", () => {
    const iso = (value: string) => timestampOf(value)?.toISOString() ?? null;
    expect(iso("1730000000")).toBe("2024-10-27T03:33:20.000Z");
    expect(iso("1730000000.25")).toBe("2024-10-27T03:33:20.250Z");
    expect(iso("1730000000123")).toBe("2024-10-27T03:33:20.123Z");
    expect(iso("2026-10-27T09:59:30.123Z")).toBe("2026-10-27T09:59:30.123Z");
    expect(iso("2026-10-27T10:59:30+01:00")).toBe("2026-10-27T09:59:30.000Z");
    expect(iso("2026-10-27T09:59:30")).toBeNull();
    expect(iso("2026-10-27 09:59:30")).toBeNull();
    expect(iso("0")).toBeNull();
    expect(iso("-5")).toBeNull();
    expect(iso("soon")).toBeNull();
  });
});

describe("a point in the OsmAnd format", () => {
  it("reads Traccar Client's form, its speed in knots", () => {
    const { location, events, battery } = point(traccarForm(token, at), "traccar");
    expect(location).toMatchObject({
      recordedAt: at,
      lat: 51.0543,
      lon: 3.7174,
      altitude: 11.5,
      course: 92.5,
      horizontalAccuracy: 4.8,
      batteryLevel: 0.81,
      batteryState: "unplugged",
      motion: [],
      wifi: null,
      extra: null,
    });
    expect(location?.speed).toBeCloseTo(9.72 * 0.514444, 4);
    expect(events).toEqual([]);
    expect(battery).toEqual({ recordedAt: at, level: 0.81, state: "unplugged" });
  });

  it("reads the old Android client's query: no accuracy for GPS fixes, charge only when true", () => {
    const old = new URLSearchParams({
      id: token,
      timestamp: String(seconds(at)),
      lat: "51.0543",
      lon: "3.7174",
      speed: "0.0",
      bearing: "0.0",
      altitude: "0.0",
      accuracy: "0.0",
      batt: "85.0",
      charge: "true",
      mock: "true",
    }).toString();
    expect(point(old, "traccar").location).toMatchObject({
      speed: 0,
      course: 0,
      altitude: 0,
      horizontalAccuracy: null,
      batteryLevel: 0.85,
      batteryState: "charging",
      extra: { mock: "true" },
    });
  });

  it("reads OsmAnd's template: milliseconds, m/s, and its hdop as the accuracy", () => {
    const filled = osmandQuery(token, at);
    expect(point(filled, "osmand").location).toMatchObject({
      recordedAt: at,
      speed: 1.5,
      horizontalAccuracy: 6,
      altitude: 9,
      course: 180,
      batteryLevel: 0.64,
      batteryState: null,
    });
    // OsmAnd's own examples call {3} hdop: it is the accuracy in metres all the same.
    const hdop = osmandQuery(token, at, { accuracy: "" }).replace("accuracy=", "hdop=6.0&x=");
    expect(point(hdop, "osmand").location).toMatchObject({ horizontalAccuracy: 6 });
    expect(point(`${hdop}&batproc=33`, "osmand").location?.batteryLevel).toBe(0.64);
  });

  it("reads GPSLogger's template: ISO time, m/s, and a real HDOP kept as it came", () => {
    const { location } = point(`${gpsloggerQuery(at)}&hdop=0.9&sat=9`, "gpslogger");
    expect(location).toMatchObject({
      recordedAt: at,
      speed: 12.5,
      horizontalAccuracy: 8,
      batteryLevel: 0.92,
      batteryState: "charging",
      extra: { hdop: "0.9", sat: "9" },
    });
  });

  it("makes a request without a position a heartbeat, and an alarm an event", () => {
    const heartbeat = point(
      new URLSearchParams({ id: token, timestamp: String(seconds(at)), batt: "40" }).toString(),
      "traccar",
    );
    expect(heartbeat.location).toBeNull();
    expect(heartbeat.events).toEqual([
      {
        recordedAt: at,
        action: "heartbeat",
        lat: null,
        lon: null,
        extra: null,
        battery: { recordedAt: at, level: 0.4, state: null },
      },
    ]);
    const sos = point(traccarForm(token, at, { alarm: "sos" }), "traccar");
    expect(sos.location?.extra).toEqual({ alarm: "sos" });
    expect(sos.events).toEqual([
      expect.objectContaining({
        action: "alarm",
        lat: 51.0543,
        lon: 3.7174,
        extra: { alarm: "sos" },
      }),
    ]);
    expect(
      point(`location=${encodeURIComponent("51.05,3.72")}&timestamp=${seconds(at)}`, "osmand")
        .location,
    ).toMatchObject({ lat: 51.05, lon: 3.72 });
  });

  it("rejects what it cannot take, and says why", () => {
    expect(reasonOf(traccarForm(token, at, { valid: "false" }))).toBe(
      "the app marked the position as invalid",
    );
    expect(reasonOf(traccarForm(token, at, { timestamp: "" }))).toBe("missing timestamp");
    expect(reasonOf(traccarForm(token, at, { timestamp: "2026-10-27 09:59:30" }))).toBe(
      "invalid timestamp",
    );
    expect(reasonOf(traccarForm(token, at, { timestamp: String(seconds(at) + 90_000) }))).toBe(
      "timestamp is more than 24 h in the future",
    );
    expect(reasonOf(traccarForm(token, at, { lat: "91" }))).toBe("coordinates out of range");
    expect(reasonOf(traccarForm(token, at, { lat: "0", lon: "0" }))).toBe(
      "coordinates are exactly 0,0",
    );
    expect(reasonOf(traccarForm(token, at, { lon: "" }))).toBe("invalid coordinates");
  });

  it("never keeps the token: not as a parameter, not inside another one", () => {
    const query = `${traccarForm(token, at)}&token=${token}&ACCESS_TOKEN=${token}&deviceid=${token}&note=${token}`;
    const { location } = point(query, "traccar");
    expect(location?.extra).toEqual({ note: "[redacted]" });
    expect(JSON.stringify(location)).not.toContain(token);
  });
});

describe("an upload in the OsmAnd format", () => {
  const request = (fields: Partial<OsmandRequest>): OsmandRequest => ({
    params: new Map(),
    overflow: false,
    json: null,
    ...fields,
  });

  it("reads Traccar Client 9's JSON in the plugin's units, its query-text copy left out", () => {
    const { batch, singles } = prepareOsmand(
      request({ json: { ok: true, value: traccarJson(token, at) } }),
      "traccar",
      receivedAt,
    );
    expect(batch.records).toBe(1);
    expect(batch.locations).toEqual([
      expect.objectContaining({
        recordedAt: at,
        speed: 13.9,
        course: null,
        horizontalAccuracy: 7.5,
        altitude: 10.2,
        motion: ["automotive"],
        batteryLevel: 0.42,
        batteryState: "charging",
        extra: {
          is_moving: true,
          odometer: 18_420,
          event: "",
          activity: { type: "in_vehicle" },
          extras: {},
        },
      }),
    ]);
    expect(JSON.stringify({ batch, singles })).not.toContain(token);
  });

  it("stores a JSON batch's points once per time and its heartbeats as events", () => {
    const location = traccarJson(token, at).location;
    const { coords: _coords, ...withoutFix } = location;
    const { batch } = prepareOsmand(
      request({ json: { ok: true, value: { location: [location, location, withoutFix] } } }),
      "traccar",
      receivedAt,
    );
    expect(batch).toMatchObject({ records: 3, locationRecords: 2 });
    expect(batch.locations).toHaveLength(1);
    expect(batch.events.map((event) => event.action)).toEqual(["heartbeat"]);
  });

  it("keeps a body it cannot read, or too many parameters, in the dead letter", () => {
    const reasons = (fields: Partial<OsmandRequest>) =>
      prepareOsmand(request(fields), "traccar", receivedAt).batch.rejects.map(
        (reject) => reject.reason,
      );
    expect(reasons({ json: { ok: false, preview: "{lat" } })).toEqual(["body is not JSON"]);
    expect(reasons({ json: { ok: true, value: [1] } })).toEqual(["body is not a JSON object"]);
    expect(reasons({ json: { ok: true, value: { device_id: token } } })).toEqual([
      "missing location",
    ]);
    expect(reasons({ params: paramsOf(traccarForm(token, at)), overflow: true })).toEqual([
      "too many parameters",
    ]);
    const kept = prepareOsmand(
      request({ params: paramsOf(traccarForm(token, at, { lat: "x" })) }),
      "traccar",
      receivedAt,
    );
    expect(kept.batch.rejects).toEqual([
      expect.objectContaining({
        reason: "invalid coordinates",
        record: expect.objectContaining({ lat: "x" }),
      }),
    ]);
    expect(JSON.stringify(kept)).not.toContain(token);
  });
});

describe("the token of the OsmAnd format", () => {
  it("is found in the header, the parameters or Traccar Client 9's device_id", () => {
    const read = (authorization: string | undefined, url: string, body?: string, type?: string) => {
      const req = {
        originalUrl: url,
        body: body === undefined ? undefined : Buffer.from(body),
        get: (name: string) => (name === "authorization" ? authorization : undefined),
        is: (types: string[]) => (type !== undefined && types.includes(type) ? type : false),
      } as unknown as Request;
      readOsmandRequest(req, {} as never, () => {});
      return osmandToken(req);
    };
    expect(read(`Bearer ${token}`, "/api/osmand?lat=1")).toBe(token);
    expect(read(undefined, `/api/osmand?token=${token}`)).toBe(token);
    expect(read(undefined, `/api/osmand?id=${token}`)).toBe(token);
    expect(
      read(undefined, "/api/osmand", `id=${token}&lat=1`, "application/x-www-form-urlencoded"),
    ).toBe(token);
    expect(
      read(undefined, "/api/osmand", JSON.stringify({ device_id: token }), "application/json"),
    ).toBe(token);
    // The first token-shaped value wins; Traccar Client's own random ids are no token.
    expect(read("Bearer nope", `/api/osmand?id=12345678&token=${token}`)).toBe(token);
    expect(read(undefined, "/api/osmand?id=12345678")).toBeNull();
  });

  it("reads the query's parameters before the form's, and at most 100", () => {
    const requestOf = (url: string, body: string) => {
      const req = {
        originalUrl: url,
        body: Buffer.from(body),
        get: () => undefined,
        is: () => false,
      } as unknown as Request;
      readOsmandRequest(req, {} as never, () => {});
      return osmandRequestOf(req);
    };
    const both = requestOf("/api/osmand?lat=1", "lat=2&lon=3");
    expect([both.params.get("lat"), both.params.get("lon"), both.overflow]).toEqual([
      "1",
      "3",
      false,
    ]);
    const many = Array.from({ length: 120 }, (_, n) => `p${n}=1`).join("&");
    expect(requestOf(`/api/osmand?${many}`, "lon=3")).toMatchObject({ overflow: true });
  });
});
