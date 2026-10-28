import { describe, expect, it } from "vitest";
import { IngestMeter } from "../../src/load/ingestMeter";
import { buildLoadLine, type LoadSample } from "../../src/load/loadLine";

const sample: LoadSample = {
  intervalS: 60,
  eventLoopNs: { p50: 10_420_000, p99: 21_150_000, max: 48_300_000 },
  pool: { total: 4, idle: 3, waiting: 0 },
  streams: 12,
  background: 2,
  dailyStatsDays: 7,
  ingest: { uploads: 31, points: 1804, duplicates: 2, rejected: 1 },
  memory: { rss: 182 * 1_048_576, heapUsed: 71.25 * 1_048_576, heapTotal: 96 * 1_048_576 },
  processing: { queued: 9, ready: 2, oldestReadyS: 4.6 },
};

describe("the load line", () => {
  it("reports a minute in milliseconds, megabytes and counts", () => {
    expect(buildLoadLine(sample)).toEqual({
      intervalS: 60,
      loopP50Ms: 10.4,
      loopP99Ms: 21.2,
      loopMaxMs: 48.3,
      poolTotal: 4,
      poolIdle: 3,
      poolWaiting: 0,
      streams: 12,
      background: 2,
      dailyStatsDays: 7,
      uploads: 31,
      points: 1804,
      duplicates: 2,
      rejected: 1,
      rssMb: 182,
      heapUsedMb: 71.3,
      heapTotalMb: 96,
      queueRows: 9,
      queueReady: 2,
      queueAgeS: 5,
    });
  });

  it("says null for the queue while the database is away, and nothing is ready", () => {
    expect(buildLoadLine({ ...sample, processing: null })).toMatchObject({
      queueRows: null,
      queueReady: null,
      queueAgeS: null,
    });
    expect(
      buildLoadLine({ ...sample, processing: { queued: 0, ready: 0, oldestReadyS: null } }),
    ).toMatchObject({ queueRows: 0, queueAgeS: null });
    // A histogram without samples reports NaN or infinity: the line says 0.
    expect(
      buildLoadLine({ ...sample, eventLoopNs: { p50: Number.NaN, p99: Infinity, max: 0 } }),
    ).toMatchObject({ loopP50Ms: 0, loopP99Ms: 0, loopMaxMs: 0 });
  });

  it("holds numbers only: no id, name, token or coordinate can be in it", () => {
    for (const value of Object.values(buildLoadLine(sample))) {
      expect(value === null || typeof value === "number").toBe(true);
    }
  });
});

describe("the ingest meter", () => {
  it("counts uploads between two lines and starts again", () => {
    const meter = new IngestMeter();
    meter.record({ locations: 30, duplicates: 0, rejected: 0 });
    meter.record({ locations: 1, duplicates: 1, rejected: 2 });
    expect(meter.take()).toEqual({ uploads: 2, points: 31, duplicates: 1, rejected: 2 });
    expect(meter.take()).toEqual({ uploads: 0, points: 0, duplicates: 0, rejected: 0 });
  });
});
