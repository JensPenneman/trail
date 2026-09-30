import { describe, expect, it } from "vitest";
import { boundsOf } from "../src/map/boundsOf";
import { circleRing } from "../src/map/circleRing";
import { heatFeatures } from "../src/map/heatFeatures";
import { heatmapParamsFor } from "../src/map/heatmapParamsFor";
import { trackFeatures } from "../src/map/trackFeatures";

describe("map helpers", () => {
  it("rounds heatmap requests outward and clamps world copies", () => {
    expect(
      heatmapParamsFor({ bounds: [3.51234, 50.98001, 3.72001, 51.05999], zoom: 11.6 }, null),
    ).toEqual({
      bbox: "3.512,50.98,3.721,51.06",
      zoom: 12,
      deviceIds: null,
    });
    expect(heatmapParamsFor({ bounds: [-200, -95, 200, 95], zoom: 0.4 }, ["a"]).bbox).toBe(
      "-180,-90,180,90",
    );
  });

  it("weights heat cells logarithmically against the busiest one", () => {
    const features = heatFeatures([
      [3.5, 51, 1],
      [3.6, 51, 1000],
    ]).features;
    expect(features[1]?.properties.weight).toBeCloseTo(1);
    expect(features[0]?.properties.weight).toBeGreaterThan(0);
    expect(features[0]?.properties.weight).toBeLessThan(0.2);
  });

  it("draws accuracy circles at their true size", () => {
    const ring = circleRing(3.5, 51, 1000, 4);
    expect(ring).toHaveLength(5);
    // North of the centre by one kilometre ≈ 0.009 degrees of latitude.
    expect((ring[0]?.[1] ?? 0) - 51).toBeCloseTo(0.009, 3);
  });

  it("skips one-point segments and computes bounds", () => {
    const collection = trackFeatures([
      {
        id: "a",
        color: "#000",
        segments: [
          [[3.5, 51]],
          [
            [3.5, 51],
            [3.6, 51.1],
          ],
        ],
      },
    ]);
    expect(collection.features).toHaveLength(1);
    expect(
      boundsOf([
        [3.5, 51],
        [3.6, 51.1],
      ]),
    ).toEqual([3.5, 51, 3.6, 51.1]);
    expect(boundsOf([])).toBeNull();
  });
});
