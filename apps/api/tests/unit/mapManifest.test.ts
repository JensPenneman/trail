import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSource, partitionName } from "../../src/mapdata/buildPartitions";
import { MapDataError } from "../../src/mapdata/mapDataError";
import { readManifest } from "../../src/mapdata/mapManifest";
import { monacoDir } from "../support/mapDataFixture";

const fixture = (): Record<string, unknown> =>
  JSON.parse(readFileSync(`${monacoDir}/manifest.json`, "utf8")) as Record<string, unknown>;

describe("readManifest", () => {
  it("reads the fixture's region, extract, build id, counts and files", () => {
    const manifest = readManifest(fixture());
    expect(manifest).toMatchObject({
      region: "monaco",
      buildId: "20261027",
      extractTimestamp: new Date("2026-10-27T21:23:59Z"),
      counts: { ways: 3677, wayNodeRefs: 20535, poiFeatures: 119 },
    });
    expect(manifest.files.ways.bytes).toBe(240517);
    expect(manifest.files.ways.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a manifest without build.id: build.sh names every build", () => {
    const json = fixture();
    json["build"] = { ...(json["build"] as object), id: undefined };
    expect(() => readManifest(json)).toThrow("manifest.json has no build id (build.id)");
  });

  it("takes build.id when the manifest has one", () => {
    const json = fixture();
    json["build"] = { ...(json["build"] as object), id: "20261101" };
    expect(readManifest(json).buildId).toBe("20261101");
  });

  it("refuses the world overview, a basemap only, clearly", () => {
    const world = {
      mediaType: "application/vnd.trail.mapdata.manifest.v1+json",
      region: "world",
      extract: { timestamp: "2026-10-27T21:23:59Z" },
      counts: {},
      files: [{ name: "basemap.pmtiles", bytes: 1, sha256: "0".repeat(64) }],
    };
    expect(() => readManifest(world)).toThrow(/world overview is a basemap only/);
    expect(() => readManifest({ ...world, region: "basemaponly" })).toThrow(/basemap only/);
  });

  it("refuses a manifest that is not one, or lacks what the import needs", () => {
    const cases: [string, (json: Record<string, unknown>) => void][] = [
      [
        "not a Trail map data manifest",
        (json) => {
          json["mediaType"] = "application/json";
        },
      ],
      [
        "no region",
        (json) => {
          json["region"] = "Monaco";
        },
      ],
      [
        "no region",
        (json) => {
          json["region"] = "a".repeat(32);
        },
      ],
      [
        "no extract timestamp",
        (json) => {
          json["extract"] = {};
        },
      ],
      [
        "no extract timestamp",
        (json) => {
          json["extract"] = { timestamp: "yesterday" };
        },
      ],
      [
        "no day",
        (json) => {
          json["build"] = { id: "2026-11-01" };
        },
      ],
      [
        "no day",
        (json) => {
          json["build"] = { id: "20261331" };
        },
      ],
      [
        "no counts",
        (json) => {
          json["counts"] = { ways: 1 };
        },
      ],
      [
        "names region.poly not at all",
        (json) => {
          json["files"] = (json["files"] as { name: string }[]).filter(
            (file) => file.name !== "region.poly",
          );
        },
      ],
      [
        "names pois.geojsonseq.gz twice",
        (json) => {
          const files = json["files"] as { name: string }[];
          json["files"] = [...files, ...files.filter((file) => file.name === "pois.geojsonseq.gz")];
        },
      ],
      [
        "not a Trail map data manifest",
        (json) => {
          json["files"] = [{ name: "ways.opl.gz", bytes: -1, sha256: "x" }];
        },
      ],
    ];
    for (const [message, change] of cases) {
      const json = fixture();
      change(json);
      expect(() => readManifest(json)).toThrow(MapDataError);
      expect(() => readManifest(json)).toThrow(message);
    }
  });

  it("names a build's source and partitions by region, day and digest, within 63 characters", () => {
    const key = {
      region: "provence-alpes-cote-d-azur-xyz1",
      buildId: "20261027",
      digest: `sha256:${"b40a4453".padEnd(64, "0")}`,
    };
    expect(buildSource(key)).toBe("provence-alpes-cote-d-azur-xyz1@20261027-b40a4453");
    expect(partitionName("osm_tile_ways", key)).toBe(
      "osm_tile_ways_provence_alpes_cote_d_azur_xyz1_20261027_b40a4453",
    );
    expect(partitionName("osm_tile_ways", key).length).toBeLessThanOrEqual(63);
  });
});
