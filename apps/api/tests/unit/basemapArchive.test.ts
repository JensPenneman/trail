import { copyFile, mkdtemp, open, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { PMTiles, ResolvedValueCache, type Source } from "pmtiles";
import { describe, expect, it } from "vitest";
import { ArchiveFileSource, ArchiveReadError } from "../../src/basemap/archiveFileSource";
import { ArchiveError, BasemapArchive, maxTileBytes } from "../../src/basemap/basemapArchive";
import { DirectoryCache } from "../../src/basemap/directoryCache";
import { farAway, monacoBasemap, monacoStreets } from "../support/basemapVolume";
import { writePmtiles } from "../support/pmtilesWriter";

const gzipMagic = [0x1f, 0x8b];

/** The fixture read the library's own way: its tiles inflated. */
async function libraryTile(path: string, z: number, x: number, y: number) {
  const handle = await open(path);
  try {
    const { size } = await handle.stat();
    const source = new ArchiveFileSource(handle, size, "library");
    const tile = await new PMTiles(source, new ResolvedValueCache()).getZxy(z, x, y);
    return tile === undefined ? null : Buffer.from(tile.data);
  } finally {
    await handle.close();
  }
}

async function scratch(name: string, bytes: Buffer): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "trail-pmtiles-")), name);
  await writeFile(path, bytes);
  return path;
}

const openArchive = (path: string, cache = new DirectoryCache(10 * 1024 * 1024)) =>
  BasemapArchive.open({ path, key: path, cache });

describe("BasemapArchive on the Monaco fixture", () => {
  it("opens the workflow's archive and reads its zooms and compression from the header", async () => {
    const archive = await openArchive(monacoBasemap);
    try {
      expect(archive.minZoom).toBe(0);
      expect(archive.maxZoom).toBe(14);
      expect(archive.compression).toBe("gzip");
    } finally {
      await archive.close();
    }
  });

  it("gives a tile as stored, gzipped, the bytes the library inflates", async () => {
    const archive = await openArchive(monacoBasemap);
    try {
      for (const { z, x, y } of [monacoStreets, { z: 0, x: 0, y: 0 }, { z: 4, x: 8, y: 5 }]) {
        const tile = await archive.tile(z, x, y);
        expect(tile, `${z}/${x}/${y}`).not.toBeNull();
        expect([...(tile?.data.subarray(0, 2) ?? [])]).toEqual(gzipMagic);
        expect(gunzipSync(tile?.data ?? Buffer.alloc(0))).toEqual(
          await libraryTile(monacoBasemap, z, x, y),
        );
      }
    } finally {
      await archive.close();
    }
  });

  it("has nothing outside the extract's bounding box", async () => {
    const archive = await openArchive(monacoBasemap);
    try {
      expect(await archive.tile(farAway.z, farAway.x, farAway.y)).toBeNull();
      // Another place at the same zoom as Monaco's streets, and a zoom beyond the archive's.
      expect(await archive.tile(14, 8389, 5463)).toBeNull();
      expect(await archive.tile(15, 17060, 11948)).toBeNull();
    } finally {
      await archive.close();
    }
  });

  it("keeps its directories in a cache bounded by size", async () => {
    const roomy = new DirectoryCache(10 * 1024 * 1024);
    const archive = await openArchive(monacoBasemap, roomy);
    await archive.tile(monacoStreets.z, monacoStreets.x, monacoStreets.y);
    expect(roomy.bytes).toBeGreaterThan(0);
    await archive.close();
    // Closing an archive drops what the cache held of it.
    expect(roomy.bytes).toBe(0);

    // A cache too small for the root directory keeps nothing, and every tile still reads.
    const tiny = new DirectoryCache(64);
    const small = await openArchive(monacoBasemap, tiny);
    try {
      expect(await small.tile(monacoStreets.z, monacoStreets.x, monacoStreets.y)).not.toBeNull();
      expect(tiny.bytes).toBeLessThanOrEqual(64);
    } finally {
      await small.close();
    }
  });
});

describe("BasemapArchive on archives written by the tests", () => {
  const tiles = [
    { z: 5, x: 16, y: 11, data: Buffer.from("tile five") },
    { z: 6, x: 33, y: 23, data: Buffer.from("tile six") },
    { z: 14, x: 8530, y: 5974, data: Buffer.from("tile fourteen") },
  ];

  it("follows a leaf directory to its tiles", async () => {
    const path = await scratch("leaf.pmtiles", writePmtiles({ tiles, leaf: true }));
    const archive = await openArchive(path);
    try {
      for (const tile of tiles) {
        const stored = await archive.tile(tile.z, tile.x, tile.y);
        expect(gunzipSync(stored?.data ?? Buffer.alloc(0)).toString()).toBe(tile.data.toString());
      }
      expect(await archive.tile(6, 32, 23)).toBeNull();
    } finally {
      await archive.close();
    }
  });

  it("serves an archive of uncompressed tiles as it stores them", async () => {
    const path = await scratch("plain.pmtiles", writePmtiles({ tiles, compression: "none" }));
    const archive = await openArchive(path);
    try {
      expect(archive.compression).toBe("none");
      expect((await archive.tile(5, 16, 11))?.data.toString()).toBe("tile five");
    } finally {
      await archive.close();
    }
  });

  it("refuses what is not a vector tile archive Trail can read", async () => {
    const refused = async (name: string, bytes: Buffer) =>
      openArchive(await scratch(name, bytes)).then(
        () => "opened",
        (error: unknown) => (error instanceof ArchiveError ? error.message : String(error)),
      );
    expect(await refused("random.pmtiles", Buffer.alloc(4096, 7))).toMatch(/not a PMTiles archive/);
    expect(await refused("png.pmtiles", writePmtiles({ tiles, tileType: 2 }))).toMatch(
      /not vector tiles/,
    );
    expect(
      await refused("v2.pmtiles", writePmtiles({ tiles, header: (h) => h.writeUInt8(2, 7) })),
    ).toMatch(/version 2/);
    expect(
      await refused("brotli.pmtiles", writePmtiles({ tiles, header: (h) => h.writeUInt8(3, 98) })),
    ).toMatch(/compressed otherwise/);
    // Sections past the end of the file: an archive cut short.
    const whole = writePmtiles({ tiles });
    expect(await refused("cut.pmtiles", whole.subarray(0, whole.length - 4))).toMatch(
      /outside the file/,
    );
  });

  it("never opens an archive through a link", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trail-pmtiles-"));
    await copyFile(monacoBasemap, join(dir, "real.pmtiles"));
    await symlink(join(dir, "real.pmtiles"), join(dir, "basemap.pmtiles"));
    await expect(openArchive(join(dir, "basemap.pmtiles"))).rejects.toMatchObject({
      code: "ELOOP",
    });
  });

  it("refuses a tile over the cap and a directory pointing outside its section", async () => {
    const big = { z: 5, x: 16, y: 11, data: Buffer.alloc(maxTileBytes + 1, 1) };
    const path = await scratch("big.pmtiles", writePmtiles({ tiles: [big], compression: "none" }));
    const archive = await openArchive(path);
    try {
      await expect(archive.tile(5, 16, 11)).rejects.toThrow(/a tile of 2097153 bytes/);
    } finally {
      await archive.close();
    }

    // A leaf section said to be shorter than the leaf the root points to.
    const short = writePmtiles({
      tiles,
      leaf: true,
      header: (h) => h.writeUInt32LE(1, 48),
    });
    const broken = await openArchive(await scratch("short-leaf.pmtiles", short));
    try {
      await expect(broken.tile(5, 16, 11)).rejects.toThrow(/outside its section/);
    } finally {
      await broken.close();
    }
  });

  it("closes once the reads under way are done, and refuses reads after that", async () => {
    const archive = await openArchive(monacoBasemap);
    const reading = archive.tile(monacoStreets.z, monacoStreets.x, monacoStreets.y);
    const closed = archive.close();
    expect(await reading).not.toBeNull();
    await closed;
    await expect(archive.tile(0, 0, 0)).rejects.toThrow(/closed/);
  });
});

describe("ArchiveFileSource", () => {
  const sourceOf = async (bytes: Buffer) => {
    const handle = await open(await scratch("bytes.bin", bytes));
    return { handle, source: new ArchiveFileSource(handle, bytes.length, "bytes") as Source };
  };

  it("reads whole ranges inside the file", async () => {
    const { handle, source } = await sourceOf(Buffer.from("0123456789"));
    try {
      expect(Buffer.from((await source.getBytes(2, 5)).data).toString()).toBe("23456");
      // The header probe of a small archive comes back as long as the file.
      expect((await source.getBytes(0, 16_384)).data.byteLength).toBe(10);
    } finally {
      await handle.close();
    }
  });

  it("refuses reads past the end, negative, fractional or huge ones", async () => {
    const { handle, source } = await sourceOf(Buffer.from("0123456789"));
    try {
      for (const [offset, length] of [
        [8, 5],
        [11, 0],
        [-1, 2],
        [1.5, 2],
        [0, 64 * 1024 * 1024],
        [Number.MAX_SAFE_INTEGER, 1],
      ] as const) {
        await expect(source.getBytes(offset, length), `${offset}+${length}`).rejects.toThrow(
          ArchiveReadError,
        );
      }
    } finally {
      await handle.close();
    }
  });

  it("reads the fixture's header like the library's own", async () => {
    const bytes = await readFile(monacoBasemap);
    const { handle, source } = await sourceOf(bytes);
    try {
      const header = await new PMTiles(source).getHeader();
      expect(header).toMatchObject({ specVersion: 3, tileType: 1, minZoom: 0, maxZoom: 14 });
    } finally {
      await handle.close();
    }
  });
});
