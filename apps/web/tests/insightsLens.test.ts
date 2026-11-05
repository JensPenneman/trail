import { describe, expect, it } from "vitest";
import { timeOnMap } from "../src/pages/insights/insightsLens";
import { parseInsightsAddress } from "../src/pages/insights/insightsPeriod";

const today = "2026-11-04";
const device = "01926f3c-2e5f-7a71-8243-5d6e7f8091a1";
const other = "01926f3c-2e5f-7a71-8243-5d6e7f8091a2";

const lens = (query: string) => {
  const { period, devices } = parseInsightsAddress(new URLSearchParams(query), today);
  return timeOnMap(period, devices, today);
};

describe("Insights as a lens on the map", () => {
  it.each([
    ["a complete month", "period=2026-10", "/?view=heat&heat=time&from=2026-10-01&to=2026-10-31"],
    [
      "the month that goes on, up to today",
      "",
      "/?view=heat&heat=time&from=2026-11-01&to=2026-11-04",
    ],
    ["a complete week", "period=2026-W44", "/?view=heat&heat=time&from=2026-10-26&to=2026-11-01"],
    ["the week that goes on", "period=week", "/?view=heat&heat=time&from=2026-11-02&to=2026-11-04"],
    ["a year", "period=2025", "/?view=heat&heat=time&from=2025-01-01&to=2025-12-31"],
    [
      "a custom range",
      "from=2026-10-06&to=2026-10-26",
      "/?view=heat&heat=time&from=2026-10-06&to=2026-10-26",
    ],
    [
      "a rolling period of before",
      "period=7d",
      "/?view=heat&heat=time&from=2026-10-29&to=2026-11-04",
    ],
    // All of the history: the map reads no days as the whole of it.
    ["all of the history", "period=all", "/?view=heat&heat=time"],
  ])("opens Heat of the time for %s", (_what, query, address) => {
    expect(lens(query)).toBe(address);
  });

  it("carries the devices counted, and none when all are", () => {
    expect(lens(`period=2026-10&devices=${device}`)).toBe(
      `/?view=heat&heat=time&from=2026-10-01&to=2026-10-31&devices=${device}`,
    );
    expect(lens(`period=all&devices=${device},${other}`)).toBe(
      `/?view=heat&heat=time&devices=${device}%2C${other}`,
    );
    expect(lens("period=2026-10&devices=nope")).not.toContain("devices");
  });
});
