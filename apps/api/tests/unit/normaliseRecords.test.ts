import { describe, expect, it } from "vitest";
import { classifyRecord } from "../../src/overland/classifyRecord";
import { normaliseEvent } from "../../src/overland/normaliseEvent";
import { normaliseLiveTrip } from "../../src/overland/normaliseLiveTrip";
import { normaliseLocation } from "../../src/overland/normaliseLocation";
import { normaliseTrip } from "../../src/overland/normaliseTrip";
import { normaliseVisit } from "../../src/overland/normaliseVisit";

const receivedAt = new Date("2026-09-30T12:00:00Z");

const point = (properties: Record<string, unknown>, coordinates: unknown = [3.7174, 51.0543]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties: { timestamp: "2026-09-30T11:59:00Z", ...properties },
});

describe("classifyRecord", () => {
  it("tells visits, trips, log events and locations apart", () => {
    expect(classifyRecord(point({ action: "visit" }))).toBe("visit");
    expect(classifyRecord(point({ type: "trip" }))).toBe("trip");
    expect(classifyRecord({ properties: { action: "paused_location_updates" } })).toBe("event");
    expect(classifyRecord(point({ speed: 3 }))).toBe("location");
    expect(classifyRecord("garbage")).toBe("location");
  });
});

describe("normaliseLocation", () => {
  it("maps Overland properties to columns and keeps the rest in extra", () => {
    const result = normaliseLocation(
      point({
        altitude: 12.5,
        speed: 4.2,
        course: 231,
        horizontal_accuracy: 6,
        vertical_accuracy: 3,
        speed_accuracy: 0.5,
        course_accuracy: 9,
        motion: ["cycling", 7],
        battery_level: 0.76,
        battery_state: "unplugged",
        wifi: "",
        device_id: "iphone",
        unique_id: "ABC",
        pauses: false,
        locations_in_payload: 12,
      }),
      receivedAt,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      lat: 51.0543,
      lon: 3.7174,
      altitude: 12.5,
      speed: 4.2,
      course: 231,
      horizontalAccuracy: 6,
      verticalAccuracy: 3,
      motion: ["cycling"],
      batteryLevel: 0.76,
      batteryState: "unplugged",
      wifi: null,
      extra: { device_id: "iphone", unique_id: "ABC", pauses: false, locations_in_payload: 12 },
    });
    expect(result.value.recordedAt.toISOString()).toBe("2026-09-30T11:59:00.000Z");
    expect(result.value.battery).toEqual({
      recordedAt: result.value.recordedAt,
      level: 0.76,
      state: "unplugged",
    });
  });

  it("turns negative sentinels into null, and a negative vertical accuracy voids the altitude", () => {
    const result = normaliseLocation(
      point({
        altitude: 40,
        speed: -1,
        course: -1,
        horizontal_accuracy: -1,
        vertical_accuracy: -1,
        speed_accuracy: -1,
        course_accuracy: -1,
        battery_level: -1,
        battery_state: "weird",
      }),
      receivedAt,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      altitude: null,
      speed: null,
      course: null,
      horizontalAccuracy: null,
      verticalAccuracy: null,
      speedAccuracy: null,
      courseAccuracy: null,
      batteryLevel: null,
      batteryState: null,
      battery: null,
    });
  });

  it("keeps a negative altitude (below sea level) when the vertical accuracy is valid", () => {
    const result = normaliseLocation(point({ altitude: -4, vertical_accuracy: 3 }), receivedAt);
    expect(result.ok && result.value.altitude).toBe(-4);
  });

  it("rejects unusable records with a reason", () => {
    const reasons = [
      normaliseLocation("nope", receivedAt),
      normaliseLocation({ type: "Feature", geometry: null, properties: {} }, receivedAt),
      normaliseLocation(point({}, [0, 0]), receivedAt),
      normaliseLocation(point({}, [181, 10]), receivedAt),
      normaliseLocation(point({}, [10, -91]), receivedAt),
      normaliseLocation(point({}, ["3.7", "51"]), receivedAt),
      normaliseLocation(point({ timestamp: "yesterday" }), receivedAt),
      normaliseLocation(point({ timestamp: undefined }), receivedAt),
      normaliseLocation(point({ timestamp: "2026-10-02T12:00:01Z" }), receivedAt),
      normaliseLocation({ geometry: { type: "Point", coordinates: [3, 51] } }, receivedAt),
    ].map((result) => (result.ok ? "ok" : result.reason));
    expect(reasons).toEqual([
      "record is not an object",
      "missing geometry",
      "coordinates are exactly 0,0",
      "coordinates out of range",
      "coordinates out of range",
      "invalid coordinates",
      "invalid timestamp",
      "missing timestamp",
      "timestamp is more than 24 h in the future",
      "missing properties",
    ]);
  });

  it("accepts a timestamp up to 24 h ahead (phone clock skew)", () => {
    expect(normaliseLocation(point({ timestamp: "2026-10-01T11:59:59Z" }), receivedAt).ok).toBe(
      true,
    );
  });
});

describe("normaliseVisit", () => {
  it("reads arrival and departure; far-away sentinel dates become null", () => {
    const result = normaliseVisit(
      point({
        action: "visit",
        arrival_date: "2026-09-30T08:00:00Z",
        departure_date: "4001-01-01T00:00:00Z",
        horizontal_accuracy: 30,
        wifi: "home",
      }),
      receivedAt,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.arrivedAt?.toISOString()).toBe("2026-09-30T08:00:00.000Z");
    expect(result.value.departedAt).toBeNull();
    expect(result.value.horizontalAccuracy).toBe(30);
    expect(result.value.extra).toEqual({ wifi: "home" });
  });
});

describe("normaliseTrip", () => {
  it("keys trips by their start and keeps the end locations", () => {
    const result = normaliseTrip(
      point({
        type: "trip",
        mode: "bicycle",
        start: "2026-09-30T07:00:00Z",
        end: "2026-09-30T07:45:00Z",
        distance: 14_000.5,
        duration: 2700,
        steps: 12.4,
        stopped_automatically: true,
        start_location: { type: "Feature" },
        end_location: { type: "Feature" },
      }),
      receivedAt,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      mode: "bicycle",
      distanceM: 14_000.5,
      durationS: 2700,
      steps: 12,
      stoppedAutomatically: true,
      startLocation: { type: "Feature" },
    });
    expect(result.value.startedAt.toISOString()).toBe("2026-09-30T07:00:00.000Z");
    expect(result.value.endedAt.toISOString()).toBe("2026-09-30T07:45:00.000Z");
    expect(result.value.extra).toMatchObject({ timestamp: "2026-09-30T11:59:00Z" });
  });

  it("rejects a trip without a valid start or that ends before it starts", () => {
    expect(normaliseTrip(point({ type: "trip" }), receivedAt).ok).toBe(false);
    const backwards = normaliseTrip(
      point({ type: "trip", start: "2026-09-30T08:00:00Z", end: "2026-09-30T07:00:00Z" }),
      receivedAt,
    );
    expect(backwards.ok ? "ok" : backwards.reason).toBe("trip ends before it starts");
  });
});

describe("normaliseEvent", () => {
  it("accepts log actions without geometry", () => {
    const result = normaliseEvent(
      {
        type: "Feature",
        properties: { action: "did_enter_background", timestamp: "2026-09-30T11:00:00Z" },
      },
      receivedAt,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ action: "did_enter_background", lat: null, lon: null });
  });

  it("keeps an unusable geometry in extra instead of rejecting the event", () => {
    const result = normaliseEvent(point({ action: "paused_location_updates" }, [0, 0]), receivedAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lat).toBeNull();
    expect(result.value.extra).toMatchObject({ geometry: { type: "Point", coordinates: [0, 0] } });
  });
});

describe("normaliseLiveTrip", () => {
  it("reads the payload's trip in progress", () => {
    expect(
      normaliseLiveTrip({ mode: "car", start: "2026-09-30T07:00:00Z", distance: 1234.5 }),
    ).toEqual({ mode: "car", startedAt: "2026-09-30T07:00:00.000Z", distanceM: 1234.5 });
    expect(normaliseLiveTrip({ mode: "car", start: "soon" })).toBeNull();
    expect(normaliseLiveTrip(undefined)).toBeNull();
  });
});
