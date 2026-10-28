import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/loadConfig";
import { createPool } from "../../src/db/createPool";
import { createDatabase } from "../../src/db/database";
import { createLogger } from "../../src/logging/createLogger";
import { createMapDataRefresher } from "../../src/mapdata/createMapDataRefresher";
import { loaderTables } from "../../src/mapdata/loaderTables";
import { MapDataRefresher } from "../../src/mapdata/mapDataRefresher";
import { listRegionRows } from "../../src/mapdata/regionRows";
import { RegistryClient } from "../../src/mapdata/registry";
import { FakeRegistry, makeArtefact, monacoFiles } from "../support/fakeRegistry";
import { monacoManifest } from "../support/mapDataFixture";
import { resetDatabase } from "../support/resetDatabase";
import { testEnvironment } from "../support/testEnvironment";

/*
 * The refresh of docs/design/self-hosted-maps.md §2.6 with the loader wired in
 * (loaderTables.ts, as createMapDataRefresher passes it): a build pulled from the
 * registry is imported into the map tables under its OCI digest, and the next
 * refresh finds it there.
 */
const logger = createLogger({ level: "silent" });
const never = new AbortController().signal;
let pool: Pool;
let fake: FakeRegistry;
let root: string;

beforeAll(async () => {
  await resetDatabase();
  pool = createPool(testEnvironment()["DATABASE_URL"] ?? "", logger, {
    statementTimeoutMs: 30_000,
    max: 4,
  });
  fake = await new FakeRegistry().start();
  root = await mkdtemp(join(tmpdir(), "trail-map-refresh-import-"));
});

afterAll(async () => {
  await fake.close();
  await rm(root, { recursive: true, force: true });
  await pool.end();
});

describe("a refresh with the loader", () => {
  it("imports what it pulls, and finds it in the tables the next time", async () => {
    // build.sh's manifest carries the counts the loader checks; the fake's has none of its own.
    const artefact = makeArtefact({
      region: "monaco",
      buildId: "20261027",
      files: monacoFiles(),
      editTrail: (manifest) => ({ ...manifest, counts: monacoManifest().counts }),
    });
    fake.publish(artefact);
    const config = loadConfig(testEnvironment({ MAP_DATA_REGIONS: "monaco", MAP_DATA_DIR: root }), {
      webDistDir: "/nonexistent",
    });
    const refresher = new MapDataRefresher({
      settings: config.mapData,
      pool,
      logger,
      tables: loaderTables(createDatabase(pool), logger),
      client: new RegistryClient({
        reference: { host: fake.host, repository: fake.repository },
        credentials: null,
        logger,
        scheme: "http",
        blobHosts: [fake.blobHost],
        wait: async () => {},
      }),
      pull: { freeBytes: async () => 1e12 },
    });

    const first = await refresher.refresh("monaco", never);
    expect(first).toMatchObject({
      tables: "imported",
      imported: {
        imported: true,
        buildId: "20261027",
        ways: monacoManifest().counts.ways,
        pois: monacoManifest().counts.pois.features,
      },
      failures: [],
    });
    expect(await listRegionRows(createDatabase(pool))).toMatchObject([
      { name: "monaco", buildId: "20261027", digest: artefact.digest, status: "ready" },
    ]);

    const again = await refresher.refresh("monaco", never);
    expect(again).toMatchObject({ tables: "current", pulled: null, failures: [] });

    // What the worker and `trail map refresh` get: the same loader behind the same port.
    const wired = createMapDataRefresher({ config, pool, logger });
    expect(wired.importing).toBe(true);
    expect(await wired.tableRows()).toMatchObject([{ digest: artefact.digest, status: "ready" }]);
  });
});
