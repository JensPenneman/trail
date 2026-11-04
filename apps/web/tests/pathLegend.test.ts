import { describe, expect, it } from "vitest";
import { createFormatter } from "../src/format/createFormatter";
import type { PathColouring } from "../src/map/pathColour/pathColours";
import { pathLegend } from "../src/map/pathColour/pathLegend";
import { speedRamp, timeTones } from "../src/map/pathColour/pathPalette";

const format = createFormatter("en-GB", "Europe/Brussels");
const colouring = (by: PathColouring["by"], extra: Partial<PathColouring> = {}): PathColouring => ({
  by,
  dark: false,
  timeZone: "Europe/Brussels",
  ...extra,
});
const drawn = {
  deviceIds: ["a", "b", "a"],
  modes: new Set(["walking" as const]),
  review: true,
  stopPaths: false,
  gaps: true,
};

describe("the legend of a colouring", () => {
  it("has the speed key with its five steps in the ramp's colours, slower to faster", () => {
    const legend = pathLegend(colouring("speed"), drawn, format);
    expect(legend.key?.title).toBe("Speed");
    expect(legend.key?.steps.map((step) => step.label)).toEqual([
      "under 6 km/h",
      "6–15",
      "15–30",
      "30–70",
      "70 km/h or more",
    ]);
    expect(legend.key?.steps.map((step) => step.color)).toEqual(speedRamp.light);
    expect(legend.key?.ends).toEqual(["Slower", "Faster"]);
    expect(legend.classes).toEqual([]);
  });

  it("takes the dark ramp on a dark map, and is a pace key where everything is on foot", () => {
    expect(
      pathLegend(colouring("speed", { dark: true }), drawn, format).key?.steps.map(
        (step) => step.color,
      ),
    ).toEqual(speedRamp.dark);
    const pace = pathLegend(colouring("speed", { onFoot: true }), drawn, format).key;
    expect(pace?.title).toBe("Pace");
    expect(pace?.steps.map((step) => step.label)).toEqual([
      "slower than 12:00 /km",
      "12:00 /km to 9:00 /km",
      "9:00 /km to 7:00 /km",
      "7:00 /km to 5:30 /km",
      "faster than 5:30 /km",
    ]);
  });

  it("names the four times of day with their hours and their tones", () => {
    const legend = pathLegend(colouring("time"), drawn, format);
    expect(legend.key).toBeNull();
    expect(legend.classes.map((item) => item.label)).toEqual([
      "Night 22–06",
      "Morning 06–12",
      "Afternoon 12–18",
      "Evening 18–22",
    ]);
    expect(legend.classes.map((item) => item.color)).toEqual(timeTones.light);
  });

  it("has no key for mode or device, and carries what is drawn: devices once, modes, line styles", () => {
    for (const by of ["mode", "device"] as const) {
      const legend = pathLegend(colouring(by), drawn, format);
      expect(legend.key).toBeNull();
      expect(legend.classes).toEqual([]);
      expect(legend.by).toBe(by);
    }
    const legend = pathLegend(colouring("device"), drawn, format);
    expect(legend.deviceIds).toEqual(["a", "b", "a"]);
    expect(legend.modes).toEqual(new Set(["walking"]));
    expect(legend.lineStyles).toEqual({ review: true, stopPaths: false, gaps: true });
  });
});
