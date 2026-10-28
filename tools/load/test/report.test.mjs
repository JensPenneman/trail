import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { limits, renderReport, writeReport } from "../report.mjs";

const token = `trl_${"k".repeat(43)}`;
const session = "s".repeat(43);

const tables = (/** @type {number} */ k) => ({
  locations: { ins: 3600 * k, upd: 0, hot: 0, del: 0, live: 3600 * k, dead: 0 },
  processed_points: { ins: 3600 * k, upd: 10_000 * k, hot: 0, del: 0, live: 3600 * k, dead: 10 },
  devices: { ins: 0, upd: 300 * k, hot: 300 * k, del: 0, live: 11, dead: 1 },
  heat_cells: { ins: 50 * k, upd: 900 * k, hot: 850 * k, del: 0, live: 400, dead: 20 },
});
const sample = (/** @type {number} */ t, /** @type {number} */ k) => ({
  t,
  db: { xact_commit: 1000 * k, blks_hit: 99_000 * k, blks_read: 100 * k },
  wal: { wal_bytes: 4_000_000 * k, wal_fpi: 100 * k },
  checkpoints: { num_timed: k, num_requested: 0 },
  tables: tables(k),
  activity: {},
  sizeBytes: 20_000_000 * k,
});
const trend = (/** @type {number} */ count, /** @type {number} */ p95) => ({
  values: {
    count,
    "p(50)": p95 / 2,
    "p(90)": p95 * 0.9,
    "p(95)": p95,
    "p(99)": p95 * 1.5,
    max: p95 * 2,
    med: p95 / 2,
  },
});

function context(
  /** @type {{ batchOneP95?: number, serverOne?: { p50: number, p95: number, p99: number } }} */ options = {},
) {
  return {
    run: {
      scenario: "fleet-10",
      preset: { daySeconds: 1800, backlogHours: 8, sseStreams: 1, opensPerMinute: 1 },
      seed: 1,
      commit: "abc1234",
      branch: "feat/load-harness",
      dirty: false,
      image: "trail-load:abc1234",
      startedAt: "2026-10-28T10:00:00.000Z",
      finishedAt: "2026-10-28T10:40:00.000Z",
      machine: {
        model: "Apple M2 Pro",
        memoryGb: 16,
        os: "27.0",
        docker: { version: "29.9.2", cpus: 8, memoryGb: 9.7 },
      },
      caps: { app: "1 CPU / 1024 MiB", db: "2 CPU / 2048 MiB", k6: "2 CPU / 1024 MiB" },
      fsync: { fdatasync: 2400, open_datasync: 2300 },
      startupS: 3.1,
      fleet: {
        phones: 10,
        mix: "default",
        profiles: { "overland-high-resolution": 1, gpslogger: 1 },
      },
      history: null,
      phases: { day: { k6Exit: 0 }, backlog: { k6Exit: 99 } },
    },
    day: {
      metrics: {
        "http_req_duration{phase:day,kind:ingest,batch:1}": trend(120, options.batchOneP95 ?? 9),
        "http_req_duration{phase:day,kind:ingest,batch:2-99}": trend(30, 20),
        "http_req_duration{kind:dashboard,endpoint:people}": trend(30, 25),
        "ingest_failed{phase:day}": { values: { rate: 0 } },
        "ingest_throttled{phase:day}": { values: { rate: 0 } },
        points_dropped: { values: { count: 0 } },
        points_acked: { values: { count: 3000 } },
        dropped_iterations: { values: { count: 0 } },
      },
    },
    backlog: {
      metrics: {
        "http_req_duration{phase:backlog,kind:ingest,batch:400-699}": trend(26, 60),
        "ingest_throttled{phase:backlog}": { values: { rate: 0.001 } },
        "ingest_failed{phase:backlog}": { values: { rate: 0 } },
        points_acked: { values: { count: 500 } },
        backlog_drain_s: { values: { max: 12, med: 3 } },
      },
    },
    probe: {
      streams: 2,
      intervalS: 5,
      counts: { uploads: 100, acked: 100, reconnects: 0, failedOpens: 0 },
      events: { hello: 2, ingest: 140 },
      deliveryMs: { n: 100, p50: 10, p95: 25, p99: 40, max: 60 },
      afterAnswerMs: { n: 100, p50: 1, p95: 2, p99: 3, max: 5 },
      fanoutMs: { n: 140, p50: 12, p95: 30, p99: 45, max: 70 },
      processingMs: { n: 20, p50: 4000, p95: 9000, p99: 9500, max: 9800 },
    },
    collector: {
      first: sample(0, 1),
      last: sample(1800, 2),
      statements: [
        {
          calls: 10,
          totalMs: 100,
          meanMs: 10,
          maxMs: 30,
          rows: 10,
          query: "SELECT 1 FROM devices WHERE id = $1",
        },
      ],
      sizes: { locations: { totalBytes: 3_000_000, rows: 7200 } },
      app: {
        loadLines: [
          { loopP99Ms: 12, loopMaxMs: 40, rssMb: 160, heapUsedMb: 60, queueAgeS: 3, streams: 2 },
        ],
        windows: [{ points: 3600, ms: 400 }],
        errors: 0,
        warnings: 0,
      },
    },
    checks: {
      stored: { total: 3600 + 100, history: 0 },
      ingestLog: {
        day: {
          classes: [],
          byProfile: [],
          designClasses: [
            { batch: "1", n: 124, ...(options.serverOne ?? { p50: 5, p95: 9, p99: 14 }) },
            { batch: "2-99", n: 31, p50: 9, p95: 17, p99: 26 },
          ],
        },
        backlog: {
          classes: [],
          designClasses: [{ batch: "400-699", n: 26, p50: 30, p95: 60, p99: 90 }],
        },
      },
    },
    csvRows: [
      { app_cpu: "0.05", db_cpu: "0.1", k6_cpu: "0.2", app_mem_mb: "170", db_mem_mb: "200" },
    ],
    csvName: "2026-10-28-abc1234-fleet-10.csv",
    limits,
  };
}

describe("the report", () => {
  it("holds every target of §3 with what was measured, and passes when the gates hold", () => {
    const { markdown, rows, failedGates } = renderReport(context());
    assert.equal(failedGates.length, 0, JSON.stringify(failedGates));
    assert.match(markdown, /^# fleet-10 · 2026-10-28 · abc1234/);
    assert.match(markdown, /\*\*PASS\*\*/);
    assert.ok(
      rows.some(
        (r) =>
          r.target === "upload of 1 point, p95 ≤ 40 ms (server side)" &&
          r.measured === "9.0 ms (n 124)" &&
          r.verdict === "pass" &&
          r.gate,
      ),
    );
    // k6's own durations are shown beside, tracked.
    assert.ok(
      rows.some(
        (r) =>
          r.target.startsWith("upload of 1 point as k6 sees it") &&
          r.measured === "4.5 / 9.0 / 13.5 ms (n 120)" &&
          !r.gate,
      ),
    );
    assert.ok(
      rows.some(
        (r) =>
          r.target === "backlog flush, batches of 400–699 points, p50 ≤ 100 ms (server side)" &&
          r.verdict === "pass",
      ),
    );
    assert.ok(
      rows.some(
        (r) => r.target.startsWith("upload of 700 points or more") && r.verdict === "no samples",
      ),
    );
    assert.ok(
      rows.some((r) => r.target.startsWith("SSE delivery lag, p95") && r.measured.startsWith("25")),
    );
    // The run's own numbers derive: amplification (3600 + 10 000 writes for 3600 points), WAL a point.
    assert.ok(
      rows.some(
        (r) => r.target.startsWith("processing amplification") && r.measured === "3.8" && !r.gate,
      ),
    );
    assert.match(markdown, /## What this run cannot tell/);
    assert.match(markdown, /\[2026-10-28-abc1234-fleet-10\.csv\]/);
  });

  it("fails when a phase measured nothing", () => {
    const missing = context();
    const { failedGates } = renderReport({ ...missing, backlog: null });
    assert.deepEqual(
      failedGates.map((r) => r.target),
      ["the backlog phase ran to its end (a k6 summary, exit 0 or 99)"],
    );
    const crashed = context();
    crashed.run.phases.day.k6Exit = 107;
    assert.equal(
      renderReport(crashed).failedGates[0]?.target,
      "the day phase ran to its end (a k6 summary, exit 0 or 99)",
    );
  });

  it("fails when a gated target is missed, and says which — the server side, not k6's", () => {
    // k6 slower than the targets, the server within them: tracked, the run holds.
    const slowClient = renderReport(context({ batchOneP95: 55 }));
    assert.equal(slowClient.failedGates.length, 0);
    assert.ok(
      slowClient.rows.some(
        (r) => r.target.startsWith("upload of 1 point as k6 sees it") && r.verdict === "FAIL",
      ),
    );
    const { markdown, failedGates } = renderReport(
      context({ serverOne: { p50: 20, p95: 55, p99: 80 } }),
    );
    assert.deepEqual(
      failedGates.map((r) => r.target),
      [
        "upload of 1 point, p50 ≤ 12 ms (server side)",
        "upload of 1 point, p95 ≤ 40 ms (server side)",
      ],
    );
    assert.match(
      markdown,
      /\*\*FAIL\*\* — 2 gated targets missed: upload of 1 point, p50 ≤ 12 ms \(server side\); upload of 1 point, p95 ≤ 40 ms \(server side\)/,
    );
  });

  const folder = mkdtempSync(join(tmpdir(), "trailload-report-"));
  after(() => rmSync(folder, { recursive: true, force: true }));

  it("is written with its CSV and indexed, and never with a secret in it", () => {
    const run = join(folder, "run");
    const out = join(folder, "perf");
    mkdirSync(run);
    mkdirSync(out);
    const c = context();
    writeFileSync(join(run, "run.json"), JSON.stringify(c.run));
    writeFileSync(join(run, "day.summary.json"), JSON.stringify(c.day));
    writeFileSync(join(run, "backlog.summary.json"), JSON.stringify(c.backlog));
    writeFileSync(join(run, "probe.result.json"), JSON.stringify(c.probe));
    writeFileSync(join(run, "checks.json"), JSON.stringify(c.checks));
    writeFileSync(join(run, "collector.csv"), "elapsed_s,app_cpu\n10,0.05\n");
    writeFileSync(
      join(run, "fleet.json"),
      JSON.stringify({ people: [{ session, devices: [{ token, deviceKey: "load-abc123-1" }] }] }),
    );
    writeFileSync(
      join(out, "README.md"),
      "# perf\n\n<!-- runs:start -->\n| Run | Date | Commit | Scenario | Gates |\n| --- | --- | --- | --- | --- |\n<!-- runs:end -->\n",
    );
    writeFileSync(join(run, "collector.json"), JSON.stringify(c.collector));
    const { name } = writeReport(run, { outDir: out });
    assert.equal(name, "2026-10-28-abc1234-fleet-10");
    const written = readFileSync(join(out, `${name}.md`), "utf8");
    assert.ok(!written.includes(token) && !written.includes(session));
    assert.equal(readFileSync(join(out, `${name}.csv`), "utf8"), "elapsed_s,app_cpu\n10,0.05\n");
    assert.match(
      readFileSync(join(out, "README.md"), "utf8"),
      /\| \[2026-10-28-abc1234-fleet-10\]\(2026-10-28-abc1234-fleet-10\.md\) \| 2026-10-28 \| `abc1234` \| fleet-10 \| pass \|/,
    );

    // A statement that quoted a session would put it into the report: refused.
    writeFileSync(
      join(run, "collector.json"),
      JSON.stringify({
        ...c.collector,
        statements: [
          {
            calls: 1,
            totalMs: 1,
            meanMs: 1,
            maxMs: 1,
            rows: 0,
            query: `SET x = 'trail_session=${session}'`,
          },
        ],
      }),
    );
    assert.throws(
      () => writeReport(run, { outDir: out }),
      /refusing to write the report: it would hold/,
    );
  });
});
