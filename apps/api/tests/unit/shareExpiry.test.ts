import { describe, expect, it } from "vitest";
import { localDate } from "../../src/lib/localDate";
import { endOfLocalDay, shareExpiresAt } from "../../src/sharing/shareExpiry";

const at = (iso: string) => new Date(iso);

describe("the end of a local day", () => {
  it("is the next local midnight", () => {
    expect(endOfLocalDay(at("2026-06-10T10:00:00Z"), "Europe/Brussels").toISOString()).toBe(
      "2026-06-10T22:00:00.000Z",
    );
    expect(endOfLocalDay(at("2026-06-10T10:00:00Z"), "America/New_York").toISOString()).toBe(
      "2026-06-11T04:00:00.000Z",
    );
  });

  it("follows a day of 23 hours when summer time starts", () => {
    // 29 March 2026: Brussels skips 02:00–03:00; the day began at 23:00 UTC the evening before.
    expect(endOfLocalDay(at("2026-03-29T08:00:00Z"), "Europe/Brussels").toISOString()).toBe(
      "2026-03-29T22:00:00.000Z",
    );
    expect(endOfLocalDay(at("2026-03-28T22:30:00Z"), "Europe/Brussels").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
  });

  it("follows a day of 25 hours when summer time ends", () => {
    // 25 October 2026: 02:00–03:00 happens twice; the day began at 22:00 UTC the evening before.
    expect(endOfLocalDay(at("2026-10-25T00:30:00Z"), "Europe/Brussels").toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
    expect(endOfLocalDay(at("2026-10-25T22:59:59Z"), "Europe/Brussels").toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
  });

  it("ends when the next day starts in zones that skip midnight", () => {
    // Chile and Lebanon move from 23:59:59 straight to 01:00.
    expect(endOfLocalDay(at("2026-09-05T23:00:00Z"), "America/Santiago").toISOString()).toBe(
      "2026-09-06T04:00:00.000Z",
    );
    expect(endOfLocalDay(at("2026-03-28T12:00:00Z"), "Asia/Beirut").toISOString()).toBe(
      "2026-03-28T22:00:00.000Z",
    );
  });

  it("runs a whole day from exactly midnight", () => {
    expect(endOfLocalDay(at("2026-06-10T22:00:00Z"), "Europe/Brussels").toISOString()).toBe(
      "2026-06-11T22:00:00.000Z",
    );
  });

  it("is always the first second of a later day, anywhere", () => {
    const zones = ["Europe/Brussels", "America/Santiago", "Asia/Kolkata", "Australia/Lord_Howe"];
    for (const zone of zones) {
      for (let hour = 0; hour < 24 * 400; hour += 37) {
        const now = new Date(Date.UTC(2026, 0, 1) + hour * 3_600_000 + 123_456);
        const end = endOfLocalDay(now, zone);
        expect(end.getTime(), `${zone} ${now.toISOString()}`).toBeGreaterThan(now.getTime());
        expect(localDate(new Date(end.getTime() - 1000), zone)).toBe(localDate(now, zone));
        expect(localDate(end, zone)).not.toBe(localDate(now, zone));
      }
    }
  });
});

describe("share durations", () => {
  const now = at("2026-10-26T09:41:07.000Z");

  it("count from the moment of sharing", () => {
    expect(shareExpiresAt("hour", now, "Europe/Brussels")?.toISOString()).toBe(
      "2026-10-26T10:41:07.000Z",
    );
    expect(shareExpiresAt("week", now, "Europe/Brussels")?.toISOString()).toBe(
      "2026-11-02T09:41:07.000Z",
    );
    expect(shareExpiresAt("indefinitely", now, "Europe/Brussels")).toBeNull();
  });

  it("end the owner's day in the owner's time zone", () => {
    expect(shareExpiresAt("endOfDay", now, "Europe/Brussels")?.toISOString()).toBe(
      "2026-10-26T23:00:00.000Z",
    );
    expect(shareExpiresAt("endOfDay", now, "Asia/Tokyo")?.toISOString()).toBe(
      "2026-10-26T15:00:00.000Z",
    );
  });
});
