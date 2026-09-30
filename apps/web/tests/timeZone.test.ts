import { describe, expect, it } from "vitest";
import { addDays } from "../src/time/addDays";
import { boundedRange } from "../src/time/boundedRange";
import { daysBetween } from "../src/time/daysBetween";
import { firstDayOfWeek } from "../src/time/firstDayOfWeek";
import { localDateOf } from "../src/time/localDateOf";
import { localDayRange } from "../src/time/localDayRange";
import { monthGrid } from "../src/time/monthGrid";
import { parseLocalDate } from "../src/time/parseLocalDate";
import { shiftMonth } from "../src/time/shiftMonth";
import { startOfLocalDay } from "../src/time/startOfLocalDay";

const iso = (ms: number) => new Date(ms).toISOString();

describe("startOfLocalDay", () => {
  it("finds local midnight as a UTC instant", () => {
    expect(iso(startOfLocalDay("2026-09-30", "Europe/Brussels"))).toBe("2026-09-29T22:00:00.000Z");
    expect(iso(startOfLocalDay("2026-09-30", "America/St_Johns"))).toBe("2026-09-30T02:30:00.000Z");
  });

  it("handles the days summer time starts and ends", () => {
    // 23 hours on 29 March, 25 hours on 25 October.
    expect(iso(startOfLocalDay("2026-03-29", "Europe/Brussels"))).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(startOfLocalDay("2026-03-30", "Europe/Brussels"))).toBe("2026-03-29T22:00:00.000Z");
    expect(iso(startOfLocalDay("2026-10-25", "Europe/Brussels"))).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(startOfLocalDay("2026-10-26", "Europe/Brussels"))).toBe("2026-10-25T23:00:00.000Z");
  });

  it("starts at the first existing time where a zone skips midnight", () => {
    // Chile moves its clocks from 24:00 to 01:00.
    expect(iso(startOfLocalDay("2026-09-06", "America/Santiago"))).toBe("2026-09-06T04:00:00.000Z");
  });
});

describe("local dates", () => {
  it("assigns an instant to the calendar day of the zone", () => {
    expect(localDateOf("2026-09-29T22:30:00.000Z", "Europe/Brussels")).toBe("2026-09-30");
    expect(localDateOf("2026-09-29T22:30:00.000Z", "UTC")).toBe("2026-09-29");
  });

  it("does calendar arithmetic", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-09-01", "2026-09-30")).toBe(29);
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonth("2026-03-15", -3)).toBe("2025-12-15");
  });

  it("rejects dates that do not exist", () => {
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("30-09-2026")).toBeNull();
    expect(parseLocalDate("2026-09-30")).toEqual({ year: 2026, month: 9, day: 30 });
  });

  it("turns local days into an API range", () => {
    expect(localDayRange("2026-09-30", "2026-09-30", "Europe/Brussels")).toEqual({
      from: "2026-09-29T22:00:00.000Z",
      to: "2026-09-30T22:00:00.000Z",
    });
  });

  it("keeps a 93-day period within the API limit across the end of summer time", () => {
    const range = boundedRange("2026-08-01", addDays("2026-08-01", 92), "Europe/Brussels");
    expect(Date.parse(range.to) - Date.parse(range.from)).toBeLessThanOrEqual(93 * 86_400_000);
  });
});

describe("monthGrid", () => {
  it("lays out a month in weeks starting on the given day", () => {
    const weeks = monthGrid(2026, 9, 1);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      null,
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
    expect(weeks[4]?.[2]).toBe("2026-09-30");
    expect(monthGrid(2026, 9, 7)[0]?.[0]).toBeNull();
  });

  it("knows where weeks begin", () => {
    expect(firstDayOfWeek("en-BE")).toBe(1);
    expect(firstDayOfWeek("en-US")).toBe(7);
  });
});
