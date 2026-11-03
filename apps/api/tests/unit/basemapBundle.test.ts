import { describe, expect, it } from "vitest";
import type { BasemapArchive, StoredTile } from "../../src/basemap/basemapArchive";
import { type BasemapBundle, bundleId, bundleTile } from "../../src/basemap/basemapBundle";
import type { LocalBuild } from "../../src/mapdata/localBuilds";

const build = (region: string, digest: string): LocalBuild => ({
  region,
  buildId: "20261027",
  digest,
  name: `20261027-${digest.slice(7, 15)}`,
  dir: `/volume/regions/${region}`,
  pulledAt: new Date(0),
  bytes: 0,
  sharedBytes: 0,
  extractTimestamp: null,
});

/** An archive that has a tile at the zooms given, named after itself. */
function archive(name: string, zooms: readonly number[]) {
  const asked: string[] = [];
  const fake = {
    acquire: () => () => {},
    tile: async (z: number, x: number, y: number): Promise<StoredTile | null> => {
      asked.push(`${z}/${x}/${y}`);
      return zooms.includes(z) ? { data: Buffer.from(name), compression: "gzip" } : null;
    },
  } as unknown as BasemapArchive;
  return { archive: fake, asked };
}

const regionDigest = `sha256:${"a".repeat(64)}`;
const worldDigest = `sha256:${"b".repeat(64)}`;

function bundleOf(regionZooms: number[], worldZooms: number[] | null) {
  const region = archive("region", regionZooms);
  const world = worldZooms === null ? null : archive("world", worldZooms);
  const bundle: BasemapBundle = {
    id: "0123456789abcdef",
    region: { build: build("belgium", regionDigest), archive: region.archive },
    world: world === null ? null : { build: build("world", worldDigest), archive: world.archive },
  };
  const from = async (z: number) => (await bundleTile(bundle, z, 1, 1))?.data.toString() ?? null;
  return { from, region, world };
}

const allZooms = Array.from({ length: 15 }, (_, zoom) => zoom);

describe("the tile router's rule (docs/design/self-hosted-maps.md §3.1)", () => {
  it("takes z0–4 from the world overview, even where the region has the tile", async () => {
    const { from, region } = bundleOf(allZooms, [0, 1, 2, 3, 4, 5, 6]);
    for (const z of [0, 1, 2, 3, 4]) expect(await from(z)).toBe("world");
    expect(region.asked).toEqual([]);
  });

  it("answers nothing at z0–4 where the overview has nothing, rather than the region's partial tile", async () => {
    const { from } = bundleOf(allZooms, [5, 6]);
    expect(await from(3)).toBeNull();
  });

  it("takes z ≥ 5 from the region, else from the overview, else nothing", async () => {
    const { from, world } = bundleOf([5, 9, 14], [0, 1, 2, 3, 4, 5, 6]);
    expect(await from(5)).toBe("region");
    expect(await from(14)).toBe("region");
    expect(world?.asked).toEqual([]);
    // Abroad: the region has no tile there.
    expect(await from(6)).toBe("world");
    expect(await from(10)).toBeNull();
    expect(world?.asked).toEqual(["6/1/1", "10/1/1"]);
  });

  it("takes every zoom from the region while the volume has no overview yet", async () => {
    const { from } = bundleOf(allZooms, null);
    for (const z of [0, 4, 5, 14]) expect(await from(z)).toBe("region");
  });
});

describe("bundleId", () => {
  it("names the pair of builds, and changes with either", () => {
    const region = build("belgium", regionDigest);
    const world = build("world", worldDigest);
    const id = bundleId(region, world);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(bundleId(region, world)).toBe(id);
    expect(bundleId(region, null)).not.toBe(id);
    expect(bundleId(build("belgium", `sha256:${"c".repeat(64)}`), world)).not.toBe(id);
  });
});

describe("the archives a tile is read from", () => {
  it("are both held before the first read, and released after it", async () => {
    const events: string[] = [];
    const held = (name: string): BasemapArchive =>
      ({
        acquire: () => {
          events.push(`acquire ${name}`);
          return () => events.push(`release ${name}`);
        },
        tile: async () => {
          events.push(`read ${name}`);
          return null;
        },
      }) as unknown as BasemapArchive;
    const bundle: BasemapBundle = {
      id: "0123456789abcdef",
      region: { build: build("belgium", regionDigest), archive: held("region") },
      world: { build: build("world", worldDigest), archive: held("world") },
    };
    expect(await bundleTile(bundle, 9, 1, 1)).toBeNull();
    expect(events).toEqual([
      "acquire region",
      "acquire world",
      "read region",
      "read world",
      "release region",
      "release world",
    ]);
  });

  it("release the region's after a failed read, and the region's when the overview cannot be held", async () => {
    const events: string[] = [];
    const archiveOf = (name: string, over: Partial<Record<"acquire" | "tile", () => unknown>>) =>
      ({
        acquire: () => {
          events.push(`acquire ${name}`);
          return () => events.push(`release ${name}`);
        },
        tile: async () => null,
        ...over,
      }) as unknown as BasemapArchive;
    const bundleWith = (region: BasemapArchive, world: BasemapArchive): BasemapBundle => ({
      id: "0123456789abcdef",
      region: { build: build("belgium", regionDigest), archive: region },
      world: { build: build("world", worldDigest), archive: world },
    });

    const failure = new Error("unreadable");
    const failing = bundleWith(
      archiveOf("region", {
        tile: async () => {
          throw failure;
        },
      }),
      archiveOf("world", {}),
    );
    await expect(bundleTile(failing, 9, 1, 1)).rejects.toBe(failure);
    expect(events).toEqual(["acquire region", "acquire world", "release region", "release world"]);

    events.length = 0;
    const closed = new Error("closed");
    const refusing = bundleWith(
      archiveOf("region", {}),
      archiveOf("world", {
        acquire: () => {
          throw closed;
        },
      }),
    );
    await expect(bundleTile(refusing, 9, 1, 1)).rejects.toBe(closed);
    expect(events).toEqual(["acquire region", "release region"]);
  });
});
