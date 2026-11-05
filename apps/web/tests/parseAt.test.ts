import { describe, expect, it } from "vitest";
import { atText, momentOf, parseAtText } from "../src/pages/map/history/parseAt";

const tz = "Europe/Brussels";

describe("?at=", () => {
  it("writes and reads a moment in the account's time zone", () => {
    const moment = momentOf("2026-10-20T14:30", tz);
    expect(moment).not.toBeNull();
    expect(atText(moment ?? 0, tz)).toBe("2026-10-20T14:30");
  });

  it("reads the wall-clock time on the day of 25 hours, as it is written", () => {
    // 2026-10-25: the clocks go back at 03:00, so the day has 25 hours.
    for (const time of ["00:00", "01:30", "02:30", "03:30", "14:00", "23:59"]) {
      const text = `2026-10-25T${time}`;
      const moment = momentOf(text, tz);
      expect(moment, text).not.toBeNull();
      expect(atText(moment ?? 0, tz), text).toBe(text);
    }
    const start = momentOf("2026-10-25T00:00", tz) ?? 0;
    expect((momentOf("2026-10-25T14:00", tz) ?? 0) - start).toBe(15 * 3600);
  });

  it("reads the wall-clock time on the day of 23 hours, and refuses the hour that is skipped", () => {
    // 2026-03-29: the clocks go forward at 02:00, so 02:30 does not exist.
    for (const time of ["00:00", "01:59", "03:00", "14:00", "23:30", "23:59"]) {
      const text = `2026-03-29T${time}`;
      const moment = momentOf(text, tz);
      expect(moment, text).not.toBeNull();
      expect(atText(moment ?? 0, tz), text).toBe(text);
    }
    expect(momentOf("2026-03-29T02:30", tz)).toBeNull();
    const start = momentOf("2026-03-29T00:00", tz) ?? 0;
    expect((momentOf("2026-03-29T14:00", tz) ?? 0) - start).toBe(13 * 3600);
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
