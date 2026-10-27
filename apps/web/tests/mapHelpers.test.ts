import { describe, expect, it } from "vitest";
import { accuracyFeatures } from "../src/map/accuracyFeatures";
import { boundsOf } from "../src/map/boundsOf";
import { circleRing } from "../src/map/circleRing";
import { heatFeatures } from "../src/map/heatFeatures";
import { heatmapParamsFor } from "../src/map/heatmapParamsFor";
import { rasterStyle } from "../src/map/rasterStyle";
import { trackFeatures } from "../src/map/trackFeatures";
import { personPositions } from "../src/people/personPositions";
import { levelTracksToMap } from "../src/transport/levelTracksToMap";
import { ana, bob, ids, levelTracks } from "./support/fixtures";

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

  it("caps a GPS guess's circle, never a share's precision", () => {
    const radiusOf = (feature: { geometry: { coordinates: number[][][] } } | undefined) =>
      ((feature?.geometry.coordinates[0]?.[0]?.[1] ?? 51) - 51) * 111_320;
    const [guess, area] = accuracyFeatures([
      { id: "a", color: "#000", slot: 0, lon: 3.5, lat: 51, accuracy: 9000, live: false },
      {
        id: "b",
        color: "#000",
        slot: 0,
        lon: 3.5,
        lat: 51,
        accuracy: 9000,
        live: false,
        coarse: true,
      },
    ]).features;
    expect(radiusOf(guess)).toBeCloseTo(5000, -2);
    expect(radiusOf(area)).toBeCloseTo(9000, -2);
  });

  it("places people by their initials, coarse where their share is", () => {
    const colors = { slot: () => 2, hex: () => "#123456" };
    const positions = personPositions(
      [ana(), bob()],
      (userId) => (userId === ids.ana ? [ids.anaPhone] : [ids.bobPhone]),
      colors,
      () => true,
    );
    expect(positions).toEqual([
      expect.objectContaining({ id: `${ids.ana}:${ids.anaPhone}`, initials: "AB", coarse: false }),
      expect.objectContaining({
        id: `${ids.bob}:${ids.bobPhone}`,
        initials: "B",
        coarse: true,
        accuracy: 556,
      }),
    ]);
    expect(
      personPositions(
        [ana()],
        () => [],
        colors,
        () => true,
      ),
    ).toEqual([]);
  });

  it("turns a raster tile template into a style, with its credit as text", () => {
    const style = rasterStyle(
      "https://imagery.example.com/{z}/{x}/{y}.jpg",
      'Imagery <b>"X"</b> & Co',
    );
    expect(style.sources["imagery"]).toEqual({
      type: "raster",
      tiles: ["https://imagery.example.com/{z}/{x}/{y}.jpg"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery &lt;b&gt;&quot;X&quot;&lt;/b&gt; &amp; Co",
    });
    expect(style.layers).toEqual([{ id: "imagery", type: "raster", source: "imagery" }]);
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

describe("levelTracksToMap", () => {
  const colors = { device: () => "#device", mode: (mode: string) => `#${mode}` };

  it("colours stops and moves by mode, unprocessed track by device", () => {
    const response = levelTracks(
      "2026-09-29T22:00:00.000Z",
      "2026-09-30T22:00:00.000Z",
      "inferred",
    );
    const [, move] = response.segments;
    if (move === undefined) throw new Error("no move in the fixture");
    const unprocessed = {
      ...move,
      id: null,
      kind: "track" as const,
      mode: null,
      needsReview: false,
    };
    const { tracks, transport } = levelTracksToMap(
      { ...response, segments: [...response.segments, unprocessed] },
      colors,
    );
    expect(tracks).toEqual([]);
    expect(
      transport.map((segment) => [segment.kind, segment.color, segment.selectable, segment.review]),
    ).toEqual([
      ["stop", "#stationary", true, false],
      ["move", "#train", true, true],
      ["track", "#device", false, false],
    ]);
  });

  it("gives tracks in device colours at the other levels", () => {
    const response = levelTracks("2026-09-29T22:00:00.000Z", "2026-09-30T22:00:00.000Z", "mapped");
    const { tracks, transport } = levelTracksToMap(response, colors);
    expect(transport).toEqual([]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.segments[0]).toHaveLength(3);
  });
});
