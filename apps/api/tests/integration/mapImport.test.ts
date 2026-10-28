import { readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli/runCli";
import { createLogger } from "../../src/logging/createLogger";
import {
  buildSource,
  mapTables,
  partitionIndexes,
  partitionName,
} from "../../src/mapdata/buildPartitions";
import { CopyStream } from "../../src/mapdata/copyStream";
import { decodeGeometry } from "../../src/mapdata/geometryCodec";
import { type ImportStep, importRegion, MapImportBusyError } from "../../src/mapdata/importRegion";
import { MapDataError } from "../../src/mapdata/mapDataError";
import { listRegionRows } from "../../src/mapdata/regionRows";
import { sweepMapBuilds } from "../../src/mapdata/sweepMapBuilds";
import type { MapData } from "../../src/processing/mapData";
import { loadMapData, saveTile } from "../../src/processing/tileStore";
import { manifestDigest, writeArtefact } from "../support/mapDataArtefact";
import { cruiseTerminal, monacoDir, monacoManifest, papalins } from "../support/mapDataFixture";
import { resetDatabase } from "../support/resetDatabase";
import { createTestContext, type TestContext } from "../support/testContext";
import { testEnvironment } from "../support/testEnvironment";

/*
 * `trail map import` on the Monaco fixture (docs/design/self-hosted-maps.md §4.4): the rows,
 * the build's partitions, the swap to a new build while loadMapData reads, the Overpass cache
 * beside the region, and what the import refuses.
 */
const entryUrl = new URL("../../src/cli.ts", import.meta.url).href;
const logger = createLogger({ level: "silent" });
/** The z14 tiles of Monaco's streets (the fixture's README). */
const monacoTiles = [
  "14/8528/5975",
  "14/8529/5973",
  "14/8529/5974",
  "14/8529/5975",
  "14/8530/5973",
  "14/8530/5974",
];
const fixtureKey = { region: "monaco", buildId: "20261027", digest: manifestDigest(monacoDir) };

let t: TestContext;
let output: string[] = [];
let errors: string[] = [];
const directories: string[] = [];
const artefact = (...args: Parameters<typeof writeArtefact>) => {
  const dir = writeArtefact(...args);
  directories.push(dir);
  return dir;
};

const run = async (...argv: string[]) => {
  output = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    output.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errors.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "table").mockImplementation((rows: unknown) => {
    output.push(JSON.stringify(rows));
  });
  return runCli(argv, entryUrl);
};

/** What a read of Monaco's tiles gives, as one comparable string. */
const summary = (map: MapData): string =>
  JSON.stringify({
    ways: map.ways
      .map((way) => `${way.id}:${way.name}:${way.nodes.length}:${JSON.stringify(way.geometry)}`)
      .sort(),
    pois: map.pois.map((poi) => `${poi.id}:${poi.lat}:${poi.lon}`).sort(),
  });
const readMonaco = async () => summary(await loadMapData(t.ctx.db, monacoTiles));

const count = async (table: string, source: string) =>
  (
    await t.ctx.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)} WHERE source = ${source}`,
    )
  ).rows[0]?.count;

/** The partitions of the three tables, as `table:partition`. */
const partitions = async () =>
  (
    await t.ctx.db.execute<{ name: string }>(sql`
      SELECT p.relname || ':' || c.relname AS name
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname IN ('osm_ways', 'osm_tile_ways', 'osm_pois') ORDER BY 1
    `)
  ).rows.map((row) => row.name);
const buildPartitions = (key: typeof fixtureKey) =>
  mapTables.map((table) => `${table}:${partitionName(table, key)}`);
const overpassPartitions = mapTables.map((table) => `${table}:${table}_overpass`);

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  for (const [key, value] of Object.entries(testEnvironment())) process.env[key] = value;
});

afterAll(async () => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
  await t.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trail map import", () => {
  const manifest = monacoManifest();
  const source = buildSource(fixtureKey);

  it("imports the Monaco fixture in under 5 s, as its manifest counts it", async () => {
    const started = performance.now();
    expect(await run("map", "import", monacoDir)).toBe(0);
    const seconds = (performance.now() - started) / 1000;
    process.stdout.write(
      `map import of the Monaco fixture through the CLI: ${seconds.toFixed(2)} s\n`,
    );
    expect(seconds).toBeLessThan(5);
    expect(output[0]).toMatch(/^monaco: build 20261027 imported in \d+\.\d s$/);
    expect(output[1]).toBe(
      `  ${manifest.counts.ways} ways in 3776 tile memberships, ${manifest.counts.pois.features} stops`,
    );
    expect(output[2]).toBe(`  source ${source}, digest ${fixtureKey.digest}`);
    expect(errors).toEqual([
      "  files match manifest.json",
      "  ways and stops loaded",
      "  keys built",
      "  swapping in",
      "  swapped in",
      "  old build removed",
    ]);

    const [row, ...others] = await listRegionRows(t.ctx.db);
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      name: "monaco",
      buildId: "20261027",
      digest: fixtureKey.digest,
      source,
      extractTimestamp: "2026-10-27T21:23:59.000Z",
      status: "ready",
      error: null,
      wayCount: manifest.counts.ways,
      membershipCount: 3776,
      poiCount: manifest.counts.pois.features,
    });
    expect(row?.importedAt).not.toBeNull();
    expect(await partitions()).toEqual(
      [...buildPartitions(fixtureKey), ...overpassPartitions].sort(),
    );
    expect(await count("osm_ways", source)).toBe(manifest.counts.ways);
    expect(await count("osm_tile_ways", source)).toBe(3776);
    expect(await count("osm_pois", source)).toBe(manifest.counts.pois.features);
  });

  it("stores the ways' kinds, a known way, the stops and the region's polygon as the files hold them", async () => {
    const kinds = await t.ctx.db.execute<{ kind: string; count: number }>(sql`
      SELECT kind, count(*)::int AS count FROM osm_ways WHERE source = ${source} GROUP BY kind ORDER BY kind
    `);
    expect(Object.fromEntries(kinds.rows.map((row) => [row.kind, row.count]))).toEqual({
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
    const way = await t.ctx.db.execute<{
      kind: string;
      tags: Record<string, string>;
      nodes: string[];
      geometry: Buffer;
      min_lat: number;
      max_lon: number;
      fetched_at: string;
    }>(sql`
      SELECT kind, tags, nodes::text[] AS nodes, geometry, min_lat, max_lon, fetched_at::text
      FROM osm_ways WHERE id = ${papalins.id} AND source = ${source}
    `);
    expect(way.rows[0]).toMatchObject({
      kind: papalins.kind,
      tags: { highway: "residential", name: papalins.name, oneway: "yes" },
      nodes: papalins.nodes.map(String),
      min_lat: 43.7296303,
      max_lon: 7.4174924,
      fetched_at: "2026-10-27 21:23:59+00",
    });
    expect(decodeGeometry(way.rows[0]?.geometry ?? Buffer.alloc(0))).toEqual(papalins.geometry);
    const stops = await t.ctx.db.execute(sql`
      SELECT kind, lat, lon, name, z, x, y FROM osm_pois WHERE id = ${cruiseTerminal.id} AND source = ${source}
    `);
    expect(stops.rows).toEqual([
      {
        kind: cruiseTerminal.kind,
        lat: cruiseTerminal.lat,
        lon: cruiseTerminal.lon,
        name: cruiseTerminal.name,
        z: 14,
        x: 8530,
        y: 5974,
      },
    ]);
    const region = await t.ctx.db.execute<{
      type: string;
      rings: number;
      min_lat: number;
      max_lon: number;
    }>(sql`
      SELECT polygon->>'type' AS type, jsonb_array_length(polygon->'coordinates') AS rings, min_lat, max_lon
      FROM osm_regions WHERE source = ${source}
    `);
    expect(region.rows).toEqual([
      { type: "MultiPolygon", rings: 1, min_lat: 43.48382, max_lon: 7.595671 },
    ]);
  });

  it("serves the region's ways and stops through loadMapData, tile by tile", async () => {
    const map = await loadMapData(t.ctx.db, ["14/8529/5974"]);
    expect(map.ways.find((way) => way.id === papalins.id)).toEqual({
      id: papalins.id,
      kind: papalins.kind,
      nodes: papalins.nodes,
      geometry: papalins.geometry,
      name: papalins.name,
    });
    expect(map.pois.map((poi) => poi.id)).toContain("n9952646938");
    expect(map.pois.map((poi) => poi.id)).not.toContain(cruiseTerminal.id);
    const all = await loadMapData(t.ctx.db, monacoTiles);
    expect(all.ways).toHaveLength(manifest.counts.ways);
    expect(new Set(all.ways.map((way) => way.id)).size).toBe(manifest.counts.ways);
    expect(all.pois).toHaveLength(manifest.counts.pois.features);
  });

  it("lists the builds with trail map status", async () => {
    expect(await run("map", "status")).toBe(0);
    const [table, cache] = output;
    expect(JSON.parse(table ?? "[]")).toMatchObject([
      {
        region: "monaco",
        status: "ready",
        build: "20261027",
        extract: "2026-10-27 21:23",
        ways: manifest.counts.ways,
        stops: manifest.counts.pois.features,
        digest: `${fixtureKey.digest.slice(0, 19)}…`,
        error: "",
      },
    ]);
    expect(cache).toMatch(/^Overpass cache: 0 tiles, 0 ways, \d+\.\d MB$/);
  });

  it("leaves a build that is ready as it is when it comes again", async () => {
    const [before] = await listRegionRows(t.ctx.db);
    expect(await run("map", "import", monacoDir)).toBe(0);
    expect(output).toEqual([`monaco: build 20261027 (${fixtureKey.digest}) is imported already`]);
    expect(await listRegionRows(t.ctx.db)).toEqual([before]);
    expect(await partitions()).toEqual(
      [...buildPartitions(fixtureKey), ...overpassPartitions].sort(),
    );
  });

  it("swaps in the same extract built again, every read in between whole", async () => {
    const rebuilt = { ...fixtureKey, digest: `sha256:${"7".repeat(64)}` };
    const before = await readMonaco();
    let reading = true;
    const reads: string[] = [];
    const reader = (async () => {
      while (reading) reads.push(await readMonaco());
    })();
    const result = await importRegion({
      db: t.ctx.db,
      logger,
      dir: monacoDir,
      digest: rebuilt.digest,
    });
    reading = false;
    await reader;
    expect(result).toMatchObject({
      region: "monaco",
      buildId: "20261027",
      imported: true,
      ways: manifest.counts.ways,
      pois: manifest.counts.pois.features,
      replaced: [source],
    });
    expect(reads.length).toBeGreaterThan(0);
    expect(new Set(reads)).toEqual(new Set([before]));
    expect(await readMonaco()).toBe(before);
    expect((await listRegionRows(t.ctx.db)).map((row) => [row.digest, row.status])).toEqual([
      [rebuilt.digest, "ready"],
    ]);
    expect(await partitions()).toEqual([...buildPartitions(rebuilt), ...overpassPartitions].sort());
  });

  it("swaps in a changed build without a gap: readers see the old build, then the new, whole", async () => {
    const changed = artefact({
      // a tenth of the ways gone, Avenue des Papalins renamed, a bus stop gone
      ways: (lines) =>
        lines
          .filter((line, index) => index % 10 !== 3 || line.startsWith(`w${papalins.id} `))
          .map((line) =>
            line.replace("name=Avenue%20%des%20%Papalins", "name=Rue%20%des%20%Papalins"),
          ),
      pois: (lines) => lines.slice(1),
    });
    const old = await readMonaco();
    const reads: string[] = [];
    let reading = true;
    const reader = (async () => {
      while (reading) reads.push(await readMonaco());
    })();
    const seen: Partial<Record<ImportStep, string>> = {};
    let held: Promise<[string, string]> | undefined;
    let blocked: Promise<string> | undefined;
    const result = await importRegion({
      db: t.ctx.db,
      logger,
      dir: changed,
      digest: null,
      onStep: async (step) => {
        if (step === "indexed") {
          // A reader in a transaction of its own: the swap must wait for it to finish.
          let started: () => void = () => undefined;
          const reading = new Promise<void>((resolve) => {
            started = resolve;
          });
          held = t.ctx.db.transaction(async (tx) => {
            const first = summary(await loadMapData(tx, monacoTiles));
            started();
            await delay(300);
            return [first, summary(await loadMapData(tx, monacoTiles))];
          });
          await reading;
        }
        if (step === "locked") {
          // Holding the tables: a read now waits and then sees the new build.
          blocked = readMonaco();
          await delay(100);
        }
        if (step === "committed") {
          // The old build's partitions are still attached, but nobody reads them.
          seen.committed = await readMonaco();
          expect(await partitions()).toEqual(
            expect.arrayContaining(
              buildPartitions({ ...fixtureKey, digest: `sha256:${"7".repeat(64)}` }),
            ),
          );
        }
      },
    });
    reading = false;
    await reader;
    const now = await readMonaco();
    expect(now).not.toBe(old);
    expect(await held).toEqual([old, old]);
    expect(await blocked).toBe(now);
    expect(seen.committed).toBe(now);
    // Every read saw one build whole, and never the old one after the new.
    expect(reads).toContain(old);
    expect(reads.every((read) => read === old || read === now)).toBe(true);
    const firstNew = reads.indexOf(now);
    if (firstNew >= 0) expect(reads.slice(firstNew).every((read) => read === now)).toBe(true);
    const map = await loadMapData(t.ctx.db, monacoTiles);
    expect(map.ways.find((way) => way.id === papalins.id)?.name).toBe("Rue des Papalins");
    expect(result.ways).toBe(map.ways.length);
    expect(result.pois).toBe(manifest.counts.pois.features - 1);
    const changedKey = { ...fixtureKey, digest: manifestDigest(changed) };
    expect(await partitions()).toEqual(
      [...buildPartitions(changedKey), ...overpassPartitions].sort(),
    );
    expect((await listRegionRows(t.ctx.db)).map((row) => row.digest)).toEqual([changedKey.digest]);
  });

  it("reads both sources for a tile: the Overpass cache beside the region, the newer of a way both hold", async () => {
    await importRegion({ db: t.ctx.db, logger, dir: monacoDir, digest: null });
    const tile = { z: 14, x: 8529, y: 5974 };
    const fromOverpass = {
      ...papalins,
      geometry: papalins.geometry.map(([lon, lat]) => [lon, lat + 0.0000001] as const),
      name: "Avenue des Papalins (Overpass)",
      tags: { highway: "residential", name: "Avenue des Papalins (Overpass)" },
    };
    const cacheOnly = {
      id: 99_000_001,
      kind: "footway" as const,
      nodes: [1, 2],
      geometry: [
        [7.42, 43.73],
        [7.4201, 43.7301],
      ] as const,
      name: null,
      tags: { highway: "footway" },
    };
    const stop = {
      id: "n99000002",
      kind: "bus_stop" as const,
      lat: 43.731,
      lon: 7.421,
      name: "Cache",
    };
    const save = (at: string) =>
      saveTile(
        t.ctx.db,
        tile,
        {
          ways: [fromOverpass, cacheOnly].map((way) => ({
            ...way,
            nodes: [...way.nodes],
            geometry: way.geometry.map(([lon, lat]) => [lon, lat] as const),
          })),
          pois: [stop],
          bytes: 100,
        },
        new Date(at),
      );
    const regionOnly = (await loadMapData(t.ctx.db, ["14/8529/5974"])).ways.length;

    // Fetched after the extract: the cache's Papalins is the newer.
    await save("2026-10-28T12:00:00Z");
    let map = await loadMapData(t.ctx.db, ["14/8529/5974"]);
    expect(map.ways).toHaveLength(regionOnly + 1);
    expect(map.ways.find((way) => way.id === papalins.id)?.name).toBe(
      "Avenue des Papalins (Overpass)",
    );
    expect(map.ways.find((way) => way.id === cacheOnly.id)?.geometry).toEqual(cacheOnly.geometry);
    expect(map.pois.map((poi) => poi.id)).toEqual(expect.arrayContaining([stop.id, "n9952646938"]));

    // Fetched before it: the region's.
    await save("2026-09-01T12:00:00Z");
    map = await loadMapData(t.ctx.db, ["14/8529/5974"]);
    expect(map.ways.find((way) => way.id === papalins.id)).toMatchObject({
      name: papalins.name,
      geometry: papalins.geometry,
    });
    expect(map.ways).toHaveLength(regionOnly + 1);
    expect(await count("osm_ways", "overpass")).toBe(2);
  });

  it("keeps the old build serving when an import fails, and records why", async () => {
    const before = await readMonaco();
    const [ready] = await listRegionRows(t.ctx.db);
    const wrong = artefact({
      manifest: (json) => {
        (json["counts"] as { ways: number }).ways += 1;
      },
    });
    await expect(importRegion({ db: t.ctx.db, logger, dir: wrong, digest: null })).rejects.toThrow(
      /ways\.opl\.gz has \d+ lines, manifest\.json counts \d+ ways/,
    );
    expect(await readMonaco()).toBe(before);
    const rows = await listRegionRows(t.ctx.db);
    expect(rows[0]).toEqual(ready);
    expect(rows[1]).toMatchObject({
      digest: manifestDigest(wrong),
      status: "failed",
      error: expect.stringMatching(/manifest\.json counts/),
      wayCount: 0,
    });
    expect(await partitions()).toEqual(
      [
        ...buildPartitions({ ...fixtureKey, digest: ready?.digest ?? "" }),
        ...overpassPartitions,
      ].sort(),
    );

    const twice = artefact({ pois: (lines) => [...lines, lines[0] ?? ""] });
    await expect(importRegion({ db: t.ctx.db, logger, dir: twice, digest: null })).rejects.toThrow(
      "pois.geojsonseq.gz holds a stop twice",
    );
    const truncated = artefact({
      waysFile: readFileSync(join(monacoDir, "ways.opl.gz")).subarray(0, 100_000),
    });
    await expect(
      importRegion({ db: t.ctx.db, logger, dir: truncated, digest: null }),
    ).rejects.toThrow("ways.opl.gz is no gzip file, or a damaged one");
    // A decompression bomb: 70 MB of lines that pack into a few hundred kilobytes.
    const bomb = artefact({
      waysFile: gzipSync(Buffer.from(`${"x".repeat(999)}\n`.repeat(70_000))),
    });
    await expect(importRegion({ db: t.ctx.db, logger, dir: bomb, digest: null })).rejects.toThrow(
      /ways\.opl\.gz unpacks to more than \d+ bytes/,
    );
    // Postgres refusing the rows halfway (a full disk, here a constraint): its reason is kept.
    const refused = artefact({
      ways: (lines) =>
        lines.map((line, index) => (index === 0 ? line.replace(/^w4097656 /, "w4097655 ") : line)),
    });
    await t.ctx.db.execute(
      sql`ALTER TABLE osm_ways ADD CONSTRAINT osm_ways_refused_check CHECK (id <> 4097655)`,
    );
    try {
      await expect(
        importRegion({ db: t.ctx.db, logger, dir: refused, digest: null }),
      ).rejects.toThrow(/violates check constraint "osm_ways_refused_check"/);
    } finally {
      await t.ctx.db.execute(sql`ALTER TABLE osm_ways DROP CONSTRAINT osm_ways_refused_check`);
    }
    expect(
      (await listRegionRows(t.ctx.db)).find((row) => row.digest === manifestDigest(refused)),
    ).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/violates check constraint "osm_ways_refused_check"/),
    });
    expect(await readMonaco()).toBe(before);
    expect((await listRegionRows(t.ctx.db)).filter((row) => row.status === "failed")).toHaveLength(
      5,
    );
    expect(await partitions()).toHaveLength(6);

    // A build that does go in takes the region's failed attempts with it (their reasons are logged).
    const good = artefact();
    await importRegion({ db: t.ctx.db, logger, dir: good, digest: null });
    expect((await listRegionRows(t.ctx.db)).map((row) => [row.digest, row.status])).toEqual([
      [manifestDigest(good), "ready"],
    ]);
  });

  it("keeps Postgres' reason when it refuses a COPY halfway, and leaves the COPY to it", async () => {
    const client = await t.ctx.db.$client.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE copy_refused (n integer CHECK (n < 1000))");
      const copy = new CopyStream(client, "COPY copy_refused (n) FROM STDIN");
      for (let n = 0; n < 2000; n += 1) copy.add(`${n}\n`);
      await copy.flush();
      // The refusal arrives while nothing waits for the stream: the next write must not
      // reach the connection pg-copy-streams has let go of, but say what Postgres said.
      let refusal: unknown = null;
      for (let attempt = 0; attempt < 50 && refusal === null; attempt += 1) {
        await delay(100);
        copy.add("5\n");
        refusal = await copy.flush().then(
          () => null,
          (error: unknown) => error,
        );
      }
      expect(refusal).toMatchObject({
        code: "23514",
        message: expect.stringMatching(/violates check constraint/),
      });
      await expect(copy.end()).rejects.toMatchObject({ code: "23514" });
      expect(() => copy.abort(new Error("the loader gives up"))).not.toThrow();
      await client.query("ROLLBACK");
      expect((await client.query("SELECT 1 AS ok")).rows).toEqual([{ ok: 1 }]);
    } finally {
      client.release();
    }
  });

  it("refuses an artefact that is damaged, incomplete, linked or the world overview, before writing", async () => {
    const rowsBefore = await listRegionRows(t.ctx.db);
    const refused = async (dir: string, message: string | RegExp) => {
      await expect(importRegion({ db: t.ctx.db, logger, dir, digest: null })).rejects.toThrow(
        MapDataError,
      );
      await expect(importRegion({ db: t.ctx.db, logger, dir, digest: null })).rejects.toThrow(
        message,
      );
    };
    await refused(
      artefact({ ways: (lines) => lines.slice(1), keepChecksums: true }),
      /ways\.opl\.gz has \d+ bytes, manifest\.json says 240517/,
    );
    const damaged = artefact();
    const bytes = readFileSync(join(damaged, "ways.opl.gz"));
    bytes[1000] = (bytes[1000] ?? 0) ^ 0xff;
    writeFileSync(join(damaged, "ways.opl.gz"), bytes);
    await refused(damaged, "ways.opl.gz does not match its SHA-256 in manifest.json");
    const linked = artefact();
    unlinkSync(join(linked, "pois.geojsonseq.gz"));
    symlinkSync(join(monacoDir, "pois.geojsonseq.gz"), join(linked, "pois.geojsonseq.gz"));
    await refused(linked, "pois.geojsonseq.gz is a symbolic link");
    const missing = artefact();
    unlinkSync(join(missing, "region.poly"));
    await refused(missing, "region.poly is missing");
    const world = artefact({
      manifest: (json) => {
        json["region"] = "world";
      },
    });
    await refused(world, "the world overview is a basemap only: it holds no map data to import");
    await refused(join(monacoDir, "manifest.json"), /is not a directory/);
    await expect(
      importRegion({ db: t.ctx.db, logger, dir: monacoDir, digest: "sha256:nope" }),
    ).rejects.toThrow("sha256:nope is no sha256 digest");
    expect(await listRegionRows(t.ctx.db)).toEqual(rowsBefore);
  });

  it("lets one import run at a time", async () => {
    const holder = await t.ctx.db.$client.connect();
    try {
      // The key of mapdata/importLock.ts: another session's import is running.
      await holder.query("SELECT pg_advisory_lock(740318301)");
      await expect(
        importRegion({ db: t.ctx.db, logger, dir: artefact(), digest: null }),
      ).rejects.toThrow(MapImportBusyError);
      expect(await run("map", "import", monacoDir)).toBe(1);
      expect(errors.at(-1)).toBe(
        "trail map: another map import is running; try again when it has finished",
      );
      expect(await sweepMapBuilds(t.ctx.db, logger)).toEqual([]);
    } finally {
      await holder.query("SELECT pg_advisory_unlock(740318301)");
      holder.release();
    }
  });

  it("sweeps the tables of builds no region references: what a crash left", async () => {
    const stale = { region: "monaco", buildId: "20200101", digest: `sha256:${"d".repeat(64)}` };
    const staleSource = buildSource(stale);
    await t.ctx.db.execute(
      sql.raw(`CREATE TABLE ${partitionName("osm_ways", stale)} (LIKE osm_ways INCLUDING ALL)`),
    );
    await t.ctx.db.execute(
      sql.raw(
        `CREATE TABLE ${partitionName("osm_pois", stale)} PARTITION OF osm_pois FOR VALUES IN ('${staleSource}')`,
      ),
    );
    const kept = await partitions();
    expect(kept).toContain(`osm_pois:${partitionName("osm_pois", stale)}`);
    expect((await sweepMapBuilds(t.ctx.db, logger)).sort()).toEqual(
      [partitionName("osm_pois", stale), partitionName("osm_ways", stale)].sort(),
    );
    expect(await partitions()).toEqual(kept.filter((name) => !name.includes("20200101")));
    const leftover = await t.ctx.db.execute(
      sql`SELECT to_regclass(${partitionName("osm_ways", stale)}) AS table`,
    );
    expect(leftover.rows).toEqual([{ table: null }]);
  });

  it("finishes a detach a crash cut off and fails a build a crash left importing, whatever references them", async () => {
    const cut = { region: "monaco", buildId: "20200102", digest: `sha256:${"e".repeat(64)}` };
    const cutSource = buildSource(cut);
    const name = partitionName("osm_pois", cut);
    await t.ctx.db.execute(
      sql.raw(`CREATE TABLE ${name} PARTITION OF osm_pois FOR VALUES IN ('${cutSource}')`),
    );
    // The build was being imported again when the process died: its row still says so.
    await t.ctx.db.execute(sql`
      INSERT INTO osm_regions (name, build_id, digest, source, status, extract_timestamp, polygon,
        min_lat, min_lon, max_lat, max_lon)
      VALUES ('monaco', ${cut.buildId}, ${cut.digest}, ${cutSource}, 'importing', '2020-01-02T00:00:00Z',
        '{"type": "MultiPolygon", "coordinates": []}', 0, 0, 0, 0)
    `);
    // A DETACH … CONCURRENTLY cut off between its two transactions: a reader holds up its
    // second, and it is cancelled there.
    const pendingOf = async () =>
      (
        await t.ctx.db.execute<{ pending: boolean }>(
          sql`SELECT inhdetachpending AS pending FROM pg_inherits WHERE inhrelid = to_regclass(${name})`,
        )
      ).rows;
    const reader = await t.ctx.db.$client.connect();
    const detacher = await t.ctx.db.$client.connect();
    try {
      await reader.query("BEGIN");
      await reader.query("SELECT count(*) FROM osm_pois");
      const pid = (await detacher.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
        ?.pid;
      const detaching = detacher
        .query(`ALTER TABLE osm_pois DETACH PARTITION ${name} CONCURRENTLY`)
        .then(
          () => null,
          (error: unknown) => error,
        );
      for (
        let attempt = 0;
        attempt < 100 && (await pendingOf())[0]?.pending !== true;
        attempt += 1
      ) {
        await delay(50);
      }
      await t.ctx.db.execute(sql`SELECT pg_cancel_backend(${pid})`);
      expect(String(await detaching)).toMatch(/canceling statement/);
      await reader.query("COMMIT");
    } finally {
      reader.release();
      detacher.release();
    }
    expect(await pendingOf()).toEqual([{ pending: true }]);

    expect(await sweepMapBuilds(t.ctx.db, logger)).toEqual([name]);
    expect(await pendingOf()).toEqual([]);
    const leftover = await t.ctx.db.execute(sql`SELECT to_regclass(${name}) AS table`);
    expect(leftover.rows).toEqual([{ table: null }]);
    expect((await listRegionRows(t.ctx.db)).find((row) => row.digest === cut.digest)).toMatchObject(
      {
        status: "failed",
        error: "interrupted",
      },
    );
  });

  it("refuses a build whose source another build of the region and day has already", async () => {
    const dir = artefact();
    const digest = manifestDigest(dir);
    // The first 8 hex digits are what the source keeps of a digest.
    const twin = `${digest.slice(0, "sha256:".length + 8)}${digest.endsWith("0".repeat(56)) ? "1".repeat(56) : "0".repeat(56)}`;
    await t.ctx.db.execute(sql`
      INSERT INTO osm_regions (name, build_id, digest, source, status, extract_timestamp, polygon,
        min_lat, min_lon, max_lat, max_lon)
      VALUES ('monaco', '20261027', ${twin}, ${buildSource({ region: "monaco", buildId: "20261027", digest: twin })},
        'failed', '2026-10-27T21:23:59Z', '{"type": "MultiPolygon", "coordinates": []}', 0, 0, 0, 0)
    `);
    try {
      await expect(importRegion({ db: t.ctx.db, logger, dir, digest: null })).rejects.toThrow(
        MapDataError,
      );
      await expect(importRegion({ db: t.ctx.db, logger, dir, digest: null })).rejects.toThrow(
        `so both would be ${buildSource({ region: "monaco", buildId: "20261027", digest })}`,
      );
    } finally {
      await t.ctx.db.execute(sql`DELETE FROM osm_regions WHERE digest = ${twin}`);
    }
  });

  it("gives a build's partitions the parents' keys and indexes, so attaching builds none", async () => {
    for (const table of mapTables) {
      const indexes = await t.ctx.db.execute<{ primary: boolean; columns: string[] }>(sql`
        SELECT i.indisprimary AS primary,
          array(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.position) AS columns
        FROM pg_index i WHERE i.indrelid = ${table}::regclass ORDER BY i.indisprimary DESC
      `);
      expect(indexes.rows).toEqual(
        partitionIndexes[table].map((index) => ({
          primary: index.primary,
          columns: [...index.columns],
        })),
      );
    }
  });

  it("checks the arguments of trail map", async () => {
    expect(await run("map")).toBe(2);
    expect(errors.join("\n")).toContain("map needs a command: import or status");
    expect(await run("map", "frobnicate")).toBe(2);
    expect(await run("map", "import")).toBe(2);
    expect(await run("map", "import", "a", "b")).toBe(2);
    expect(await run("map", "status", "--all")).toBe(2);
    expect(await run("map", "import", "/nonexistent/monaco")).toBe(1);
    expect(errors.at(-1)).toBe("trail map: /nonexistent/monaco is not a directory");
  });
});
