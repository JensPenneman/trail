import { describe, expect, it } from "vitest";
import { atText, momentOf, parseAtText } from "../src/pages/map/history/parseAt";

const tz = "Europe/Brussels";

describe("?at=", () => {
  it("writes and reads a moment in the account's time zone", () => {
    const moment = momentOf("2026-10-20T14:30", tz);
    expect(moment).not.toBeNull();
    expect(atText(moment ?? 0, tz)).toBe("2026-10-20T14:30");
  });

  it("counts the time of day from the day's start, so a 25 hour day stays within its day", () => {
    const start = momentOf("2026-10-25T00:00", tz) ?? 0;
    const late = momentOf("2026-10-25T23:59", tz) ?? 0;
    expect(late - start).toBe(24 * 3600 - 60);
    expect(atText(late, tz).slice(0, 10)).toBe("2026-10-25");
  });

  it("ignores text that is not a moment", () => {
    for (const bad of ["", "2026-10-20", "2026-10-20T24:00", "2026-10-20T10:61", "x"]) {
      expect(parseAtText(bad)).toBeNull();
    }
    expect(parseAtText(null)).toBeNull();
    expect(momentOf("2026-13-40T10:00", tz)).toBeNull();
    expect(momentOf(null, tz)).toBeNull();
  });
});
