import { describe, expect, it } from "vitest";
import { createFormatter } from "../src/format/createFormatter";
import { bucketLabels } from "../src/pages/insights/bucketLabels";
import { foldModes } from "../src/pages/insights/foldModes";
import { axisFormats, changeOf } from "../src/pages/insights/insightsFormat";
import {
  insightsLink,
  insightsParams,
  insightsRange,
  isInsightsRange,
  parseInsightsSearch,
  periodPhrase,
  withDevices,
  withMode,
  withPeriod,
} from "../src/pages/insights/insightsSearch";
import { moveOnMap } from "../src/pages/insights/TopMoves";

const format = createFormatter("en-GB", "Europe/Brussels");
const search = (query: string) => parseInsightsSearch(new URLSearchParams(query));
const device = "01926f3c-2e5f-7a71-8243-5d6e7f8091a1";

describe("the address of Insights", () => {
  it("reads a period by name, a custom range, devices and a mode, defensively", () => {
    expect(search("")).toEqual({
      period: "30d",
      from: null,
      to: null,
      devices: null,
      mode: null,
    });
    expect(search("period=7d&mode=cycling").period).toBe("7d");
    expect(search("period=7d&mode=cycling").mode).toBe("cycling");
    expect(search("period=fortnight&mode=hovercraft")).toMatchObject({ period: "30d", mode: null });
    expect(search("from=2026-10-01&to=2026-10-26")).toMatchObject({
      period: "custom",
      from: "2026-10-01",
      to: "2026-10-26",
    });
    // A range the API would refuse is the default instead.
    expect(search("from=2026-10-26&to=2026-10-01").period).toBe("30d");
    expect(search("from=2019-01-01&to=2026-10-26").period).toBe("30d");
    expect(search(`devices=${device.toUpperCase()},nope,${device}`).devices).toEqual([device]);
    expect(isInsightsRange("2023-10-28", "2026-10-27")).toBe(true);
    expect(isInsightsRange("2023-10-27", "2026-10-27")).toBe(false);
  });

  it("turns the period into the days the API takes", () => {
    const today = "2026-10-27";
    expect(insightsRange(search("period=7d"), today)).toEqual({ from: "2026-10-21", to: today });
    expect(insightsRange(search(""), today)).toEqual({ from: "2026-09-28", to: today });
    expect(insightsRange(search("period=90d"), today)).toEqual({ from: "2026-07-30", to: today });
    expect(insightsRange(search("period=year"), today)).toEqual({ from: "2026-01-01", to: today });
    expect(insightsRange(search("period=all"), today)).toEqual({ from: null, to: today });
    expect(insightsParams(search(`period=all&devices=${device}&mode=car`), today, true)).toEqual({
      from: null,
      to: today,
      deviceIds: [device],
      mode: "car",
    });
    expect(insightsParams(search("mode=car"), today).mode).toBeNull();
  });

  it("names the period in words", () => {
    expect(periodPhrase(search("period=year"), format)).toBe("this year");
    expect(periodPhrase(search("from=2026-10-01&to=2026-10-26"), format)).toBe(
      "1 Oct 2026 – 26 Oct 2026",
    );
    expect(periodPhrase(search("from=2026-10-26&to=2026-10-26"), format)).toBe("26 Oct 2026");
  });

  it("changes one parameter at a time and keeps the rest in links", () => {
    const current = new URLSearchParams(`period=7d&devices=${device}&mode=car&view=x`);
    expect(withPeriod(current, { period: "30d" }).toString()).toBe(
      `devices=${device}&mode=car&view=x`,
    );
    expect(withPeriod(current, { from: "2026-10-01", to: "2026-10-26" }).get("period")).toBeNull();
    expect(withDevices(current, null).has("devices")).toBe(false);
    expect(withMode(current, null).has("mode")).toBe(false);
    expect(insightsLink("/insights", current)).toBe(`/insights?period=7d&devices=${device}`);
    expect(insightsLink("/insights/time", current, { keepMode: true })).toBe(
      `/insights/time?period=7d&devices=${device}&mode=car`,
    );
    expect(insightsLink("/insights", new URLSearchParams())).toBe("/insights");
  });

  it("links a move to its local day on the map", () => {
    const move = {
      segmentId: "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d4e",
      deviceId: device,
      // 00:30 local time on the 27th.
      startedAt: "2026-10-26T23:30:00.000Z",
      endedAt: "2026-10-27T00:10:00.000Z",
      distanceM: 1,
      durationS: 2400,
      avgSpeedKmh: 0,
      maxSpeedKmh: 0,
    };
    expect(moveOnMap(move, "Europe/Brussels")).toBe(
      "/?view=history&date=2026-10-27&segment=019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d4e",
    );
  });
});

describe("Insights' words and numbers", () => {
  it("says how a number changed against the period before", () => {
    const options = (kind: "amount" | "count") => ({ kind, format });
    expect(changeOf(110, 100, "the 7 days before", options("amount"))).toEqual({
      text: "10% more than the 7 days before",
      direction: "up",
    });
    expect(changeOf(50, 100, "the 7 days before", options("amount"))?.text).toBe(
      "50% less than the 7 days before",
    );
    expect(changeOf(100.2, 100, "the 7 days before", options("amount"))).toEqual({
      text: "About the same as the 7 days before",
      direction: "flat",
    });
    expect(changeOf(3, 5, "the day before", options("count"))).toEqual({
      text: "2 fewer than the day before",
      direction: "down",
    });
    expect(changeOf(4, 4, "the day before", options("count"))?.direction).toBe("flat");
    expect(changeOf(0, 0, "the day before", options("count"))).toBeNull();
  });

  it("writes compact ticks", () => {
    const axes = axisFormats(format);
    expect(axes.distance(0)).toBe("0");
    expect(axes.distance(500)).toBe("500 m");
    expect(axes.distance(12_500)).toBe("12.5 km");
    expect(axes.duration(1800)).toBe("30 mins");
    expect(axes.duration(5400)).toBe("1.5 hrs");
  });

  it("names the steps of a series", () => {
    expect(bucketLabels("day", "en-GB").label("2026-10-26")).toBe("Monday, 26 October 2026");
    expect(bucketLabels("day", "en-GB").tick("2026-10-26")).toBe("Mon 26");
    expect(bucketLabels("week", "en-GB").label("2026-10-26")).toBe("Week of 26 October 2026");
    expect(bucketLabels("month", "en-GB").label("2026-10-01")).toBe("October 2026");
  });

  it("folds the smallest modes into one past seven, colours kept by mode", () => {
    const modes = (
      ["walking", "cycling", "car", "bus", "train", "tram", "metro", "boat"] as const
    ).map((mode, index) => ({ mode, distanceM: (index + 1) * 1000 }));
    expect(foldModes(modes)).toEqual({
      shown: ["car", "bus", "tram", "metro", "train", "boat"],
      folded: ["walking", "cycling"],
    });
    expect(foldModes(modes.slice(0, 7)).folded).toEqual([]);
    expect(foldModes(modes.slice(0, 2)).shown).toEqual(["walking", "cycling"]);
  });
});
