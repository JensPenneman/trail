import { describe, expect, it } from "vitest";
import { decodeGeometry } from "../../src/mapdata/geometryCodec";
import { MapDataError } from "../../src/mapdata/mapDataError";
import { decodeOplText } from "../../src/mapdata/oplText";
import { maxNodesPerWay, parseOplWay } from "../../src/mapdata/parseOplWay";
import { emptyWayCounts, type WayRow, wayRows } from "../../src/mapdata/wayRows";
import { fixtureLines, monacoManifest, papalins } from "../support/mapDataFixture";

const parsed = (line: string) => {
  const result = parseOplWay(line);
  if (!result.ok) throw new Error(`malformed: ${result.reason}`);
  return result.way;
};
const reason = (line: string) => {
  const result = parseOplWay(line);
  return result.ok ? null : result.reason;
};

describe("parseOplWay", () => {
  it("reads a way's id, kept tags, nodes and positions", () => {
    const way = parsed(
      "w4224972 Thighway=residential,name=Avenue%20%des%20%Papalins,oneway=yes,surface=asphalt Nn25177418x7.4174924y43.7296303,n4939779378x7.4174638y43.7296727",
    );
    expect(way.id).toBe(4224972);
    // Only the tags Trail keeps: surface is not one of them.
    expect(way.tags).toEqual({
      highway: "residential",
      name: "Avenue des Papalins",
      oneway: "yes",
    });
    expect(way.nodes).toEqual([25177418, 4939779378]);
    expect([...way.lonLatE7]).toEqual([74_174_924, 437_296_303, 74_174_638, 437_296_727]);
  });

  it("decodes osmium's escapes, beyond the Basic Multilingual Plane too", () => {
    expect(decodeOplText("Rue%20%de%20%l%27%%c9%glise")).toBe("Rue de l'Église");
    expect(decodeOplText("a%2c%b%3d%c%25%d%40%e")).toBe("a,b=c%d@e");
    expect(decodeOplText("%1f68b%")).toBe("🚋");
    expect(decodeOplText("plain")).toBe("plain");
    for (const broken of [
      "%zz%",
      "50%",
      "%%",
      "%0%",
      "%d800%",
      "%110000%",
      "%1234567%",
      "a\u0000b",
    ]) {
      expect(decodeOplText(broken)).toBeNull();
    }
  });

  it("reads negative, whole and short coordinates exactly, and metadata it ignores", () => {
    const way = parsed(
      "w1 v3 dV c99 t2026-10-27T00:00:00Z i5 uSomeone Thighway=path Nn1x-0.5y-12,n2x179.9999999y-0.0000001",
    );
    expect([...way.lonLatE7]).toEqual([-5_000_000, -120_000_000, 1_799_999_999, -1]);
  });

  it("takes a way without tags, which classifyWay then leaves out", () => {
    expect(parsed("w7 T Nn1x1y1,n2x2y2").tags).toEqual({});
  });

  it("refuses, per way, what is not a readable way", () => {
    expect(reason("n1 Thighway=path Nn1x1y1,n2x2y2")).toBe("not a way");
    expect(reason("w0 Thighway=path Nn1x1y1,n2x2y2")).toBe("no way id");
    expect(reason("w01 Thighway=path Nn1x1y1,n2x2y2")).toBe("no way id");
    expect(reason("w1 Thighway=path")).toBe("no nodes");
    expect(reason("w1 Thighway=path N")).toBe("no nodes");
    expect(reason("w1 Thighway=path Nn1x1y1")).toBe("fewer than two nodes");
    // osmium writes a node it has no location for as n<id>xy
    expect(reason("w1 Thighway=path Nn1x1y1,n2xy")).toBe("a node without a position");
    expect(reason("w1 Thighway=path Nn1x1y1,n2")).toBe("a node without a position");
    expect(reason("w1 Thighway=path Nn1x1y1,n2x181y0")).toBe("a node without a position");
    expect(reason("w1 Thighway=path Nn1x1y1,n2x1y90.1")).toBe("a node without a position");
    expect(reason("w1 Thighway=path Nn1x1y1,n2x1.12345678y0")).toBe("a node without a position");
    expect(reason("w1 Thighway=path Nn1x1y1,n2x1e2y0")).toBe("a node without a position");
    expect(reason("w1 Thighway=path Nn1x1y1,2x1y0")).toBe("a node reference without n");
    expect(reason("w1 Thighway=path Nn1x1y1,nx1y0")).toBe("a node without an id");
    expect(reason("w1 Thighway=path Nn1x1y1,n2x1y1,")).toBe("a node reference without n");
    expect(reason("w1 Thighway Nn1x1y1,n2x2y2")).toBe("an unreadable tag");
    expect(reason("w1 T=path Nn1x1y1,n2x2y2")).toBe("an unreadable tag");
    expect(reason("w1 Tname=%zz% Nn1x1y1,n2x2y2")).toBe("an unreadable tag");
    expect(reason("w1 Thighway=path Nn1x1y1,n2x2y2 Xnope")).toBe("a field Trail does not know");
    expect(reason("w1  Thighway=path Nn1x1y1,n2x2y2")).toBe("a field Trail does not know");
    const many = Array.from({ length: maxNodesPerWay + 1 }, (_, node) => `n${node + 1}x1y1`);
    expect(reason(`w1 Thighway=path N${many.join(",")}`)).toBe(`more than ${maxNodesPerWay} nodes`);
  });

  it("never stores a key of the file as a property of its own", () => {
    const way = parsed("w1 T__proto__=x,constructor=y,highway=path Nn1x1y1,n2x2y2");
    expect(Object.keys(way.tags)).toEqual(["highway"]);
    expect(Object.getPrototypeOf(way.tags)).toBe(Object.prototype);
  });
});

describe("wayRows", () => {
  it("classifies, bounds and counts, and drops only what it cannot read", () => {
    const counts = emptyWayCounts();
    const rows = [
      ...wayRows(
        [
          "w10 Thighway=residential,name=A Nn1x3.7y51,n2x3.7001y51.0001",
          "w11 Thighway=proposed Nn2x3.7001y51.0001,n3x3.7002y51.0002",
          "w12 Thighway=path Nn3x3.7002y51.0002",
          "w13 Trailway=tram,highway=residential Nn3x3.7002y51.0002,n4x3.7003y51",
        ],
        counts,
      ),
    ];
    expect(rows.map((row) => [row.id, row.kind])).toEqual([
      [10, "residential"],
      [13, "tram"],
    ]);
    expect(rows[0]).toMatchObject({ minLat: 51, minLon: 3.7, maxLat: 51.0001, maxLon: 3.7001 });
    expect(counts).toMatchObject({
      lines: 4,
      ways: 2,
      malformed: 1,
      unclassified: 1,
      nodeRefs: 6,
      kinds: { residential: 1, tram: 1 },
    });
  });

  it("stops at a way id that is not above the one before: a duplicate or not osmium's order", () => {
    const counts = emptyWayCounts();
    const lines = ["w20 Thighway=path Nn1x1y1,n2x1.1y1", "w20 Thighway=path Nn1x1y1,n2x1.1y1"];
    expect(() => [...wayRows(lines, counts)]).toThrow(MapDataError);
    expect(() => [...wayRows(["w19 Thighway=path Nn1x1y1,n2x1.1y1"], counts)]).toThrow(
      /not in way id order: way 19 after way 20/,
    );
  });

  it("reads the Monaco fixture as its manifest counts it, with the kinds of its README", () => {
    const counts = emptyWayCounts();
    const rows: WayRow[] = [...wayRows(fixtureLines("ways.opl.gz"), counts)];
    const manifest = monacoManifest();
    expect(counts.lines).toBe(manifest.counts.ways);
    expect(counts.nodeRefs).toBe(manifest.counts.wayNodeRefs);
    expect(counts).toMatchObject({ ways: manifest.counts.ways, malformed: 0, unclassified: 0 });
    expect(counts.kinds).toEqual({
      footway: 2382,
      service: 400,
      residential: 319,
      secondary: 215,
      primary: 149,
      tertiary: 148,
      path: 39,
      other: 13,
      rail: 11,
      ferry: 1,
    });
    const way = rows.find((row) => row.id === papalins.id);
    expect(way).toMatchObject({
      kind: papalins.kind,
      nodes: papalins.nodes,
      tags: { highway: "residential", name: papalins.name, oneway: "yes" },
    });
    expect(decodeGeometry(way?.geometry ?? Buffer.alloc(0))).toEqual(papalins.geometry);
  });
});
