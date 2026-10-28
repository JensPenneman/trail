import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDockerStats, readAppLog, rowOf } from "../collect.mjs";

const token = `trl_${"x".repeat(43)}`;

describe("the collector", () => {
  it("reads the app's log as numbers: load lines, processing windows, the start", () => {
    const log = [
      JSON.stringify({
        level: 30,
        time: new Date(900).toISOString(),
        pid: 1,
        msg: "Trail API listening",
        port: 8080,
      }),
      JSON.stringify({
        level: 30,
        time: new Date(1000).toISOString(),
        pid: 1,
        hostname: "h",
        msg: "request completed",
        req: { url: `/api/osmand?token=${token}&lat=51.05` },
      }),
      JSON.stringify({
        level: 30,
        time: new Date(61_000).toISOString(),
        pid: 1,
        msg: "load",
        intervalS: 60,
        loopP99Ms: 21.2,
        uploads: 31,
        points: 1804,
        queueAgeS: null,
      }),
      JSON.stringify({
        level: 30,
        time: new Date(62_000).toISOString(),
        pid: 1,
        msg: "processing window done",
        deviceId: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
        points: 3600,
        segments: 4,
        ms: 210,
        reason: "ingest",
      }),
      JSON.stringify({
        level: 50,
        time: new Date(63_000).toISOString(),
        pid: 1,
        msg: "processing window failed",
        err: { message: "secret detail" },
      }),
      "not json",
      JSON.stringify({ level: 30, time: new Date(10).toISOString(), msg: "load", uploads: 99 }),
    ].join("\n");
    const read = readAppLog(log, 950);
    assert.deepEqual(read.loadLines, [
      { t: 61_000, intervalS: 60, loopP99Ms: 21.2, uploads: 31, points: 1804, queueAgeS: null },
    ]);
    assert.deepEqual(read.windows, [
      { t: 62_000, points: 3600, segments: 4, ms: 210, reason: "ingest" },
    ]);
    assert.equal(read.listeningAt, 900);
    assert.equal(read.errors, 1);
    // Nothing of a line's text or of a device is kept.
    const kept = JSON.stringify(read);
    assert.ok(
      !kept.includes(token) && !kept.includes("secret detail") && !kept.includes("0199a0f3"),
    );
  });

  it("turns two samples into a row of rates", () => {
    const sample = (/** @type {number} */ t, /** @type {number} */ k) => ({
      t,
      db: { xact_commit: 100 * k, blks_hit: 990 * k, blks_read: 10 * k },
      wal: { wal_bytes: 1_048_576 * k, wal_fpi: 50 * k },
      checkpoints: { num_timed: k, num_requested: 0 },
      tables: {
        locations: { ins: 3600 * k },
        processed_points: { ins: 3600 * k, upd: 7200 * k },
        devices: { upd: 100 * k, hot: 100 * k, dead: 3 },
        heat_cells: { upd: 200 * k, hot: 180 * k, dead: 9 },
      },
      activity: { active: 2, lockWaits: 0, longestLockWaitS: 0 },
      sizeBytes: 50 * 1_048_576 * k,
    });
    const row = rowOf(sample(0, 1), sample(10, 2), { app: { cpu: 0.12, memMb: 180 } }, 0);
    assert.equal(row.elapsed_s, 10);
    assert.equal(row.commits_s, 10);
    assert.equal(row.cache_hit, 0.99);
    assert.equal(row.wal_kb_s, 102.4);
    assert.equal(row.locations_ins_s, 360);
    assert.equal(row.processed_writes_s, 1080);
    assert.equal(row.devices_hot, 1);
    assert.equal(row.heat_hot, 0.9);
    assert.equal(row.app_cpu, 0.12);
    assert.equal(row.db_size_mb, 100);
  });

  it("reads docker stats' units", () => {
    assert.deepEqual(parseDockerStats({ CPUPerc: "12.5%", MemUsage: "512MiB / 1GiB" }), {
      cpu: 0.125,
      memMb: 512,
    });
    assert.deepEqual(parseDockerStats({ CPUPerc: "101.00%", MemUsage: "1.5GiB / 2GiB" }), {
      cpu: 1.01,
      memMb: 1536,
    });
    assert.equal(parseDockerStats({ CPUPerc: "--", MemUsage: "0B / 0B" }).cpu, 0);
  });
});
