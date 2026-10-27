import { describe, expect, it } from "vitest";
import { bandLayout, categoryAxis, groupBarThickness } from "../src/charts/bands";
import { barPath } from "../src/charts/barPath";
import type { ChartRow, ChartSeries } from "../src/charts/chartTypes";
import {
  heatBin,
  heatBounds,
  heatShade,
  heatSteps,
  legibleHeatSteps,
} from "../src/charts/heatBins";
import { markDescription } from "../src/charts/markDescription";
import { linearScale } from "../src/charts/scales";
import { stackPieces } from "../src/charts/stackPieces";
import { describeBars, describeExtremes, nothingToShow } from "../src/charts/summaries";
import { fitText, textWidth } from "../src/charts/textWidth";
import { niceTicks, tickStride } from "../src/charts/ticks";
import { toneClass } from "../src/charts/tones";
import { placeTooltip } from "../src/charts/tooltipPlacement";

const km = (metres: number) => `${Number((metres / 1000).toFixed(1))} km`;

describe("linearScale", () => {
  it("maps the domain onto the range, also upside down for a y axis", () => {
    const x = linearScale([0, 100], [40, 240]);
    expect(x(0)).toBe(40);
    expect(x(50)).toBe(140);
    expect(x(100)).toBe(240);
    const y = linearScale([0, 10], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(2.5)).toBe(150);
  });

  it("puts everything at the start of the range for a collapsed domain", () => {
    const scale = linearScale([0, 0], [10, 90]);
    expect(scale(0)).toBe(10);
    expect(scale(5)).toBe(10);
    expect(Number.isNaN(linearScale([0, Number.NaN], [0, 1])(3))).toBe(false);
  });
});

describe("niceTicks", () => {
  it("steps by 1, 2 or 5 × 10ⁿ from 0 to at least the largest value", () => {
    expect(niceTicks(7, 4)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(12_345, 4)).toEqual([0, 5000, 10_000, 15_000]);
    expect(niceTicks(0.4, 4)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(niceTicks(1.1, 4)).toEqual([0, 0.5, 1, 1.5]);
    expect(niceTicks(0.003, 3)).toEqual([0, 0.001, 0.002, 0.003]);
  });

  it("ends exactly on a power of ten", () => {
    expect(niceTicks(1, 4)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(10, 4)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(1000, 5)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(niceTicks(10_000, 2)).toEqual([0, 5000, 10_000]);
  });

  it("gives a usable axis for nothing at all", () => {
    expect(niceTicks(0, 4)).toEqual([0, 1]);
    expect(niceTicks(-3, 4)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN, 4)).toEqual([0, 1]);
    expect(niceTicks(Number.POSITIVE_INFINITY, 4)).toEqual([0, 1]);
    expect(niceTicks(5, 0)).toEqual([0, 5]);
  });

  it("keeps the steps whole for counts", () => {
    expect(niceTicks(3, 4, { integer: true })).toEqual([0, 1, 2, 3]);
    expect(niceTicks(1, 4, { integer: true })).toEqual([0, 1]);
    expect(niceTicks(0.3, 4, { integer: true })).toEqual([0, 1]);
    expect(niceTicks(7, 4, { integer: true })).toEqual([0, 2, 4, 6, 8]);
  });

  it("always reaches the largest value on round steps", () => {
    for (const max of [0.07, 0.9, 3.3, 42, 99, 101, 777, 2_500, 86_400, 1.5e6]) {
      const ticks = niceTicks(max, 4);
      const step = ticks[1] ?? 0;
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(max);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks.length).toBeLessThanOrEqual(8);
      const leading = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(leading));
    }
  });
});

describe("tickStride", () => {
  it("thins labels until they no longer touch", () => {
    // 24 hours across a phone's 228 px: 9.5 px apart, labels like "00" about 15 px wide.
    expect(tickStride(9.5, 15)).toBe(3);
    expect(tickStride(25, 15)).toBe(1);
    expect(tickStride(12, 15)).toBe(2);
    // A month of days ("Mon 26", about 43 px) on a phone: a label a week.
    expect(tickStride(7.5, 43)).toBe(7);
    expect(tickStride(7, 43)).toBe(12);
  });

  it("falls back to whatever stride fits past the round ones", () => {
    expect(tickStride(0.5, 300)).toBe(616);
    expect(tickStride(0, 20)).toBe(1);
  });
});

describe("bandLayout", () => {
  it("never makes a bar thicker than 24 px or as wide as its band", () => {
    expect(bandLayout(7, 700)).toEqual({ step: 100, thickness: 24 });
    const hours = bandLayout(24, 600);
    expect(hours.step).toBe(25);
    expect(hours.thickness).toBeCloseTo(15.5);
    const narrow = bandLayout(31, 217);
    expect(narrow.thickness).toBeLessThan(narrow.step);
    expect(bandLayout(100, 150).thickness).toBe(1);
  });

  it("has nothing to lay out without bands or room", () => {
    expect(bandLayout(0, 600)).toEqual({ step: 0, thickness: 0 });
    expect(bandLayout(5, 0)).toEqual({ step: 0, thickness: 0 });
  });

  it("shares a group's thickness between its bars, with the surface gap between them", () => {
    expect(groupBarThickness(50, 2)).toBe(24);
    expect(groupBarThickness(20, 1)).toBe(20);
    expect(groupBarThickness(3, 4)).toBe(1);
  });
});

describe("categoryAxis", () => {
  it("shows every 3rd hour of a day on a phone, every hour on a wide screen", () => {
    const hours = Array.from({ length: 24 }, (_, hour) =>
      textWidth(String(hour).padStart(2, "0"), 12),
    );
    const phone = categoryAxis({ width: 288, left: 40, right: 4, labelWidths: hours });
    expect(phone.stride).toBe(3);
    expect(phone.step * 24).toBeCloseTo(288 - phone.left - phone.right);
    expect(categoryAxis({ width: 900, left: 40, right: 4, labelWidths: hours }).stride).toBe(1);
  });

  it("widens the margins so that the first and last label shown stay inside", () => {
    const labels = [80, 20, 20, 80];
    const axis = categoryAxis({ width: 200, left: 0, right: 0, labelWidths: labels });
    expect(axis.left + axis.step / 2).toBeGreaterThanOrEqual(40);
    const last = Math.floor((labels.length - 1) / axis.stride) * axis.stride;
    expect(axis.left + axis.step * (last + 0.5) + (labels[last] ?? 0) / 2).toBeLessThanOrEqual(200);
  });

  it("puts edge labels on the band edges, one more than bands", () => {
    const axis = categoryAxis({
      width: 400,
      left: 30,
      right: 10,
      labelWidths: [10, 10, 10, 10, 10],
      edges: true,
    });
    expect(axis.step).toBe(90);
    expect(categoryAxis({ width: 400, left: 30, right: 10, labelWidths: [] }).step).toBe(0);
  });
});

describe("categoryAxis at every width", () => {
  /** Whether the labels shown fit inside the chart and keep their distance. */
  function fits(labelWidths: number[], edges: boolean, left: number) {
    for (let width = 200; width <= 900; width += 1) {
      const axis = categoryAxis({ width, left, right: 4, labelWidths, edges });
      const shift = edges ? 0 : 0.5;
      const last = Math.floor((labelWidths.length - 1) / axis.stride) * axis.stride;
      const at = (index: number) => axis.left + axis.step * (index + shift);
      const widest = Math.max(...labelWidths);
      if (at(0) - (labelWidths[0] ?? 0) / 2 < -0.5) return `first label out at ${width}`;
      if (at(last) + (labelWidths[last] ?? 0) / 2 > width + 0.5)
        return `last label out at ${width}`;
      if (axis.stride > 1 && axis.stride * axis.step < widest + 7)
        return `labels touch at ${width}`;
    }
    return "fits";
  }

  it("keeps the first and the last label of a month of days inside, whatever the width", () => {
    const names = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    const days = Array.from({ length: 31 }, (_, day) =>
      textWidth(`${names[day % 7]} ${day + 1}`, 12),
    );
    expect(fits(days, false, 47)).toBe("fits");
    expect(fits(days, false, 40)).toBe("fits");
  });

  it("keeps the bin edges of a histogram inside, whatever the width", () => {
    const edges = Array.from({ length: 21 }, (_, index) => textWidth(String(index * 10), 12));
    expect(fits(edges, true, 30)).toBe("fits");
  });
});

describe("stackPieces", () => {
  it("stacks in series order with a 2 px gap between neighbours and none at the ends", () => {
    const y = linearScale([0, 100], [200, 0]);
    const pieces = stackPieces([50, 0, 25], y);
    expect(pieces).toEqual([
      { series: 0, start: 200, end: 101 },
      { series: 2, start: 99, end: 50 },
    ]);
  });

  it("drops slivers too thin to draw", () => {
    const x = linearScale([0, 1000], [0, 100]);
    expect(stackPieces([990, 10], x).map((piece) => piece.series)).toEqual([0]);
  });
});

describe("barPath", () => {
  it("rounds the data end and keeps the baseline square", () => {
    expect(barPath({ x: 10, y: 20, width: 12, height: 80 }, "top")).toBe(
      "M10 100V24A4 4 0 0 1 14 20H18A4 4 0 0 1 22 24V100Z",
    );
    expect(barPath({ x: 0, y: 10, width: 50, height: 20 }, "right")).toBe(
      "M0 10H46A4 4 0 0 1 50 14V26A4 4 0 0 1 46 30H0Z",
    );
    expect(barPath({ x: 1, y: 2, width: 3, height: 4 }, "none")).toBe("M1 2H4V6H1Z");
  });

  it("never rounds more than a thin or short bar allows", () => {
    expect(barPath({ x: 0, y: 0, width: 4, height: 1 }, "top")).toBe(
      "M0 1V1A1 1 0 0 1 1 0H3A1 1 0 0 1 4 1V1Z",
    );
  });
});

describe("placeTooltip", () => {
  const bounds = { width: 300, height: 200 };
  const size = { width: 100, height: 40 };

  it("goes beside the mark where it fits, else flips to the other side", () => {
    expect(
      placeTooltip({ x: 50, y: 60, width: 20, height: 100 }, size, bounds, ["right", "left"]),
    ).toEqual({
      left: 78,
      top: 60,
    });
    expect(
      placeTooltip({ x: 250, y: 60, width: 20, height: 100 }, size, bounds, ["right", "left"]),
    ).toEqual({
      left: 142,
      top: 60,
    });
  });

  it("goes above or below a small mark, centred and inside the box", () => {
    expect(placeTooltip({ x: 0, y: 100, width: 10, height: 10 }, size, bounds, ["top"])).toEqual({
      left: 0,
      top: 52,
    });
    expect(
      placeTooltip({ x: 100, y: 5, width: 10, height: 10 }, size, bounds, ["top", "bottom"]),
    ).toEqual({
      left: 55,
      top: 23,
    });
  });

  it("lines up beside the mark with the given level", () => {
    expect(
      placeTooltip({ x: 50, y: 150, width: 20, height: 40 }, size, bounds, ["right"], {
        level: 10,
      }),
    ).toEqual({ left: 78, top: 10 });
  });

  it("goes above or below the mark when it fits nowhere, never over it nor past the sides", () => {
    // A small plot on a phone: a cell near the top, the tooltip as wide as the box.
    const small = { width: 120, height: 80 };
    const wide = { width: 110, height: 50 };
    expect(
      placeTooltip({ x: 50, y: 20, width: 8, height: 8 }, wide, small, ["top", "bottom", "right"]),
    ).toEqual({
      left: 0,
      top: 36,
    });
    expect(
      placeTooltip({ x: 50, y: 60, width: 8, height: 8 }, wide, small, ["top", "bottom"]),
    ).toEqual({
      left: 0,
      top: 2,
    });
    const spot = placeTooltip({ x: 0, y: 0, width: 300, height: 200 }, size, bounds, [
      "right",
      "left",
    ]);
    expect(spot.left).toBeGreaterThanOrEqual(0);
    expect(spot.left + size.width).toBeLessThanOrEqual(bounds.width);
    expect(spot.top).toBe(-48);
  });
});

describe("heat bins", () => {
  it("bins (0, max] in equal steps and keeps 0 apart", () => {
    expect(heatBin(0, 10, 5)).toBe(0);
    expect(heatBin(0.01, 10, 5)).toBe(1);
    expect(heatBin(2, 10, 5)).toBe(1);
    expect(heatBin(2.0001, 10, 5)).toBe(2);
    expect(heatBin(10, 10, 5)).toBe(5);
    expect(heatBin(0.3, 0.9, 3)).toBe(1);
    expect(heatBin(12, 10, 5)).toBe(5);
    expect(heatBin(5, 0, 5)).toBe(0);
    expect(heatBin(Number.NaN, 10, 5)).toBe(0);
  });

  it("gives every bin's upper bound", () => {
    expect(heatBounds(10, 5)).toEqual([2, 4, 6, 8, 10]);
    expect(heatBounds(9, 3)).toEqual([3, 6, 9]);
  });

  it("spreads fewer bins over the five shades, and keeps the steps between 1 and 5", () => {
    expect([1, 2, 3, 4, 5].map((bin) => heatShade(bin, 5))).toEqual([1, 2, 3, 4, 5]);
    expect([1, 2, 3].map((bin) => heatShade(bin, 3))).toEqual([1, 3, 5]);
    expect([1, 2].map((bin) => heatShade(bin, 2))).toEqual([1, 5]);
    expect(heatShade(1, 1)).toBe(5);
    expect(heatShade(0, 5)).toBe(0);
    expect(heatSteps()).toBe(5);
    expect(heatSteps(3)).toBe(3);
    expect(heatSteps(9)).toBe(5);
    expect(heatSteps(0)).toBe(1);
    expect(heatSteps(Number.NaN)).toBe(5);
  });
});

describe("legibleHeatSteps", () => {
  const minutes = (seconds: number) => `${Math.round(seconds / 60)} min`;
  const whole = (count: number) => String(Math.round(count));

  it("uses fewer shades when the formatter would round bounds together", () => {
    // A boat week: one 2-minute ferry ride.
    expect(legibleHeatSteps(120, 5, minutes)).toBe(2);
    expect(legibleHeatSteps(3, 5, whole)).toBe(3);
    expect(legibleHeatSteps(0.4, 5, whole)).toBe(1);
  });

  it("keeps every shade where the bounds read apart", () => {
    expect(legibleHeatSteps(3000, 5, minutes)).toBe(5);
    expect(legibleHeatSteps(3000, 3, minutes)).toBe(3);
  });
});

describe("text width", () => {
  it("estimates wider text as wider and scales with the size", () => {
    expect(textWidth("Residential", 14)).toBeGreaterThan(textWidth("Path", 14));
    expect(textWidth("00", 24)).toBeCloseTo(textWidth("00", 12) * 2);
    expect(textWidth("", 12)).toBe(0);
  });

  it("cuts text that does not fit with an ellipsis", () => {
    const label = "Residential streets and service roads";
    const cut = fitText(label, 100, 14);
    expect(cut.endsWith("…")).toBe(true);
    expect(textWidth(cut, 14)).toBeLessThanOrEqual(100);
    expect(label.startsWith(cut.slice(0, -1))).toBe(true);
    expect(fitText("Motorway", 100, 14)).toBe("Motorway");
    expect(fitText("Motorway", 2, 14)).toBe("…");
  });
});

describe("summaries", () => {
  const series: ChartSeries[] = [
    { key: "car", label: "Car", tone: "car" },
    { key: "train", label: "Train", tone: "train" },
  ];
  const rows: ChartRow[] = [
    { key: "mon", label: "Monday", values: [12_300, 30_000] },
    { key: "tue", label: "Tuesday", values: [0, 5_000] },
    { key: "wed", label: "Wednesday", values: [Number.NaN, 700] },
  ];

  it("describes bars: the highest row, the total and the leading series", () => {
    expect(describeBars(rows, series, km)).toBe(
      "Highest: Monday, 42.3 km. Total 48 km. Most: Train, 35.7 km.",
    );
    expect(describeBars(rows, series.slice(0, 1), km)).toBe(
      "Highest: Monday, 12.3 km. Total 12.3 km.",
    );
  });

  it("describes the extremes of any set of values", () => {
    expect(
      describeExtremes(
        [
          { label: "Monday", value: 12_300 },
          { label: "Sunday", value: 1_200 },
          { label: "Friday", value: 4_000 },
        ],
        km,
      ),
    ).toBe("Highest: Monday, 12.3 km. Lowest: Sunday, 1.2 km.");
    expect(describeExtremes([{ label: "Monday", value: 5_000 }], km)).toBe("Monday: 5 km.");
    expect(
      describeExtremes(
        [
          { label: "Monday", value: 5_000 },
          { label: "Tuesday", value: 5_000 },
        ],
        km,
      ),
    ).toBe("All the same: 5 km.");
  });

  it("says there is nothing to show rather than describing zeros", () => {
    expect(describeBars([], series, km)).toBe(nothingToShow);
    expect(describeBars([{ key: "x", label: "X", values: [0, 0] }], series, km)).toBe(
      nothingToShow,
    );
    expect(describeExtremes([], km)).toBe(nothingToShow);
    expect(describeExtremes([{ label: "Monday", value: 0 }], km)).toBe(nothingToShow);
  });

  it("puts a mark's values into words, the total last", () => {
    expect(
      markDescription({
        title: "Monday",
        keyed: true,
        entries: [
          { key: "car", label: "Car", value: "12.3 km", tone: "car" },
          { key: "train", label: "Train", value: "30 km", tone: "train" },
        ],
        total: "42.3 km",
      }),
    ).toBe("Car 12.3 km, Train 30 km, total 42.3 km");
    expect(
      markDescription({
        title: "Monday",
        keyed: false,
        entries: [{ key: "v", label: "", value: "3 rides", tone: "accent" }],
      }),
    ).toBe("3 rides");
    expect(markDescription({ title: "Monday", keyed: true, entries: [], total: "0 m" })).toBe(
      "Total 0 m",
    );
  });
});

describe("toneClass", () => {
  it("names a mode's swatch, the accent, muted or a categorical slot", () => {
    expect(toneClass("train")).toBe("mode-color-train");
    expect(toneClass("accent")).toBe("chart-tone-accent");
    expect(toneClass("muted")).toBe("chart-tone-muted");
    expect(toneClass("category-3")).toBe("chart-tone-category-3");
  });
});
