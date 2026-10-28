import { describe, expect, it } from "vitest";
import { latToTileY, lonToTileX } from "../../src/heatmap/tileMath";
import { emptyPoiCounts, poiRows } from "../../src/mapdata/poiRows";
import { cruiseTerminal, fixtureLines, monacoManifest } from "../support/mapDataFixture";

const recordSeparator = "\u001e";
const feature = (geometry: unknown, properties: Record<string, unknown>, id = "x") =>
  `${recordSeparator}${JSON.stringify({ type: "Feature", id, geometry, properties })}`;

/** An airport's outline: a ring from (4.40, 50.89) to (4.52, 50.91), and an apron sticking out east. */
const outline = [
  [4.4, 50.89],
  [4.5, 50.89],
  [4.5, 50.91],
  [4.4, 50.91],
  [4.4, 50.89],
];
const apron = [
  [4.5, 50.895],
  [4.52, 50.895],
  [4.52, 50.9],
  [4.5, 50.895],
];
const hole = [
  [4.45, 50.895],
  [4.46, 50.895],
  [4.46, 50.9],
  [4.45, 50.895],
];

describe("poiRows", () => {
  it("keeps a stop's point and takes its id from @type and @id", () => {
    const counts = emptyPoiCounts();
    const rows = [
      ...poiRows(
        [
          feature(
            { type: "Point", coordinates: [7.4194983, 43.7382624] },
            {
              "@type": "node",
              "@id": 9952646938,
              railway: "station",
              name: "Monaco - Monte Carlo",
            },
          ),
        ],
        counts,
      ),
    ];
    expect(rows).toEqual([
      {
        id: "n9952646938",
        kind: "station",
        lat: 43.7382624,
        lon: 7.4194983,
        name: "Monaco - Monte Carlo",
        x: lonToTileX(7.4194983, 14),
        y: latToTileY(43.7382624, 14),
      },
    ]);
  });

  it("puts an airport mapped as an area at the centre of the box over all its rings, as Overpass's out center", () => {
    const counts = emptyPoiCounts();
    const rows = [
      ...poiRows(
        [
          // osmium writes every area as a MultiPolygon, a closed way's too; the feature id is its area number
          feature(
            { type: "MultiPolygon", coordinates: [[outline, hole]] },
            {
              "@type": "way",
              "@id": 4321,
              aeroway: "aerodrome",
              name: "Field",
            },
            "a8642",
          ),
          feature(
            { type: "MultiPolygon", coordinates: [[outline], [apron]] },
            {
              "@type": "relation",
              "@id": 77,
              aeroway: "aerodrome",
              name: "Brussels Airport",
            },
            "a155",
          ),
          feature(
            { type: "Polygon", coordinates: [outline] },
            {
              "@type": "way",
              "@id": 4322,
              aeroway: "aerodrome",
            },
          ),
        ],
        counts,
      ),
    ];
    expect(rows.map(({ id, kind, name }) => ({ id, kind, name }))).toEqual([
      { id: "w4321", kind: "aerodrome", name: "Field" },
      { id: "r77", kind: "aerodrome", name: "Brussels Airport" },
      { id: "w4322", kind: "aerodrome", name: null },
    ]);
    expect(rows[0]?.lon).toBeCloseTo(4.45, 12);
    expect(rows[0]?.lat).toBeCloseTo(50.9, 12);
    // The apron moves the box's east edge, and with it the centre: not the centroid.
    expect(rows[1]?.lon).toBeCloseTo(4.46, 12);
    expect(rows[1]?.lat).toBeCloseTo(50.9, 12);
    expect(rows[2]?.lon).toBeCloseTo(4.45, 12);
    expect(counts).toMatchObject({ features: 3, pois: 3, kinds: { aerodrome: 3 } });
  });

  it("classifies as classifyPoi does, and drops what it cannot read", () => {
    const counts = emptyPoiCounts();
    const point = { type: "Point", coordinates: [4.35, 50.85] };
    const rows = [
      ...poiRows(
        [
          feature(point, { "@type": "node", "@id": 1, railway: "station", station: "subway" }),
          feature(point, { "@type": "node", "@id": 2, highway: "bus_stop" }),
          feature(point, { "@type": "node", "@id": 3, shop: "bakery" }),
          `${recordSeparator}{"type": "Feature", "geometry": `,
          feature(
            {
              type: "LineString",
              coordinates: [
                [4, 50],
                [5, 51],
              ],
            },
            { "@type": "way", "@id": 4, aeroway: "aerodrome" },
          ),
          feature(point, { "@type": "area", "@id": 5, highway: "bus_stop" }),
          feature(point, { "@type": "node", "@id": -6, highway: "bus_stop" }),
          feature(
            { type: "Point", coordinates: [181, 0] },
            { "@type": "node", "@id": 7, highway: "bus_stop" },
          ),
          feature(point, { "@type": "node", "@id": 8, highway: "bus_stop", name: "A\u0000B" }),
          "",
          recordSeparator,
        ],
        counts,
      ),
    ];
    expect(rows.map((row) => [row.id, row.kind])).toEqual([
      ["n1", "subway_station"],
      ["n2", "bus_stop"],
    ]);
    expect(counts).toEqual({
      features: 9,
      pois: 2,
      malformed: 6,
      unclassified: 1,
      kinds: { subway_station: 1, bus_stop: 1 },
    });
  });

  it("reads only a feature's own tags", () => {
    const line = `${recordSeparator}{"type":"Feature","geometry":{"type":"Point","coordinates":[4,50]},"properties":{"@type":"node","@id":9,"__proto__":{"railway":"station"}}}`;
    const counts = emptyPoiCounts();
    expect([...poiRows([line], counts)]).toEqual([]);
    expect(counts.unclassified).toBe(1);
  });

  it("reads the Monaco fixture as its manifest counts it, the cruise terminal where it lies", () => {
    const counts = emptyPoiCounts();
    const rows = [...poiRows(fixtureLines("pois.geojsonseq.gz"), counts)];
    const manifest = monacoManifest();
    expect(counts.features).toBe(manifest.counts.pois.features);
    expect(counts.kinds).toEqual(manifest.counts.pois.kinds);
    expect(counts).toMatchObject({ malformed: 0, unclassified: 0 });
    expect(rows.find((row) => row.id === cruiseTerminal.id)).toEqual({
      ...cruiseTerminal,
      x: 8530,
      y: 5974,
    });
  });
});
