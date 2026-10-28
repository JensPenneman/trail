import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MapDataError } from "../../src/mapdata/mapDataError";
import { parseRegionPoly } from "../../src/mapdata/regionPoly";
import { monacoDir } from "../support/mapDataFixture";

const poly = (...sections: string[]) => ["test", ...sections, "END", ""].join("\n");
const ring = (name: string, points: [number, number][]) =>
  [
    name,
    ...points.map(
      ([lon, lat]) =>
        `   ${lon.toExponential(6).toUpperCase()}   ${lat.toExponential(6).toUpperCase()}`,
    ),
    "END",
  ].join("\n");

describe("parseRegionPoly", () => {
  it("reads Geofabrik's polygon of Monaco: one closed ring and its box", () => {
    const outline = parseRegionPoly(readFileSync(`${monacoDir}/region.poly`, "utf8"));
    expect(outline.polygon.type).toBe("MultiPolygon");
    expect(outline.polygon.coordinates).toHaveLength(1);
    const [rings] = outline.polygon.coordinates;
    expect(rings).toHaveLength(1);
    const points = rings?.[0] ?? [];
    expect(points.length).toBeGreaterThan(10);
    expect(points[0]).toEqual(points.at(-1));
    expect(points[0]).toEqual([7.456283, 43.74326]);
    expect(outline).toMatchObject({
      minLon: 7.408583,
      minLat: 43.48382,
      maxLon: 7.595671,
      maxLat: 43.75293,
    });
  });

  it("closes open rings and puts a hole with the outline around it", () => {
    const outline = parseRegionPoly(
      poly(
        ring("1", [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ]),
        ring("2", [
          [20, 0],
          [30, 0],
          [30, 10],
          [20, 0],
        ]),
        ring("!3", [
          [22, 1],
          [28, 1],
          [28, 2],
        ]),
      ),
    );
    expect(outline.polygon.coordinates).toEqual([
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
      [
        [
          [20, 0],
          [30, 0],
          [30, 10],
          [20, 0],
        ],
        [
          [22, 1],
          [28, 1],
          [28, 2],
          [22, 1],
        ],
      ],
    ]);
    expect(outline).toMatchObject({ minLon: 0, minLat: 0, maxLon: 30, maxLat: 10 });
  });

  it("refuses what is not a polygon file", () => {
    for (const text of [
      "",
      "name",
      poly(),
      [
        "test",
        ring("1", [
          [0, 0],
          [1, 0],
          [1, 1],
        ]),
      ].join("\n"),
      poly(
        ring("1", [
          [0, 0],
          [1, 1],
        ]),
      ),
      poly("1\n   0 0\n   1 0\n   1 1"),
      poly("1\n   0 0 0\n   1 0\n   1 1\nEND"),
      poly("1\n   0 0\n   1 north\n   1 1\nEND"),
      poly("1\n   0 0\n   181 0\n   1 1\nEND"),
      `${poly(
        ring("1", [
          [0, 0],
          [1, 0],
          [1, 1],
        ]),
      )}garbage\n`,
      poly(
        ring("1", [
          [0, 0],
          [1, 0],
          [1, 1],
        ]),
        ring("!2", [
          [5, 5],
          [6, 5],
          [6, 6],
        ]),
      ),
    ]) {
      expect(() => parseRegionPoly(text)).toThrow(MapDataError);
    }
  });
});
