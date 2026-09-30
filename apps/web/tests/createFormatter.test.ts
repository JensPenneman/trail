import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormatter } from "../src/format/createFormatter";

describe("createFormatter", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const brussels = () => createFormatter("en-GB", "Europe/Brussels");

  it("shows times in the account's time zone, not the machine's", () => {
    expect(brussels().time("2026-09-30T12:05:09.000Z")).toBe("14:05");
    expect(createFormatter("en-GB", "America/New_York").time("2026-09-30T12:05:09.000Z")).toBe(
      "08:05",
    );
    expect(brussels().timeWithSeconds("2026-09-30T12:05:09.000Z")).toBe("14:05:09");
    expect(brussels().dateTime("2026-09-30T12:05:09.000Z")).toBe("30 Sept 2026, 14:05");
  });

  it("formats calendar dates without shifting them across midnight", () => {
    const format = createFormatter("en-GB", "Pacific/Kiritimati");
    expect(format.day("2026-09-30")).toBe("Wed 30 Sept");
    expect(format.day("2025-12-31")).toBe("Wed, 31 Dec 2025");
    expect(format.dayLong("2026-09-30")).toBe("Wednesday, 30 September 2026");
    expect(format.date("2026-09-30")).toBe("30 Sept 2026");
    expect(format.month(2026, 9)).toBe("September 2026");
  });

  it("writes distances in metres below a kilometre and kilometres above", () => {
    const format = brussels();
    expect(format.distance(850)).toBe("850 m");
    expect(format.distance(999.6)).toBe("1.0 km");
    expect(format.distance(12_345)).toBe("12.3 km");
    expect(format.distance(234_567)).toBe("235 km");
  });

  it("follows the locale's number conventions", () => {
    const belgian = createFormatter("en-BE", "Europe/Brussels");
    expect(belgian.distance(12_345)).toBe("12,3 km");
    expect(belgian.count(12_345)).toBe("12.345");
  });

  it("converts speed to km/h and battery level to a percentage", () => {
    const format = brussels();
    expect(format.speed(10)).toBe("36 km/h");
    expect(format.percent(0.84)).toBe("84%");
    expect(format.accuracy(12)).toBe("±12 m");
    expect(format.metres(11.4)).toBe("11 m");
  });

  it("describes elapsed time relative to now", () => {
    const format = brussels();
    const now = Date.parse("2026-09-30T12:00:00.000Z");
    expect(format.relative(now - 2000, now)).toBe("just now");
    expect(format.relative(now - 12_000, now)).toBe("12 sec ago");
    expect(format.relative(now - 5 * 60_000 - 3000, now)).toBe("5 min ago");
    expect(format.relative(now - 3 * 3_600_000, now)).toBe("3 hr ago");
    expect(format.relative(now - 26 * 3_600_000, now)).toBe("yesterday");
    // A small clock difference between server and browser is not "in the future".
    expect(format.relative(now + 20_000, now)).toBe("just now");
    expect(format.relative(now - 10 * 86_400_000, now)).toBe(
      format.dateTime(now - 10 * 86_400_000),
    );
  });

  it("formats durations with the largest sensible units", () => {
    const format = brussels();
    expect(format.duration(45)).toBe("45 secs");
    expect(format.duration(90)).toBe("2 mins");
    expect(format.duration(3600)).toBe("1 hr");
    expect(format.duration(3900)).toBe("1 hr 5 mins");
  });

  it("writes coordinates with hemispheres", () => {
    const format = brussels();
    expect(format.coordinates(51.05432, 3.71742)).toBe("51.0543° N, 3.7174° E");
    expect(format.coordinates(-33.4, -70.6, 5)).toBe("33.40000° S, 70.60000° W");
  });

  it("lists weekday names from the requested first day", () => {
    expect(
      brussels()
        .weekdays(1)
        .map((day) => day.short),
    ).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(brussels().weekdays(7)[0]?.long).toBe("Sunday");
  });
});
