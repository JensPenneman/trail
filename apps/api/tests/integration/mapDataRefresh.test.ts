import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/loadConfig";
import { createPool } from "../../src/db/createPool";
import { createLogger } from "../../src/logging/createLogger";
import { listLocalBuilds } from "../../src/mapdata/localBuilds";
import { MapDataRefresher } from "../../src/mapdata/mapDataRefresher";
import type { RegionImport, RegionRow, RegionTables } from "../../src/mapdata/regionTables";
import { RegistryClient } from "../../src/mapdata/registry";
import { FakeRegistry, makeArtefact, monacoFiles } from "../support/fakeRegistry";
import { testEnvironment } from "../support/testEnvironment";

const logger = createLogger({ level: "silent" });
const never = new AbortController().signal;

/** The loader as the refresh sees it: its rows in memory, every import recorded. */
class FakeTables implements RegionTables {
  rows: RegionRow[] = [];
  readonly imports: { dir: string; digest: string }[] = [];
  failure: Error | null = null;

  async list(): Promise<readonly RegionRow[]> {
    return this.rows;
  }

  async import(input: { dir: string; digest: string }): Promise<RegionImport> {
    this.imports.push({ dir: input.dir, digest: input.digest });
    if (this.failure !== null) throw this.failure;
    const manifest = JSON.parse(await readFile(join(input.dir, "manifest.json"), "utf8"));
    this.rows = [
      ...this.rows.filter((row) => row.name !== manifest.region),
      {
        name: manifest.region,
        buildId: manifest.build.id,
        digest: input.digest,
        status: "ready",
        extractTimestamp: manifest.extract.timestamp,
      },
    ];
    return { imported: true, buildId: manifest.build.id, ways: 3677, pois: 119 };
  }
}

let pool: Pool;
let fake: FakeRegistry;
let root: string;
let tables: FakeTables;

beforeAll(() => {
  pool = createPool(testEnvironment()["DATABASE_URL"] ?? "", logger, {
    statementTimeoutMs: 30_000,
    max: 4,
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  fake = await new FakeRegistry().start();
  root = await mkdtemp(join(tmpdir(), "trail-map-refresh-"));
  tables = new FakeTables();
});

afterEach(async () => {
  await fake.close();
  await rm(root, { recursive: true, force: true });
});

function refresher(options: { tables?: RegionTables | null; now?: Date } = {}): MapDataRefresher {
  const config = loadConfig(testEnvironment({ MAP_DATA_REGIONS: "monaco", MAP_DATA_DIR: root }), {
    webDistDir: "/nonexistent",
  });
  return new MapDataRefresher({
    settings: config.mapData,
    pool,
    logger,
    tables: options.tables === undefined ? tables : options.tables,
    client: new RegistryClient({
      reference: { host: fake.host, repository: fake.repository },
      credentials: null,
      logger,
      scheme: "http",
      blobHosts: [fake.blobHost],
      wait: async () => {},
    }),
    pull: {
      download: { attempts: 2, idleTimeoutMs: 2000, wait: async () => {} },
      freeBytes: async () => 1e12,
    },
    now: () => options.now ?? new Date("2026-10-28T12:00:00Z"),
  });
}

const build = (buildId: string, builtAt = "2026-10-28T10:36:15Z", files = monacoFiles()) =>
  makeArtefact({ region: "monaco", buildId, files, builtAt });

/** Files no build on the volume holds, so that they are downloaded rather than linked. */
const otherFiles = () =>
  monacoFiles().map((file) => ({ ...file, bytes: Buffer.concat([file.bytes, Buffer.from("\n")]) }));

const world = () =>
  makeArtefact({
    region: "world",
    buildId: "20261027",
    files: monacoFiles().filter((file) => file.name === "basemap.pmtiles"),
  });

const blobRequests = () => fake.requests.filter((request) => request.server === "blobs").length;

describe("refreshing a region", () => {
  it("pulls a new build and imports it, and has nothing to do the next time", async () => {
    const first = build("20261027");
    fake.publish(first);
    const outcome = await refresher().refresh("monaco", never);
    expect(outcome).toMatchObject({
      region: "monaco",
      registry: { buildId: "20261027", digest: first.digest },
      tables: "imported",
      imported: { imported: true, ways: 3677, pois: 119 },
      keptNewer: false,
      busy: false,
      failures: [],
    });
    expect(outcome.pulled?.bytes).toBe(first.layers.reduce((sum, layer) => sum + layer.size, 0));
    expect(tables.imports).toEqual([{ dir: outcome.build?.dir, digest: first.digest }]);
    expect(outcome.build?.dir).toBe(
      join(root, "regions", "monaco", `20261027-${first.digest.slice(7, 15)}`),
    );

    const blobs = blobRequests();
    const again = await refresher().refresh("monaco", never);
    expect(again).toMatchObject({ tables: "current", pulled: null, failures: [] });
    expect(blobRequests()).toBe(blobs);
    expect(tables.imports).toHaveLength(1);
  });

  it("pulls the world overview with the regions, and never imports it", async () => {
    fake.publish(world());
    const map = refresher();
    expect(map.regions()).toEqual(["monaco", "world"]);
    const outcome = await map.refresh("world", never);
    expect(outcome).toMatchObject({ tables: "none", failures: [] });
    expect(outcome.build?.region).toBe("world");
    expect(await readdir(outcome.build?.dir ?? "")).toEqual(
      expect.arrayContaining(["basemap.pmtiles", "manifest.json", "oci-manifest.json"]),
    );
    expect(tables.imports).toEqual([]);
  });

  it("imports a rebuild of the same extract, and keeps two builds and the one in use", async () => {
    const first = build("20261027");
    fake.publish(first);
    await refresher().refresh("monaco", never);
    const rebuild = build("20261027", "2026-10-28T12:00:00Z");
    fake.publish(rebuild);
    const second = await refresher().refresh("monaco", never);
    expect(second).toMatchObject({ tables: "imported", removed: [] });
    expect(tables.imports.map((entry) => entry.digest)).toEqual([first.digest, rebuild.digest]);

    // A third build pushes the first one off the volume.
    const next = build("20261031");
    fake.publish(next);
    const third = await refresher().refresh("monaco", never);
    expect(third.removed.map((old) => old.digest)).toEqual([first.digest]);
    expect((await listLocalBuilds(root, "monaco")).map((local) => local.digest)).toEqual([
      next.digest,
      rebuild.digest,
    ]);
  });

  it("keeps the build in use on the volume while newer ones fail to import", async () => {
    const first = build("20261027");
    fake.publish(first);
    await refresher().refresh("monaco", never);
    tables.failure = new Error("the loader refused it");
    for (const day of ["20261030", "20261031"]) {
      fake.publish(build(day));
      const outcome = await refresher().refresh("monaco", never);
      expect(outcome.failures).toEqual([
        { stage: "import", reason: "import", message: "the loader refused it" },
      ]);
    }
    // The build that never served makes room; the one in use stays.
    const kept = async () => (await listLocalBuilds(root, "monaco")).map((local) => local.buildId);
    expect(await kept()).toEqual(["20261031", "20261027"]);
    // The next refresh imports the pulled build, without downloading it again,
    // and keeps the old one for the maps still open on it until the refresh after.
    tables.failure = null;
    const blobs = blobRequests();
    const outcome = await refresher().refresh("monaco", never);
    expect(outcome).toMatchObject({ tables: "imported", pulled: null, failures: [], removed: [] });
    expect(blobRequests()).toBe(blobs);
    expect(await kept()).toEqual(["20261031", "20261027"]);
    const after = await refresher().refresh("monaco", never);
    expect(after.removed.map((old) => old.buildId)).toEqual(["20261027"]);
  });

  it("keeps serving the old build when a blob of the new one is wrong", async () => {
    fake.publish(build("20261027"));
    const first = await refresher().refresh("monaco", never);
    const next = build("20261031", "2026-11-01T05:00:00Z", otherFiles());
    fake.publish(next);
    const ways = next.layers.find((layer) => layer.title === "ways.opl.gz");
    fake.blobFaults.set(ways?.digest ?? "", { kind: "corrupt" });
    const outcome = await refresher().refresh("monaco", never);
    expect(outcome.failures).toEqual([
      expect.objectContaining({ stage: "download", reason: "digest" }),
    ]);
    expect(outcome.build?.digest).toBe(first.build?.digest);
    expect(outcome.tables).toBe("current");
    expect(tables.imports).toHaveLength(1);
    expect(await readdir(join(root, "tmp"))).toEqual([]);
  });

  it("imports the build on the volume when the tables lost it, the registry away", async () => {
    fake.publish(build("20261027"));
    await refresher().refresh("monaco", never);
    // A database restored from a dump leaves the map tables empty.
    tables.rows = [];
    await fake.close();
    const outcome = await refresher().refresh("monaco", never);
    expect(outcome.failures).toEqual([
      expect.objectContaining({ stage: "registry", reason: "unreachable" }),
    ]);
    expect(outcome.tables).toBe("imported");
    expect(tables.imports).toHaveLength(2);
    fake = await new FakeRegistry().start();
  });

  it("keeps a build newer than the registry's", async () => {
    fake.publish(build("20261031"));
    await refresher().refresh("monaco", never);
    fake.publish(build("20261027"));
    const outcome = await refresher().refresh("monaco", never);
    expect(outcome).toMatchObject({
      keptNewer: true,
      pulled: null,
      tables: "current",
      failures: [],
    });
    expect(outcome.build?.buildId).toBe("20261031");
  });

  it("refuses an unknown region, and pulls without importing in a version without a loader", async () => {
    fake.publish(build("20261027"));
    const unknown = await refresher().refresh("luxembourg", never);
    expect(unknown.failures).toEqual([
      expect.objectContaining({ stage: "registry", reason: "not_found" }),
    ]);
    expect(unknown.build).toBeNull();
    const outcome = await refresher({ tables: null }).refresh("monaco", never);
    expect(outcome).toMatchObject({ tables: "unavailable", failures: [] });
    expect(outcome.pulled).not.toBeNull();
  });

  it("does nothing while another process refreshes the region", async () => {
    fake.publish(build("20261027"));
    const other = await pool.connect();
    try {
      await other.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", ["trail.map:monaco"]);
      const outcome = await refresher().refresh("monaco", never);
      expect(outcome).toMatchObject({ busy: true, build: null, failures: [] });
      expect(fake.requests).toEqual([]);
    } finally {
      await other.query("SELECT pg_advisory_unlock_all()");
      other.release();
    }
    expect((await refresher().refresh("monaco", never)).tables).toBe("imported");
  });

  it("deletes the download under way when it is stopped", async () => {
    const artefact = build("20261027");
    fake.publish(artefact);
    const basemap = artefact.layers.find((layer) => layer.title === "basemap.pmtiles");
    fake.blobFaults.set(basemap?.digest ?? "", { kind: "stall", after: 4096 });
    const abort = new AbortController();
    const refresh = refresher().refresh("monaco", abort.signal);
    while (!fake.requests.some((request) => request.path.includes(basemap?.digest ?? "-"))) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    abort.abort();
    await expect(refresh).rejects.toThrow();
    expect(await readdir(join(root, "tmp"))).toEqual([]);
    expect(await listLocalBuilds(root, "monaco")).toEqual([]);
    expect(tables.imports).toEqual([]);
  });

  it("warns about data older than three refresh periods", async () => {
    const lines: string[] = [];
    const warned = createLogger({
      level: "warn",
      destination: { write: (line: string) => lines.push(line) },
    });
    fake.publish(build("20261027"));
    const config = loadConfig(testEnvironment({ MAP_DATA_REGIONS: "monaco", MAP_DATA_DIR: root }), {
      webDistDir: "/nonexistent",
    });
    const late = new MapDataRefresher({
      settings: config.mapData,
      pool,
      logger: warned,
      tables,
      client: new RegistryClient({
        reference: { host: fake.host, repository: fake.repository },
        credentials: null,
        logger: warned,
        scheme: "http",
        blobHosts: [fake.blobHost],
      }),
      pull: { freeBytes: async () => 1e12 },
      now: () => new Date("2027-03-01T00:00:00Z"),
    });
    await late.refresh("monaco", never);
    expect(lines.some((line) => line.includes('"msg":"map region data is old"'))).toBe(true);
  });
});
