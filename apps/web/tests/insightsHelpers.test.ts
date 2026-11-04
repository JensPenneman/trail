import { describe, expect, it } from "vitest";
import { createFormatter } from "../src/format/createFormatter";
import { bucketLabels } from "../src/pages/insights/bucketLabels";
import { foldModes } from "../src/pages/insights/foldModes";
import { axisFormats, changeOf } from "../src/pages/insights/insightsFormat";

const format = createFormatter("en-GB", "Europe/Brussels");
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

  it("says when there was none in the days compared with", () => {
    const options = (kind: "amount" | "count") => ({ kind, format });
    expect(changeOf(12, 0, "September", options("amount"))).toEqual({
      text: "None in September",
      direction: "up",
    });
    expect(changeOf(3, 0, "the 12 days before", options("count"))?.text).toBe(
      "None in the 12 days before",
    );
    expect(changeOf(12, 100, "September", options("amount"))?.text).toBe("88% less than September");
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
