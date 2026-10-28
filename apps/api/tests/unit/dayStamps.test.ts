import { cacheStampSchema } from "@trail/contracts/cacheStamp";
import { describe, expect, it } from "vitest";
import {
  type DayStampRow,
  dayStampsOf,
  dayValidator,
  localDaysOf,
  type StampedDay,
  stampDay,
} from "../../src/cache/dayStamps";
import { tripDays } from "../../src/history/tripTouches";
import { visitDays } from "../../src/history/visitTouches";

const deviceId = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3";
const zone = "Europe/Brussels";

/** A day with points, a visit, a trip and two segments, nothing waiting. */
const row = (changes: Partial<DayStampRow> = {}): DayStampRow => ({
  device_id: deviceId,
  date: "2026-10-26",
  points: 1840,
  distance_m: 23_510.4,
  first_at: "2026-10-26 05:12:40+00",
  last_at: "2026-10-26 21:58:03+00",
  points_total: null,
  last_recorded_at: null,
  visits: 1,
  visits_at: "1793000000.000000",
  trips: 1,
  trips_at: "1793003600.000000",
  segments: 2,
  computed_at: "2026-10-26 22:00:01.5+00",
  min_version: 3,
  max_version: 3,
  starts: "3586001000.000000",
  ends: "3586090000.000000",
  points_of_parts: "1612",
  pending: false,
  ...changes,
});

const stampOf = (changes: Partial<DayStampRow> = {}, timezone = zone) =>
  stampDay(row(changes), timezone);

describe("stampDay", () => {
  it("gives two opaque 22-character hashes the contract accepts", () => {
    const { stamp } = stampOf();
    expect(cacheStampSchema.parse(stamp)).toEqual(stamp);
    expect(stamp.raw).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(stamp.processed).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("is the same for the same day, whenever and wherever it is computed", () => {
    expect(stampOf()).toEqual(stampOf());
  });

  it("writes the canonical strings out in full, device, day and zone included", () => {
    const { canonical } = stampOf();
    expect(canonical.raw).toBe(
      `raw1|${deviceId}|2026-10-26|${zone}|1840|23510.4|2026-10-26 05:12:40+00|2026-10-26 21:58:03+00|-|-|1|1793000000.000000|1|1793003600.000000`,
    );
    expect(canonical.processed).toBe(
      `processed2|${deviceId}|2026-10-26|${zone}|2|2026-10-26 22:00:01.5+00|3|3|3586001000.000000|3586090000.000000|1612|settled`,
    );
  });

  it("moves the raw stamp with what was recorded, never the processed one", () => {
    const base = stampOf().stamp;
    for (const changes of [
      { points: 1841 },
      { distance_m: 23_600 },
      { first_at: "2026-10-26 05:00:00+00" },
      { last_at: "2026-10-26 22:10:00+00" },
      { visits: 2, visits_at: "3586000000.000000" },
      { trips: 0, trips_at: null },
      { points_total: "120345", last_recorded_at: "2026-10-26 21:58:03+00" },
    ] satisfies Partial<DayStampRow>[]) {
      const stamp = stampOf(changes).stamp;
      expect(stamp.raw, JSON.stringify(changes)).not.toBe(base.raw);
      expect(stamp.processed, JSON.stringify(changes)).toBe(base.processed);
    }
  });

  it("moves the processed stamp with processing, never the raw one", () => {
    const base = stampOf().stamp;
    for (const changes of [
      { segments: 3 },
      // A pass, or a mode corrected: the newest write moves.
      { computed_at: "2026-10-27 06:00:00+00" },
      { min_version: 2 },
      { max_version: 4 },
      // A pass next door cut a segment of this day without rewriting it.
      { ends: "3586089000.000000" },
      { starts: "3586002000.000000" },
      // A part of a stay served on this day, on another day, counted anew.
      { points_of_parts: "1617" },
      { pending: true },
    ] satisfies Partial<DayStampRow>[]) {
      const stamp = stampOf(changes).stamp;
      expect(stamp.processed, JSON.stringify(changes)).not.toBe(base.processed);
      expect(stamp.raw, JSON.stringify(changes)).toBe(base.raw);
    }
  });

  it("has no processed stamp while the day has no segment, waiting or not", () => {
    const empty = {
      segments: 0,
      computed_at: null,
      min_version: null,
      max_version: null,
      starts: null,
      ends: null,
    };
    expect(stampOf(empty).stamp.processed).toBeNull();
    const waiting = stampOf({ ...empty, pending: true });
    expect(waiting.stamp.processed).toBeNull();
    // The validator still sees the window waiting.
    expect(waiting.canonical.processed).not.toBe(stampOf(empty).canonical.processed);
  });

  it("stands for its own device, day and zone only", () => {
    const base = stampOf().stamp;
    expect(stampOf({ device_id: "0199a0f4-1a2b-7c3d-8e4f-5a6b7c8d9e0f" }).stamp.raw).not.toBe(
      base.raw,
    );
    expect(stampOf({ date: "2026-10-27" }).stamp.raw).not.toBe(base.raw);
    const elsewhere = stampOf({}, "America/New_York").stamp;
    expect(elsewhere.raw).not.toBe(base.raw);
    expect(elsewhere.processed).not.toBe(base.processed);
  });
});

describe("dayValidator and dayStampsOf", () => {
  const days: StampedDay[] = [
    { ...stampOf(), stat: null },
    { ...stampOf({ date: "2026-10-27", pending: true }), stat: null },
  ];

  it("hashes the raw strings for what depends on the recording only, both otherwise", () => {
    expect(dayValidator(days)).toEqual(days.map((day) => day.canonical.raw));
    expect(dayValidator(days, "processed")).toEqual(
      days.map((day) => `${day.canonical.raw}\n${day.canonical.processed}`),
    );
  });

  it("lists every device and day as the contract's DayStamp", () => {
    expect(dayStampsOf(days)).toEqual(
      days.map((day) => ({ deviceId, date: day.date, ...day.stamp })),
    );
  });
});

describe("localDaysOf", () => {
  it("lists the local days a range intersects, its end excluded", () => {
    // Midnight to midnight in Brussels (UTC+1 in winter): one day.
    expect(
      localDaysOf(
        { from: new Date("2026-10-25T23:00:00Z"), to: new Date("2026-10-26T23:00:00Z") },
        zone,
      ),
    ).toEqual(["2026-10-26"]);
    expect(
      localDaysOf(
        { from: new Date("2026-10-26T20:00:00Z"), to: new Date("2026-10-27T01:00:00Z") },
        zone,
      ),
    ).toEqual(["2026-10-26", "2026-10-27"]);
  });

  it("follows the zone across a change of the clocks", () => {
    // 25 October 2026: summer time ends in Brussels, the day lasts 25 hours.
    expect(
      localDaysOf(
        { from: new Date("2026-10-24T22:00:00Z"), to: new Date("2026-10-25T23:00:00Z") },
        zone,
      ),
    ).toEqual(["2026-10-25"]);
  });

  it("gives the one day of a range shorter than a millisecond", () => {
    const at = new Date("2026-10-26T12:00:00Z");
    expect(localDaysOf({ from: at, to: at }, zone)).toEqual(["2026-10-26"]);
  });
});

describe("the days a visit or a trip touches", () => {
  const at = (iso: string) => new Date(iso);

  it("are a visit's days of record, arrival and departure, and the days between", () => {
    expect(
      visitDays(
        {
          recordedAt: at("2026-10-27T06:00:00Z"),
          arrivedAt: at("2026-10-24T18:00:00Z"),
          departedAt: at("2026-10-27T06:00:00Z"),
        },
        zone,
      ),
    ).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  });

  it("are only the known days of a visit without a departure", () => {
    expect(
      visitDays(
        {
          recordedAt: at("2026-10-27T06:00:00Z"),
          arrivedAt: at("2026-10-24T18:00:00Z"),
          departedAt: null,
        },
        zone,
      ),
    ).toEqual(["2026-10-24", "2026-10-27"]);
  });

  it("name the ends only of a visit or trip of more than a month", () => {
    expect(
      visitDays(
        {
          recordedAt: at("2026-10-27T06:00:00Z"),
          arrivedAt: at("1990-01-01T00:00:00Z"),
          departedAt: at("2026-10-27T06:00:00Z"),
        },
        zone,
      ),
    ).toEqual(["1990-01-01", "2026-10-27"]);
    expect(
      tripDays(
        { startedAt: at("2026-01-01T10:00:00Z"), endedAt: at("2026-10-27T10:00:00Z") },
        zone,
      ),
    ).toEqual(["2026-01-01", "2026-10-27"]);
  });

  it("run from a trip's first to its last day, a trip ending at midnight included", () => {
    expect(
      tripDays(
        { startedAt: at("2026-10-26T21:30:00Z"), endedAt: at("2026-10-26T23:00:00Z") },
        zone,
      ),
    ).toEqual(["2026-10-26", "2026-10-27"]);
  });
});
