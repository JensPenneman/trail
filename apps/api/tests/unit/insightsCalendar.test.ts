import { lastInsightsDay } from "@trail/contracts/insights";
import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/http/httpError";
import { hourParts } from "../../src/insights/hourParts";
import {
  bucketFor,
  bucketOf,
  bucketsOf,
  firstInsightsDay,
  previousPeriod,
  resolvePeriod,
} from "../../src/insights/insightsPeriod";
import { localHours } from "../../src/insights/localHours";
import { startOfLocalDay } from "../../src/lib/startOfLocalDay";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

describe("the local hours of a period", () => {
  it("numbers an ordinary day's 24 hours from local midnight", () => {
    const hours = localHours("2026-10-27", "2026-10-27", "Europe/Brussels");
    expect(hours).toHaveLength(24);
    expect(hours.map((hour) => hour.hour)).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
    expect(iso(hours[0]?.start ?? 0)).toBe("2026-10-26T23:00:00.000Z");
    expect(iso(hours.at(-1)?.end ?? 0)).toBe("2026-10-27T23:00:00.000Z");
    expect(new Set(hours.map((hour) => hour.weekday))).toEqual(new Set([2]));
  });

  it("has 23 hours on the day summer time starts: 02:00 does not exist", () => {
    const hours = localHours("2026-03-29", "2026-03-29", "Europe/Brussels");
    expect(hours).toHaveLength(23);
    expect(hours.map((hour) => hour.hour)).toEqual([
      0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
    expect(iso(hours[0]?.start ?? 0)).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(hours.at(-1)?.end ?? 0)).toBe("2026-03-29T22:00:00.000Z");
    expect(hours[0]?.weekday).toBe(7);
  });

  it("has 25 hours on the day summer time ends: 02:00 comes twice", () => {
    const hours = localHours("2026-10-25", "2026-10-25", "Europe/Brussels");
    expect(hours).toHaveLength(25);
    expect(hours.map((hour) => hour.hour).slice(0, 5)).toEqual([0, 1, 2, 2, 3]);
    expect(iso(hours[3]?.start ?? 0)).toBe("2026-10-25T01:00:00.000Z");
    expect(iso(hours.at(-1)?.end ?? 0)).toBe("2026-10-25T23:00:00.000Z");
  });

  it("follows zones half an hour off UTC, and ones that skip midnight", () => {
    const kolkata = localHours("2026-10-27", "2026-10-27", "Asia/Kolkata");
    expect(kolkata).toHaveLength(24);
    expect(iso(kolkata[0]?.start ?? 0)).toBe("2026-10-26T18:30:00.000Z");
    // Chile moves its clocks from 24:00 to 01:00: that day starts at 01:00.
    const santiago = localHours("2026-09-06", "2026-09-06", "America/Santiago");
    expect(santiago).toHaveLength(23);
    expect(santiago[0]?.hour).toBe(1);
    expect(iso(santiago[0]?.start ?? 0)).toBe("2026-09-06T04:00:00.000Z");
  });

  it("covers a period without gaps or overlaps, also across both changes of the clocks", () => {
    const hours = localHours("2026-01-01", "2026-12-31", "Europe/Brussels");
    expect(hours).toHaveLength(365 * 24);
    for (let index = 1; index < hours.length; index += 1) {
      expect(hours[index]?.start).toBe(hours[index - 1]?.end);
    }
    expect(new Set(hours.map((hour) => hour.date)).size).toBe(365);
  });

  it("starts a local day where the zone's day starts", () => {
    expect(iso(startOfLocalDay("2026-10-26", "Europe/Brussels"))).toBe("2026-10-25T23:00:00.000Z");
    expect(iso(startOfLocalDay("2026-07-01", "America/New_York"))).toBe("2026-07-01T04:00:00.000Z");
    expect(iso(startOfLocalDay("2026-10-27", "Pacific/Kiritimati"))).toBe(
      "2026-10-26T10:00:00.000Z",
    );
  });
});

describe("prorating a move over the hours", () => {
  const brussels = localHours("2026-10-24", "2026-10-26", "Europe/Brussels");

  it("splits time and distance at local midnight in proportion to the time", () => {
    // 23:30 to 00:30 local, 6 km.
    const parts = hourParts(
      {
        startMs: at("2026-10-25T21:30:00Z"),
        endMs: at("2026-10-25T23:30:00Z"),
        distanceM: 6000,
      },
      brussels,
    );
    expect(
      parts.map((part) => [part.hour.date, part.hour.hour, part.seconds, part.distanceM]),
    ).toEqual([
      ["2026-10-25", 22, 1800, 1500],
      ["2026-10-25", 23, 3600, 3000],
      ["2026-10-26", 0, 1800, 1500],
    ]);
  });

  it("counts the hour that repeats when summer time ends twice, in proportion", () => {
    // 01:30 summer time to 02:30 winter time: two hours on the clock's 1, 2 and 2 again.
    const parts = hourParts(
      {
        startMs: at("2026-10-24T23:30:00Z"),
        endMs: at("2026-10-25T01:30:00Z"),
        distanceM: 12_000,
      },
      brussels,
    );
    expect(parts.map((part) => [part.hour.hour, part.seconds, part.distanceM])).toEqual([
      [1, 1800, 3000],
      [2, 3600, 6000],
      [2, 1800, 3000],
    ]);
    expect(parts.reduce((sum, part) => sum + part.seconds, 0)).toBe(7200);
  });

  it("keeps only the part inside the period, and a move without duration whole", () => {
    const day = localHours("2026-10-26", "2026-10-26", "Europe/Brussels");
    const across = hourParts(
      {
        startMs: at("2026-10-25T22:00:00Z"),
        endMs: at("2026-10-26T00:00:00Z"),
        distanceM: 8000,
      },
      day,
    );
    expect(across.map((part) => [part.hour.hour, part.seconds, part.distanceM])).toEqual([
      [0, 3600, 4000],
    ]);
    const instant = hourParts(
      { startMs: at("2026-10-26T09:00:00Z"), endMs: at("2026-10-26T09:00:00Z"), distanceM: 3 },
      day,
    );
    expect(instant.map((part) => [part.hour.hour, part.seconds, part.distanceM])).toEqual([
      [10, 0, 3],
    ]);
    const outside = hourParts(
      { startMs: at("2026-10-27T09:00:00Z"), endMs: at("2026-10-27T10:00:00Z"), distanceM: 3 },
      day,
    );
    expect(outside).toEqual([]);
  });
});

describe("the period of a request", () => {
  const today = "2026-10-27";

  it("defaults to the first day with data up to today", () => {
    expect(resolvePeriod({}, today, "2026-10-01")).toEqual({
      from: "2026-10-01",
      to: today,
      days: 27,
    });
    expect(resolvePeriod({}, today, null)).toEqual({ from: today, to: today, days: 1 });
    expect(resolvePeriod({ to: "2026-09-30" }, today, "2026-10-01")).toEqual({
      from: "2026-09-30",
      to: "2026-09-30",
      days: 1,
    });
    expect(resolvePeriod({ from: "2026-10-20", to: "2026-10-26" }, today, null)).toEqual({
      from: "2026-10-20",
      to: "2026-10-26",
      days: 7,
    });
  });

  it("covers at most three years, whichever end was left out", () => {
    expect(resolvePeriod({}, today, "2019-04-02")).toEqual({
      from: "2023-10-28",
      to: today,
      days: 1096,
    });
    expect(lastInsightsDay("2023-10-28")).toBe(today);
    expect(() => resolvePeriod({ from: "2023-10-27" }, today, null)).toThrow(HttpError);
    expect(() => resolvePeriod({ from: "2026-10-28" }, today, null)).toThrow(/must not be before/);
  });

  it("finds the first day three years back, leap days included", () => {
    expect(firstInsightsDay("2026-10-27")).toBe("2023-10-28");
    expect(firstInsightsDay("2027-02-28")).toBe("2024-02-29");
    expect(firstInsightsDay("2028-02-29")).toBe("2025-03-01");
    for (const to of ["2026-10-27", "2027-02-28", "2027-03-01", "2028-02-29", "2028-03-01"]) {
      const from = firstInsightsDay(to);
      expect(lastInsightsDay(from) >= to).toBe(true);
    }
  });

  it("compares with as many days just before", () => {
    expect(previousPeriod({ from: "2026-10-21", to: "2026-10-27", days: 7 })).toEqual({
      from: "2026-10-14",
      to: "2026-10-20",
      days: 7,
    });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31", days: 31 })).toEqual({
      from: "2026-01-29",
      to: "2026-02-28",
      days: 31,
    });
  });
});

describe("the steps of a series", () => {
  it("are days up to 31 days, weeks up to 26 weeks, then months", () => {
    expect(bucketFor(1)).toBe("day");
    expect(bucketFor(31)).toBe("day");
    expect(bucketFor(32)).toBe("week");
    expect(bucketFor(182)).toBe("week");
    expect(bucketFor(183)).toBe("month");
    expect(bucketFor(1096)).toBe("month");
  });

  it("name a step by its first day: the date, the week's Monday, the month's first", () => {
    expect(bucketOf("2026-10-27", "day")).toBe("2026-10-27");
    expect(bucketOf("2026-10-27", "week")).toBe("2026-10-26");
    expect(bucketOf("2026-11-01", "week")).toBe("2026-10-26");
    expect(bucketOf("2026-10-26", "week")).toBe("2026-10-26");
    expect(bucketOf("2026-10-27", "month")).toBe("2026-10-01");
  });

  it("list every step of the period, the first week from its Monday", () => {
    expect(bucketsOf({ from: "2026-10-25", to: "2026-10-27", days: 3 }, "day")).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
    ]);
    expect(bucketsOf({ from: "2026-09-30", to: "2026-10-27", days: 28 }, "week")).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
    ]);
    expect(bucketsOf({ from: "2025-11-15", to: "2026-02-03", days: 81 }, "month")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });
});
