import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../src/appContext";
import type { Config } from "../../src/config/config";
import { loadConfig } from "../../src/config/loadConfig";
import { startJobs } from "../../src/jobs/startJobs";
import { createLogger } from "../../src/logging/createLogger";
import { createMapDataRefresher } from "../../src/mapdata/createMapDataRefresher";
import { testEnvironment } from "../support/testEnvironment";

const schedule = vi.hoisted(() => vi.fn(() => ({ stop: async () => {} })));
vi.mock("../../src/mapdata/mapDataSchedule", () => ({ startMapDataSchedule: schedule }));

const logger = createLogger({ level: "silent" });
const configOf = (env: Record<string, string>): Config =>
  loadConfig(testEnvironment({ MAP_DATA_DIR: "/nonexistent-map-data", ...env }), {
    webDistDir: "/nonexistent",
  });

describe("the regions the refresher pulls", () => {
  it("include the basemap's region only when Trail serves the basemap itself", () => {
    const pool = {} as Pool;
    const regionsOf = (env: Record<string, string>) =>
      createMapDataRefresher({ config: configOf(env), pool, logger }).regions();
    expect(regionsOf({ MAP_BASEMAP: "self", MAP_BASEMAP_REGION: "monaco" })).toEqual([
      "monaco",
      "world",
    ]);
    expect(regionsOf({ MAP_BASEMAP: "openfreemap", MAP_BASEMAP_REGION: "monaco" })).toEqual([]);
    expect(regionsOf({ MAP_BASEMAP: "openfreemap", MAP_DATA_REGIONS: "belgium" })).toEqual([
      "belgium",
      "world",
    ]);
  });
});

describe("the map data schedule of the jobs", () => {
  const started = async (env: Record<string, string>) => {
    schedule.mockClear();
    const ctx = {
      config: configOf(env),
      pool: {} as Pool,
      logger,
      alerts: null,
      basemap: { rescan: async () => {} },
    } as unknown as AppContext;
    await startJobs(ctx).stop();
    return schedule.mock.calls.length;
  };

  it("starts with a basemap region alone, MAP_DATA_REGIONS empty", async () => {
    expect(await started({ MAP_BASEMAP: "self", MAP_BASEMAP_REGION: "monaco" })).toBe(1);
  });

  it("starts for MAP_DATA_REGIONS", async () => {
    expect(await started({ MAP_DATA_REGIONS: "monaco" })).toBe(1);
  });

  it("does not start without any region to pull", async () => {
    expect(await started({ MAP_BASEMAP: "openfreemap", MAP_BASEMAP_REGION: "monaco" })).toBe(0);
    expect(await started({})).toBe(0);
  });
});
