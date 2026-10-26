import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/http/httpError";
import { decodePointCursor, encodePointCursor } from "../../src/locations/pointCursor";
import { toPoint } from "../../src/locations/toPoint";

describe("point cursors", () => {
  it("are opaque, round-trip exactly and refuse anything else", () => {
    const at = new Date("2026-10-26T08:41:07.123Z");
    const cursor = encodePointCursor(at);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain("2026");
    expect(decodePointCursor(cursor).toISOString()).toBe(at.toISOString());
    for (const wrong of ["", "x", "MjAyNi0xMy00NVQwMDowMDowMC4wMDBa", "2026-10-26T08:41:07.123Z"]) {
      expect(() => decodePointCursor(wrong), wrong).toThrow(HttpError);
    }
  });
});

describe("points in v1", () => {
  const row = {
    deviceId: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
    recordedAt: new Date("2026-10-26T08:41:07.000Z"),
    receivedAt: new Date("2026-10-26T08:45:12.000Z"),
    lat: 51.0543,
    lon: 3.7174,
    altitude: 12,
    speed: 4.2,
    course: 87,
    horizontalAccuracy: 5,
    verticalAccuracy: 3,
    speedAccuracy: 0.5,
    courseAccuracy: 12,
    motion: ["cycling"],
    batteryLevel: 0.82,
    batteryState: "unplugged",
    wifi: null,
    extra: { unique_id: "8D2C4E9A" },
  };

  it("carry the battery reading of the point, or none", () => {
    expect(toPoint(row).battery).toEqual({
      level: 0.82,
      state: "unplugged",
      recordedAt: "2026-10-26T08:41:07.000Z",
    });
    expect(toPoint({ ...row, batteryLevel: null, batteryState: null }).battery).toBeNull();
    // A reading the contract cannot carry is left out rather than failing the page.
    expect(toPoint({ ...row, batteryLevel: 1.5, batteryState: "sideways" }).battery).toBeNull();
    expect(toPoint({ ...row, batteryLevel: 1.5 }).battery?.level).toBeNull();
  });

  it("rename the accuracy as the rest of v1 does", () => {
    expect(toPoint(row)).toMatchObject({ accuracy: 5, verticalAccuracy: 3, extra: row.extra });
  });
});
