import { describe, expect, it } from "vitest";
import { personDaysWindow } from "../../src/sharing/personDaysWindow";

const config = { staleAfterHours: 12 };
const zone = "Europe/Brussels";
const at = (iso: string) => new Date(iso);

describe("the days a share's history covers", () => {
  it("runs from the day the window begins in to today, in the person's zone", () => {
    // 22:30Z on Tuesday 27 October 2026 is 23:30 in Brussels (CET); seven days back is 22:30Z on
    // the 20th, which is 00:30 on the 21st there (CEST): the window begins on the 21st, mid-day.
    const window = personDaysWindow(7, at("2026-10-27T22:30:00Z"), zone, config);
    expect(window.from).toBe("2026-10-21");
    expect(window.to).toBe("2026-10-27");
    expect(window.partialFrom).toEqual(at("2026-10-20T22:30:00Z"));
  });

  it("belongs to the person: the same instant is another day in another zone", () => {
    const now = at("2026-10-27T23:30:00Z");
    expect(personDaysWindow(1, now, "Europe/Brussels", config).to).toBe("2026-10-28");
    expect(personDaysWindow(1, now, "America/New_York", config).to).toBe("2026-10-27");
  });

  it("has no cut first day when the window begins at midnight", () => {
    // 7 days before 2026-10-27T22:00:00Z (= 00:00 on the 28th in Brussels, CET after 25 Oct) is 2026-10-20T22:00Z,
    // 00:00 CEST on the 21st.
    const window = personDaysWindow(7, at("2026-10-27T22:00:00Z"), zone, config);
    expect(window.from).toBe("2026-10-21");
    expect(window.partialFrom).toBeNull();
  });

  it("counts days across the night summer time ends and the one it starts", () => {
    // Seven days before Monday 26 October 12:00Z is Monday 19 October 12:00Z; the 25th had 25 hours.
    const ends = personDaysWindow(7, at("2026-10-26T12:00:00Z"), zone, config);
    expect([ends.from, ends.to]).toEqual(["2026-10-19", "2026-10-26"]);
    // 30 March 2026: the 29th had 23 hours; 1 day back from 02:00Z on the 30th is 02:00Z on the 29th (04:00 CEST).
    const starts = personDaysWindow(1, at("2026-03-30T02:00:00Z"), zone, config);
    expect([starts.from, starts.to]).toEqual(["2026-03-29", "2026-03-30"]);
    expect(starts.partialFrom).toEqual(at("2026-03-29T02:00:00Z"));
  });

  it("reaches back a full thirty days when the share does", () => {
    const window = personDaysWindow(30, at("2026-10-27T12:00:00Z"), zone, config);
    expect(window.from).toBe("2026-09-27");
  });
});
