import { describe, expect, it } from "vitest";
import { isOverlandPayload } from "../../src/overland/overlandPayload";
import { prepareBatch } from "../../src/overland/prepareBatch";
import { overlandFixture } from "../support/overlandFixture";

const receivedAt = new Date("2026-09-30T12:00:00Z");

describe("prepareBatch", () => {
  it("splits the fixture into points, visits, trips, events, current and the live trip", () => {
    const payload = overlandFixture();
    expect(isOverlandPayload(payload)).toBe(true);
    const batch = prepareBatch(payload, receivedAt);
    expect(batch.records).toBe(34);
    expect(batch.locations).toHaveLength(30);
    expect(batch.locationRecords).toBe(30);
    expect(batch.visits).toHaveLength(1);
    expect(batch.trips).toHaveLength(1);
    expect(batch.events.map((event) => event.action).sort()).toEqual([
      "did_enter_background",
      "exited_pause_region",
    ]);
    expect(batch.rejects).toEqual([]);
    expect(batch.current?.recordedAt.toISOString()).toBe("2026-09-29T07:15:00.000Z");
    expect(batch.liveTrip).toEqual({
      mode: "bicycle",
      startedAt: "2026-09-29T06:30:12.000Z",
      distanceM: 14_120.6,
    });
    // The newest battery reading comes from `current`.
    expect(batch.battery).toMatchObject({ level: 0.77, state: "unplugged" });
    const times = batch.locations.map((location) => location.recordedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("counts repeats of a timestamp within one batch but stores the first only", () => {
    const payload = overlandFixture();
    const first = payload.locations[5];
    if (first === undefined) throw new Error("fixture too short");
    payload.locations.push(structuredClone(first));
    const batch = prepareBatch(payload, receivedAt);
    expect(batch.locationRecords).toBe(31);
    expect(batch.locations).toHaveLength(30);
  });

  it("keeps invalid records for the dead letter, with a reason", () => {
    const batch = prepareBatch(
      {
        locations: [
          42,
          { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
          { type: "Feature", properties: { action: "visit", timestamp: "2026-09-30T10:00:00Z" } },
        ],
      },
      receivedAt,
    );
    expect(batch.rejects.map((reject) => reject.reason)).toEqual([
      "record is not an object",
      "coordinates are exactly 0,0",
      "missing geometry",
    ]);
    expect(batch.rejects[0]?.record).toBe(42);
  });

  it("recognises what is not an Overland payload", () => {
    expect(isOverlandPayload({})).toBe(false);
    expect(isOverlandPayload([])).toBe(false);
    expect(isOverlandPayload({ _type: "location", lat: 51, lon: 3 })).toBe(false);
    expect(isOverlandPayload({ locations: "no" })).toBe(false);
    expect(isOverlandPayload({ locations: new Array(5001).fill(null) })).toBe(false);
    expect(isOverlandPayload({ locations: [] })).toBe(true);
  });
});
