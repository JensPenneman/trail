/*
 * The report of a run (docs/design/capacity.md §6.3): k6's summaries, the
 * collector's samples, the SSE probe and the database's own record of the run
 * turned into one markdown file under docs/perf/ — the scenario, the commit,
 * the machine, every target of §3 with what was measured and whether it held,
 * the details behind them and the collector's CSV next to it. A run that fails
 * a target is reported all the same. A report that would hold a token, a
 * session, an address or a position is not written.
 *
 *   node tools/load/report.mjs <run folder> [--out docs/perf]
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { m0 } from "./lib/baseline.js";
import { profiles } from "./lib/profiles.js";
import { leaksIn, secretsOf } from "./lib/redact.js";
import { show } from "./lib/stats.mjs";
import {
  calibration,
  dashboardTargets,
  errorBudget,
  ingestTargets,
  serverTargets,
} from "./lib/targets.js";

const perfFolder = fileURLToPath(new URL("../../docs/perf/", import.meta.url));

/**
 * @param {string} folder
 * @param {string} name
 */
function readJson(folder, name) {
  const path = join(folder, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/**
 * The values of a k6 metric (or submetric) in a summary, or null.
 * @param {any} summary
 * @param {string} name
 * @returns {Record<string, number> | null}
 */
function metric(summary, name) {
  return summary?.metrics?.[name]?.values ?? null;
}

/**
 * @typedef {{ section: string, target: string, measured: string, verdict: "pass" | "FAIL" | "no samples" | "not measured", gate: boolean }} Row
 */

/**
 * A target row: `value` against a limit.
 * @param {string} section
 * @param {string} target
 * @param {number | null | undefined} value
 * @param {(value: number) => boolean} holds
 * @param {string} unit
 * @param {boolean} gate
 * @param {number} [digits]
 * @returns {Row}
 */
function row(section, target, value, holds, unit, gate, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { section, target, measured: "—", verdict: "no samples", gate };
  }
  return {
    section,
    target,
    measured: `${show(value, digits)}${unit}`,
    verdict: holds(value) ? "pass" : "FAIL",
    gate,
  };
}

/** @param {number | null | undefined} value */
const percent = (value) => (value === null || value === undefined ? null : value * 100);

/** @param {number | null | undefined} ms */
const seconds = (ms) => (ms === null || ms === undefined ? null : ms / 1000);

/**
 * The larger of two measures, either of which may be missing.
 * @param {number | null | undefined} a
 * @param {number | null | undefined} b
 */
const longest = (a, b) => {
  const values = [a, b].filter((value) => typeof value === "number" && Number.isFinite(value));
  return values.length === 0 ? null : Math.max(.../** @type {number[]} */ (values));
};

/**
 * "1 day", "2 days".
 * @param {number} count
 * @param {string} noun
 */
const plural = (count, noun) => `${show(count)} ${noun}${count === 1 ? "" : "s"}`;

/** A thousand phones' points a day (docs/design/capacity.md §2.3): what WAL and disk scale with. */
const pointsPerDay1000 = 3_118_000;

/**
 * Every target of §3 with what the run measured. `gate`: the targets this
 * milestone (M1) is held to; the others are tracked until the work that
 * moves them lands (docs/perf/README.md, "Gates").
 * @param {any} context
 * @returns {Row[]}
 */
export function targetRows(context) {
  const { day, backlog, probe, run, derived } = context;
  /** @type {Row[]} */
  const rows = [];
  // A phase without its summary (k6 crashed, the container went) measured nothing: that fails.
  for (const [phase, summary] of /** @type {const} */ ([
    ["day", day],
    ["backlog", backlog],
  ])) {
    const exit = run.phases?.[phase]?.k6Exit;
    const ran = summary !== null && (exit === 0 || exit === 99);
    rows.push({
      section: "6.2",
      target: `the ${phase} phase ran to its end (a k6 summary, exit 0 or 99)`,
      measured: summary === null ? "no summary" : `exit ${exit ?? "?"}`,
      verdict: ran ? "pass" : "FAIL",
      gate: true,
    });
  }
  for (const target of ingestTargets) {
    const values = metric(day, `http_req_duration{phase:day,kind:ingest,batch:${target.batch}}`);
    const samples = values?.["count"] ?? 0;
    const scaled = (/** @type {number} */ limit) => limit / calibration.latency;
    for (const [stat, limit] of /** @type {const} */ ([
      ["p(50)", target.p50],
      ["p(95)", target.p95],
      ["p(99)", target.p99],
    ])) {
      rows.push(
        row(
          "3.1",
          `upload of ${target.label}, ${stat.replace("p(", "p").replace(")", "")} ≤ ${show(scaled(limit))} ms`,
          samples > 0 ? values?.[stat] : null,
          (value) => value <= scaled(limit),
          ` ms (n ${show(samples)})`,
          true,
          1,
        ),
      );
    }
  }
  // The flush's own row of §3.1 (500 points), as backlog.js holds it.
  const flushTarget = ingestTargets.find((target) => target.batch === "400-699");
  const backlogLarge = metric(
    backlog,
    "http_req_duration{phase:backlog,kind:ingest,batch:400-699}",
  );
  if (flushTarget !== undefined) {
    for (const [stat, limit] of /** @type {const} */ ([
      ["p(50)", flushTarget.p50],
      ["p(95)", flushTarget.p95],
      ["p(99)", flushTarget.p99],
    ])) {
      const scaled = limit / calibration.latency;
      rows.push(
        row(
          "3.1",
          `backlog flush, batches of 400–699 points, ${stat.replace("p(", "p").replace(")", "")} ≤ ${show(scaled)} ms`,
          (backlogLarge?.["count"] ?? 0) > 0 ? backlogLarge?.[stat] : null,
          (value) => value <= scaled,
          ` ms (n ${show(backlogLarge?.["count"] ?? 0)})`,
          true,
          1,
        ),
      );
    }
  }
  rows.push(
    row(
      "3.1",
      `failed valid uploads ≤ ${errorBudget.failed * 100} %`,
      percent(metric(day, "ingest_failed{phase:day}")?.["rate"]),
      (v) => v <= errorBudget.failed * 100,
      " %",
      true,
      3,
    ),
    row(
      "3.1",
      `429/503 of the limits on a normal day ≤ ${errorBudget.throttledDay * 100} %`,
      percent(metric(day, "ingest_throttled{phase:day}")?.["rate"]),
      (v) => v <= errorBudget.throttledDay * 100,
      " %",
      true,
      3,
    ),
    row(
      "3.1",
      `429/503 during the backlog flush ≤ ${errorBudget.throttledBacklog * 100} %`,
      percent(metric(backlog, "ingest_throttled{phase:backlog}")?.["rate"]),
      (v) => v <= errorBudget.throttledBacklog * 100,
      " %",
      true,
      3,
    ),
    row(
      "3.1",
      "failed uploads during the backlog flush ≤ 0.01 %",
      percent(metric(backlog, "ingest_failed{phase:backlog}")?.["rate"]),
      (v) => v <= errorBudget.failed * 100,
      " %",
      true,
      3,
    ),
    row(
      "3.1",
      "zero data loss: points an app dropped",
      (metric(day, "points_dropped")?.["count"] ?? 0) +
        (metric(backlog, "points_dropped")?.["count"] ?? 0),
      (v) => v === 0,
      "",
      true,
    ),
    row(
      "3.1",
      "zero data loss: acknowledged points not stored (net of stored ones never acknowledged)",
      derived.lostAcknowledged,
      (v) => v === 0,
      "",
      true,
    ),
  );
  for (const [endpoint, target] of Object.entries(dashboardTargets)) {
    if (target.p95 === null) continue;
    const values = metric(day, `http_req_duration{kind:dashboard,endpoint:${endpoint}}`);
    const limit = target.p95 / calibration.latency;
    rows.push(
      row(
        "3.2",
        `${target.label}, p95 ≤ ${show(limit)} ms`,
        (values?.["count"] ?? 0) > 0 ? values?.["p(95)"] : null,
        (v) => v <= limit,
        ` ms (n ${show(values?.["count"] ?? 0)})`,
        true,
        1,
      ),
    );
  }
  rows.push(
    row(
      "3.2",
      `SSE delivery lag, p95 ≤ ${serverTargets.sseLagP95Ms} ms`,
      probe?.deliveryMs?.p95,
      (v) => v <= serverTargets.sseLagP95Ms,
      ` ms (n ${show(probe?.deliveryMs?.n ?? 0)})`,
      true,
    ),
    row(
      "3.2",
      `SSE delivery lag, p99 ≤ ${serverTargets.sseLagP99Ms} ms`,
      probe?.deliveryMs?.p99,
      (v) => v <= serverTargets.sseLagP99Ms,
      " ms",
      true,
    ),
    row(
      "3.2",
      `event loop p99 over any minute ≤ ${serverTargets.loopP99Ms} ms`,
      derived.loopP99Max,
      (v) => v <= serverTargets.loopP99Ms,
      " ms",
      true,
      1,
    ),
    row(
      "3.2",
      `event loop delay ever ≤ ${serverTargets.loopMaxMs} ms`,
      derived.loopMax,
      (v) => v <= serverTargets.loopMaxMs,
      " ms",
      true,
      1,
    ),
    row(
      "3.2",
      `processing queue age p95 ≤ ${serverTargets.queueAgeP95QuietS / 60} min (quiet), ≤ ${serverTargets.queueAgeP95PeakS / 60} min (peak): upload → its \`segments\` event (the probe)`,
      seconds(probe?.processingMs?.p95),
      (v) => v <= serverTargets.queueAgeP95PeakS,
      ` s (n ${show(probe?.processingMs?.n ?? 0)})`,
      false,
      1,
    ),
    row(
      "3.2",
      "processing queue age never over 1 h (the probe's longest; the load lines' oldest ready window)",
      longest(seconds(probe?.processingMs?.max), derived.queueAgeMax),
      (v) => v <= serverTargets.queueAgeMaxS,
      " s",
      false,
      1,
    ),
    row(
      "3.2",
      `processing throughput ≥ ${show(serverTargets.processingPointsPerS)} points/s (backfill)`,
      run.history?.pointsPerSecond,
      (v) => v >= serverTargets.processingPointsPerS,
      " points/s",
      false,
    ),
    row(
      "3.2",
      `backfill ≥ ${serverTargets.backfillDeviceDaysPerHour} device-days an hour (averaged level)`,
      run.history?.deviceDaysPerHour,
      (v) => v >= serverTargets.backfillDeviceDaysPerHour,
      " device-days/h",
      false,
    ),
    row(
      "3.3",
      `app RSS ≤ ${serverTargets.appRssMb} MB`,
      derived.rssMax,
      (v) => v <= serverTargets.appRssMb,
      " MB",
      true,
    ),
    row(
      "3.3",
      `app heap ≤ ${serverTargets.appHeapMb} MB`,
      derived.heapMax,
      (v) => v <= serverTargets.appHeapMb,
      " MB",
      true,
    ),
    row(
      "3.3",
      `app CPU ≤ ${serverTargets.appCpuPeak * 100} % of its core at the peak (p95 of 10 s samples)`,
      percent(derived.appCpuP95),
      (v) => v <= serverTargets.appCpuPeak * 100,
      " %",
      false,
      1,
    ),
    row(
      "3.3",
      "db CPU ≤ 1 core sustained (mean)",
      derived.dbCpuMean,
      (v) => v <= serverTargets.dbCpuSustained,
      " cores",
      false,
      2,
    ),
    row(
      "3.3",
      `Postgres cache hit ≥ ${serverTargets.cacheHit * 100} %`,
      percent(derived.cacheHit),
      (v) => v >= serverTargets.cacheHit * 100,
      " %",
      false,
      2,
    ),
    row(
      "3.3",
      "checkpoints timed, never requested",
      derived.checkpointsRequested,
      (v) => v === 0,
      " requested",
      false,
    ),
    row(
      "3.3",
      `dead tuples ≤ ${serverTargets.deadTupleShare * 100} % on devices`,
      percent(derived.deadShare.devices),
      (v) => v <= serverTargets.deadTupleShare * 100,
      " %",
      false,
      1,
    ),
    row(
      "3.3",
      `dead tuples ≤ ${serverTargets.deadTupleShare * 100} % on heat_cells`,
      percent(derived.deadShare.heat_cells),
      (v) => v <= serverTargets.deadTupleShare * 100,
      " %",
      false,
      1,
    ),
    row(
      "3.3",
      `HOT share of devices' updates ≥ ${serverTargets.hotShare * 100} %`,
      percent(derived.hotShare.devices),
      (v) => v >= serverTargets.hotShare * 100,
      " %",
      false,
      1,
    ),
    row(
      "3.3",
      `HOT share of heat_cells' updates ≥ ${serverTargets.hotShare * 100} %`,
      percent(derived.hotShare.heat_cells),
      (v) => v >= serverTargets.hotShare * 100,
      " %",
      false,
      1,
    ),
    row(
      "3.3",
      "no statement over 5 s (the run's, pg_stat_statements)",
      derived.statementMaxMs,
      (v) => v <= serverTargets.statementMaxMs,
      " ms",
      false,
      1,
    ),
    row(
      "3.3",
      `WAL ≤ ${serverTargets.walPerDayGb} GB a day at 1 000 phones (scaled from this run)`,
      derived.walPerDayGb1000,
      (v) => v <= serverTargets.walPerDayGb,
      " GB",
      false,
      1,
    ),
    row(
      "3.3",
      `disk growth ≤ ${serverTargets.diskPerDayGb} GB a day at 1 000 phones (scaled)`,
      derived.diskPerDayGb1000,
      (v) => v <= serverTargets.diskPerDayGb,
      " GB",
      false,
      2,
    ),
    row(
      "5.2",
      `processing amplification ≤ ${serverTargets.amplification} writes of processed_points a point`,
      derived.amplification,
      (v) => v <= serverTargets.amplification,
      "",
      false,
      1,
    ),
    row(
      "3.3",
      `start-up to listening ≤ ${serverTargets.startupS} s (fresh database: migrations ran)`,
      run.startupS,
      (v) => v <= serverTargets.startupS,
      " s",
      false,
      1,
    ),
    row(
      "6.1",
      "the generator kept the open model (k6 dropped_iterations = 0)",
      metric(day, "dropped_iterations")?.["count"] ?? 0,
      (v) => v === 0,
      "",
      true,
    ),
  );
  return rows;
}

/**
 * What the run's numbers derive to (shares, maxima, the 1 000-phone scale).
 * @param {any} context
 */
export function derive(context) {
  const { day, backlog, probe, collector, checks } = context;
  const lines = collector?.app?.loadLines ?? [];
  /** @param {string} key */
  const maxOf = (key) => {
    const values = lines
      .map((/** @type {any} */ line) => line[key])
      .filter((/** @type {unknown} */ v) => typeof v === "number");
    return values.length === 0 ? null : Math.max(...values);
  };
  const ages = lines
    .map((/** @type {any} */ line) => line.queueAgeS)
    .filter((/** @type {unknown} */ v) => typeof v === "number")
    .sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
  /** @type {Record<string, string>[]} */
  const rows = context.csvRows ?? [];
  /**
   * @param {string} key
   * @returns {number[]}
   */
  const column = (key) => rows.map((r) => Number(r[key])).filter((v) => Number.isFinite(v));
  /** @param {number[]} values @param {number} p */
  const pct = (values, p) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
  };
  const first = collector?.first;
  const last = collector?.last;
  /** @param {string} table @param {string} field */
  const delta = (table, field) =>
    (last?.tables?.[table]?.[field] ?? 0) - (first?.tables?.[table]?.[field] ?? 0);
  const hits = (last?.db?.blks_hit ?? 0) - (first?.db?.blks_hit ?? 0);
  const reads = (last?.db?.blks_read ?? 0) - (first?.db?.blks_read ?? 0);
  const seconds = Math.max(1, (last?.t ?? 0) - (first?.t ?? 0));
  const walBytes = (last?.wal?.wal_bytes ?? 0) - (first?.wal?.wal_bytes ?? 0);
  const sizeBytes = (last?.sizeBytes ?? 0) - (first?.sizeBytes ?? 0);
  const pointsIn = delta("locations", "ins");
  // By the point: a thousand phones store 3.1 M a day (§2.3), whatever the run's mix of phases.
  const perDay1000 = (/** @type {number} */ bytes) =>
    pointsIn > 0 ? ((bytes / pointsIn) * pointsPerDay1000) / 1e9 : null;
  const acked =
    (metric(day, "points_acked")?.["count"] ?? 0) +
    (metric(backlog, "points_acked")?.["count"] ?? 0) +
    (probe?.counts?.acked ?? 0);
  /** @param {string} table */
  const dead = (table) => {
    const live = last?.tables?.[table]?.live ?? 0;
    const deadRows = last?.tables?.[table]?.dead ?? 0;
    return live + deadRows > 0 ? deadRows / (live + deadRows) : null;
  };
  /** @param {string} table */
  const hot = (table) => {
    const updates = delta(table, "upd");
    return updates > 0 ? delta(table, "hot") / updates : null;
  };
  const statementMax = (collector?.statements ?? [])
    .map((/** @type {any} */ s) => Number(s.maxMs))
    .filter((/** @type {number} */ v) => Number.isFinite(v));
  return {
    loopP99Max: maxOf("loopP99Ms"),
    loopMax: maxOf("loopMaxMs"),
    rssMax: maxOf("rssMb"),
    heapMax: maxOf("heapUsedMb"),
    poolWaitingMax: maxOf("poolWaiting"),
    streamsMax: maxOf("streams"),
    backgroundMax: maxOf("background"),
    dailyStatsMax: maxOf("dailyStatsDays"),
    queueAgeP95:
      ages.length === 0
        ? null
        : (ages[Math.min(ages.length - 1, Math.ceil(0.95 * ages.length) - 1)] ?? null),
    queueAgeMax: ages.length === 0 ? null : ages.at(-1),
    appCpuP95: pct(column("app_cpu"), 95),
    appCpuMax: pct(column("app_cpu"), 100),
    appCpuMean:
      column("app_cpu").reduce((a, b) => a + b, 0) / Math.max(1, column("app_cpu").length),
    dbCpuMean: column("db_cpu").reduce((a, b) => a + b, 0) / Math.max(1, column("db_cpu").length),
    dbCpuMax: pct(column("db_cpu"), 100),
    k6CpuMax: pct(column("k6_cpu"), 100),
    hostLoadMax: pct(column("host_load1"), 100),
    othersCpuMax: pct(column("others_cpu"), 100),
    othersCpuMean:
      column("others_cpu").reduce((a, b) => a + b, 0) / Math.max(1, column("others_cpu").length),
    appMemMax: pct(column("app_mem_mb"), 100),
    dbMemMax: pct(column("db_mem_mb"), 100),
    cacheHit: hits + reads > 0 ? hits / (hits + reads) : null,
    checkpointsRequested:
      (last?.checkpoints?.num_requested ?? 0) - (first?.checkpoints?.num_requested ?? 0),
    checkpointsTimed: (last?.checkpoints?.num_timed ?? 0) - (first?.checkpoints?.num_timed ?? 0),
    deadShare: { devices: dead("devices"), heat_cells: dead("heat_cells") },
    hotShare: {
      devices: hot("devices"),
      heat_cells: hot("heat_cells"),
      daily_stats: hot("daily_stats"),
    },
    statementMaxMs: statementMax.length === 0 ? null : Math.max(...statementMax),
    walBytes,
    walPerPoint: pointsIn > 0 ? walBytes / pointsIn : null,
    walPerDayGb1000: walBytes > 0 ? perDay1000(walBytes) : null,
    diskPerDayGb1000: sizeBytes > 0 ? perDay1000(sizeBytes) : null,
    sizeBytes,
    pointsIn,
    processedWrites: delta("processed_points", "ins") + delta("processed_points", "upd"),
    amplification:
      pointsIn > 0
        ? (delta("processed_points", "ins") + delta("processed_points", "upd")) / pointsIn
        : null,
    acked,
    lostAcknowledged:
      checks === null ? null : Math.max(0, acked - (checks.stored.total - checks.stored.history)),
    seconds,
    tableDeltas: Object.fromEntries(
      Object.keys(last?.tables ?? {}).map((table) => [
        table,
        {
          ins: delta(table, "ins"),
          upd: delta(table, "upd"),
          hot: delta(table, "hot"),
          del: delta(table, "del"),
        },
      ]),
    ),
  };
}

/** @param {readonly string[]} cells */
const tableRow = (cells) => `| ${cells.join(" | ")} |`;

/**
 * A markdown table.
 * @param {readonly string[]} header
 * @param {readonly (readonly string[])[]} body
 */
function table(header, body) {
  return [tableRow(header), tableRow(header.map(() => "---")), ...body.map(tableRow)].join("\n");
}

/**
 * The §2.2 day of a profile at 91.5 moving minutes: points and uploads.
 * @param {string} name
 */
export function designDay(name) {
  /** @type {Record<string, readonly [number, number]>} */
  const designed = {
    "overland-balanced": [1_100, 22],
    "overland-balanced-plus": [6_570, 22],
    "overland-high-resolution": [42_000, 1_440],
    "overland-battery-saver": [150, 37],
    "owntracks-ios-move": [2_450, 2_450],
    "owntracks-ios-significant": [100, 100],
    "owntracks-android": [300, 300],
    traccar: [200, 200],
    osmand: [1_100, 1_100],
    gpslogger: [1_440, 1_440],
  };
  const entry = designed[name];
  return entry === undefined ? null : { points: entry[0], uploads: entry[1] };
}

/**
 * The markdown of a run.
 * @param {any} context
 */
export function renderReport(context) {
  const { run, day, backlog, probe, collector, checks } = context;
  const derived = derive(context);
  const rows = targetRows({ ...context, derived });
  const gated = rows.filter((r) => r.gate);
  const failedGates = gated.filter((r) => r.verdict === "FAIL");
  const failedTracked = rows.filter((r) => !r.gate && r.verdict === "FAIL");
  const verdict =
    failedGates.length === 0
      ? `**PASS** — every gated target held (${gated.filter((r) => r.verdict === "pass").length} measured, ${gated.filter((r) => r.verdict === "no samples").length} without samples); ${failedTracked.length} tracked targets missed`
      : `**FAIL** — ${failedGates.length} gated targets missed: ${failedGates.map((r) => r.target).join("; ")}`;
  const scale = 86_400 / run.preset.daySeconds;
  const machine = run.machine;
  const lines = [];
  lines.push(`# ${run.scenario} · ${run.startedAt.slice(0, 10)} · ${run.commit}`);
  lines.push("");
  lines.push(
    `A run of the load harness (docs/perf/README.md) against the capped stack on the Mac. Targets: docs/design/capacity.md §3; production's own numbers (M0, ${m0.measuredOn}) beside the Mac's where they compare.`,
  );
  lines.push("");
  lines.push(
    table(
      ["", ""],
      [
        [
          "Scenario",
          `${run.scenario}: ${run.fleet.phones} phones (mix ${run.fleet.mix}), one day played in ${show(run.preset.daySeconds)} s (×${show(scale, 0)}), seed ${run.seed}; ${run.history === null ? "no history" : `${plural(run.history.days, "day")} of history (${show(run.history.rows)} points)`}; a backlog of ${run.preset.backlogHours} h; ${plural(run.preset.sseStreams, "SSE stream")} and the probe`,
        ],
        [
          "Commit",
          `\`${run.commit}\`${run.dirty ? " (with uncommitted changes)" : ""} on \`${run.branch}\`, image \`${run.image}\``,
        ],
        ["When", `${run.startedAt} – ${run.finishedAt}`],
        [
          "The Mac meanwhile",
          `load average ${show(run.machineAtStart?.load1, 1)} at the start, at most ${show(derived.hostLoadMax, 1)} during the run; the other containers ${show(run.machineAtStart?.othersCpu, 2)} CPUs at the start, at most ${show(derived.othersCpuMax, 2)} (mean ${show(derived.othersCpuMean, 2)})`,
        ],
        [
          "Machine",
          `${machine.model}, ${machine.memoryGb} GB, macOS ${machine.os}; Docker ${machine.docker.version} (${machine.docker.cpus} CPUs, ${show(machine.docker.memoryGb, 1)} GB)`,
        ],
        [
          "Caps",
          `app ${run.caps.app}, db ${run.caps.db}, k6 ${run.caps.k6} (tools/load/compose.load.yaml)`,
        ],
        [
          "fsync (pg_test_fsync, db volume)",
          run.fsync === null
            ? "not measured"
            : `fdatasync ${show(run.fsync.fdatasync)} ops/s, open_datasync ${show(run.fsync.open_datasync)} ops/s — the node (M0): ${m0.fsync.fdatasync} and ${m0.fsync.open_datasync}`,
        ],
        ["Verdict", verdict],
      ],
    ),
  );
  lines.push("");
  lines.push("## Targets");
  lines.push("");
  lines.push(
    `Gated: what milestone 1 holds a run to. Tracked: reported now, held to the target once the work that moves it has landed (docs/perf/README.md, "Gates"). Latency targets are the node's divided by the calibration factor (${calibration.latency} until a node run exists).`,
  );
  lines.push("");
  lines.push(
    table(
      ["§", "Target", "Measured", "", "Gate"],
      rows.map((r) => [
        r.section,
        r.target,
        r.measured,
        r.verdict === "FAIL" ? "**FAIL**" : r.verdict,
        r.gate ? "gated" : "tracked",
      ]),
    ),
  );
  lines.push("");

  lines.push("## Workload as run");
  lines.push("");
  lines.push(
    `What the phones sent in the day phase, scaled to a day (×${show(scale, 0)}), against the design's day of each profile (§2.2, at 91.5 moving minutes). A compressed day keeps the rates; the 5-minute senders' batches are smaller, because their moves shrink with the day.`,
  );
  lines.push("");
  const byProfile = checks?.ingestLog?.day?.byProfile ?? [];
  lines.push(
    table(
      [
        "Profile",
        "Phones",
        "Uploads/day §2.2",
        "Uploads/day run",
        "Points/day §2.2",
        "Points/day run",
        "Points/upload run",
      ],
      Object.keys(profiles).map((name) => {
        const phones = run.fleet.profiles[name] ?? 0;
        const design = designDay(name);
        const measured = byProfile.find((/** @type {any} */ entry) => entry.profile === name);
        const uploads =
          measured === undefined || phones === 0 ? null : (measured.uploads / phones) * scale;
        const points =
          measured === undefined || phones === 0 ? null : (measured.points / phones) * scale;
        return [
          `\`${name}\``,
          show(phones),
          show(design?.uploads),
          show(uploads),
          show(design?.points),
          show(points),
          show(
            measured === undefined || measured.uploads === 0
              ? null
              : measured.points / measured.uploads,
            1,
          ),
        ];
      }),
    ),
  );
  lines.push("");
  const rates = checks?.ingestLog?.day?.rates;
  const n = run.fleet.phones / 1000;
  if (rates !== undefined) {
    lines.push(
      table(
        ["Fleet", "§2.3 at this size", "Run"],
        [
          ["points/s, mean", show(36.1 * n, 2), show(rates.pointsPerSecond, 2)],
          [
            "points/s, busiest hour of the day",
            show(51.4 * n, 2),
            show(rates.peakHourPointsPerSecond, 2),
          ],
          ["requests/s, mean", show(5.59 * n, 3), show(rates.uploadsPerSecond, 3)],
          ["requests/s, busiest hour", show(9.42 * n, 3), show(rates.peakHourUploadsPerSecond, 3)],
          ["requests, busiest 10 s", "—", show(rates.worst10sUploads)],
        ],
      ),
    );
    lines.push("");
  }

  lines.push("## Ingest, client side (k6)");
  lines.push("");
  lines.push(
    "`http_req_duration` of the uploads by batch class: what the phone waits for, the network hop and the COMMIT included.",
  );
  lines.push("");
  const ingestBody = [];
  for (const [phase, summary] of /** @type {const} */ ([
    ["day", day],
    ["backlog", backlog],
  ])) {
    for (const target of ingestTargets) {
      const values = metric(
        summary,
        `http_req_duration{phase:${phase},kind:ingest,batch:${target.batch}}`,
      );
      if ((values?.["count"] ?? 0) === 0) continue;
      ingestBody.push([
        phase,
        target.label,
        show(values?.["count"]),
        show(values?.["p(50)"], 1),
        show(values?.["p(95)"], 1),
        show(values?.["p(99)"], 1),
        show(values?.["max"], 1),
      ]);
    }
  }
  lines.push(
    table(["Phase", "Batch", "Uploads", "p50 ms", "p95 ms", "p99 ms", "max ms"], ingestBody),
  );
  lines.push("");
  lines.push(
    table(
      [
        "Phase",
        "Acknowledged uploads",
        "Points acknowledged",
        "Retries",
        "Dropped points",
        "Left unsent at the end",
      ],
      [
        [
          "day",
          show(metric(day, "ingest_acked")?.["count"] ?? 0),
          show(metric(day, "points_acked")?.["count"] ?? 0),
          show(metric(day, "ingest_retries")?.["count"] ?? 0),
          show(metric(day, "points_dropped")?.["count"] ?? 0),
          show(metric(day, "points_unsent")?.["count"] ?? 0),
        ],
        [
          "backlog",
          show(metric(backlog, "ingest_acked")?.["count"] ?? 0),
          show(metric(backlog, "points_acked")?.["count"] ?? 0),
          show(metric(backlog, "ingest_retries")?.["count"] ?? 0),
          show(metric(backlog, "points_dropped")?.["count"] ?? 0),
          show(metric(backlog, "points_unsent")?.["count"] ?? 0),
        ],
      ],
    ),
  );
  lines.push("");
  const drain = metric(backlog, "backlog_drain_s");
  if (drain !== null) {
    lines.push(
      `The backlog of ${run.preset.backlogHours} h (${show(metric(backlog, "points_acked")?.["count"] ?? 0)} points) drained in ${show(drain["max"], 1)} s (the slowest phone; median ${show(drain["med"], 1)} s).`,
    );
    lines.push("");
  }

  lines.push("## Ingest, server side, against production");
  lines.push("");
  lines.push(
    "`ingest_log.duration_ms` by records per upload, the classes production was measured in (M0). The column ends before the COMMIT, so it leaves the fsync out; the probe's own uploads are not counted.",
  );
  lines.push("");
  const classes = checks?.ingestLog?.day?.classes ?? [];
  lines.push(
    table(
      [
        "Records",
        "Uploads",
        "p50 ms",
        "p95 ms",
        "p99 ms",
        "max ms",
        "Production p50 / p95 / p99",
        "p95 Mac ÷ node",
      ],
      m0.uploads.map((baseline) => {
        const measured = classes.find((/** @type {any} */ entry) => entry.batch === baseline.batch);
        return [
          baseline.batch,
          show(measured?.n),
          show(measured?.p50, 1),
          show(measured?.p95, 1),
          show(measured?.p99, 1),
          show(measured?.max, 1),
          `${show(baseline.p50)} / ${show(baseline.p95)} / ${show(baseline.p99)}`,
          measured?.p95 === undefined || measured?.p95 === null
            ? "—"
            : show(measured.p95 / baseline.p95, 2),
        ];
      }),
    ),
  );
  lines.push("");

  const designClasses = checks?.ingestLog?.day?.designClasses ?? [];
  if (designClasses.length > 0) {
    lines.push(
      "The same column in §3.1's classes, against its targets — §3 defines them server-side, as production can check them every day; the gates above are k6's, which add the COMMIT and the hop:",
    );
    lines.push("");
    lines.push(
      table(
        ["Batch", "Uploads", "p50 ms", "p95 ms", "p99 ms", "Target p50 / p95 / p99"],
        ingestTargets
          .map((target) => ({
            target,
            measured: designClasses.find(
              (/** @type {any} */ entry) => entry.batch === target.batch,
            ),
          }))
          .filter(({ measured }) => measured !== undefined)
          .map(({ target, measured }) => [
            target.label,
            show(measured.n),
            show(measured.p50, 1),
            show(measured.p95, 1),
            show(measured.p99, 1),
            `${target.p50} / ${target.p95} / ${target.p99}`,
          ]),
      ),
    );
    lines.push("");
  }

  lines.push("## Dashboard (k6)");
  lines.push("");
  lines.push(
    `People opened Trail ${show(run.preset.opensPerMinute)} times a minute (the evening peak's rate at this size, at least one), each open the home page's nine requests at once, then two History days and now and then the heatmap, Insights or the access log.`,
  );
  lines.push("");
  lines.push(
    table(
      ["Request", "n", "p50 ms", "p95 ms", "p99 ms", "max ms", "Target p95"],
      Object.entries(dashboardTargets).map(([endpoint, target]) => {
        const values = metric(day, `http_req_duration{kind:dashboard,endpoint:${endpoint}}`);
        return [
          target.label,
          show(values?.["count"] ?? 0),
          show(values?.["p(50)"], 1),
          show(values?.["p(95)"], 1),
          show(values?.["p(99)"], 1),
          show(values?.["max"], 1),
          target.p95 === null ? "—" : `${target.p95} ms`,
        ];
      }),
    ),
  );
  lines.push("");
  const failedDashboard = metric(day, "http_req_failed{kind:dashboard}");
  lines.push(`Failed dashboard requests: ${show(percent(failedDashboard?.["rate"] ?? 0), 2)} %.`);
  lines.push("");

  lines.push("## Live events (SSE probe)");
  lines.push("");
  if (probe === null) {
    lines.push("The probe did not report.");
  } else {
    lines.push(
      `${show(probe.streams)} streams; the probe uploaded a marked point every ${show(probe.intervalS)} s (${show(probe.counts.uploads)} uploads, ${show(probe.counts.acked)} acknowledged); ${show(probe.counts.reconnects)} reconnects, ${show(probe.counts.failedOpens)} refused opens. Events received: ${
        Object.entries(probe.events)
          .map(([type, count]) => `${type} ${show(Number(count))}`)
          .join(", ") || "none"
      }.`,
    );
    lines.push("");
    lines.push(
      table(
        ["Lag", "n", "p50 ms", "p95 ms", "p99 ms", "max ms"],
        [
          ["delivery: upload sent → its `ingest` event", probe.deliveryMs],
          ["after the answer: upload acknowledged → its event", probe.afterAnswerMs],
          ["fan-out: server's receivedAt → `ingest` event, every stream", probe.fanoutMs],
          ["processing: upload sent → `segments` event covering it", probe.processingMs],
        ].map(([label, values]) => [
          String(label),
          show(values?.n),
          show(values?.p50),
          show(values?.p95),
          show(values?.p99),
          show(values?.max),
        ]),
      ),
    );
  }
  lines.push("");

  lines.push("## The app and the containers");
  lines.push("");
  lines.push(
    table(
      ["", "Peak", "Notes"],
      [
        [
          "event loop p99 (a minute's)",
          `${show(derived.loopP99Max, 1)} ms`,
          `the longest delay ${show(derived.loopMax, 1)} ms`,
        ],
        [
          "app RSS / heap",
          `${show(derived.rssMax)} / ${show(derived.heapMax)} MB`,
          `docker stats: ${show(derived.appMemMax)} MB of 1 GiB`,
        ],
        [
          "app CPU",
          `${show(percent(derived.appCpuMax), 0)} % of its core`,
          `mean ${show(percent(derived.appCpuMean), 1)} %, p95 ${show(percent(derived.appCpuP95), 1)} %`,
        ],
        [
          "db CPU",
          `${show(derived.dbCpuMax, 2)} cores`,
          `mean ${show(derived.dbCpuMean, 2)} cores; memory peak ${show(derived.dbMemMax)} MB of 2 GiB`,
        ],
        ["k6", `${show(derived.k6CpuMax, 2)} cores`, "beside the stack on the same machine"],
        [
          "pool waiting",
          show(derived.poolWaitingMax),
          "requests waiting for one of the 10 connections",
        ],
        ["SSE streams", show(derived.streamsMax), ""],
        [
          "background tasks",
          show(derived.backgroundMax),
          `daily statistics waiting: ${show(derived.dailyStatsMax)} device-days`,
        ],
        [
          "processing queue age (load lines)",
          `${show(derived.queueAgeMax)} s`,
          `the oldest ready new data since it was queued; p95 of the minutes ${show(derived.queueAgeP95)} s`,
        ],
      ],
    ),
  );
  lines.push("");
  /** @type {{ points: number, ms: number }[]} */
  const windows = collector?.app?.windows ?? [];
  if (windows.length > 0) {
    let points = 0;
    let ms = 0;
    for (const window of windows) {
      points += window.points;
      ms += window.ms;
    }
    lines.push(
      `Processing: ${show(windows.length)} windows, ${show(points)} points read and worked out again, ${show(ms / 1000, 1)} s of passes (${show(points / Math.max(ms / 1000, 0.001))} points/s). Log lines at error level: ${show(collector.app.errors)}, at warn: ${show(collector.app.warnings)}.`,
    );
    lines.push("");
  }

  lines.push("## Postgres");
  lines.push("");
  lines.push(
    `Over the day and the backlog (${show(derived.seconds)} s): ${show(derived.pointsIn)} points stored, WAL ${show(derived.walBytes / 1_048_576, 1)} MB (${show(derived.walPerPoint)} bytes a point), the database grew ${show(derived.sizeBytes / 1_048_576, 1)} MB; checkpoints ${show(derived.checkpointsTimed)} timed, ${show(derived.checkpointsRequested)} requested; cache hits ${show(percent(derived.cacheHit), 2)} %. Production (M0): WAL ${m0.walPerDayGb} GB a day for its one phone, ${m0.settings}.`,
  );
  lines.push("");
  lines.push(
    table(
      ["Table", "Inserted", "Updated", "HOT share", "Deleted"],
      Object.entries(derived.tableDeltas)
        .filter(([, d]) => d.ins + d.upd + d.del > 0)
        .map(([name, d]) => [
          `\`${name}\``,
          show(d.ins),
          show(d.upd),
          d.upd > 0 ? `${show((d.hot / d.upd) * 100, 1)} %` : "—",
          show(d.del),
        ]),
    ),
  );
  lines.push("");
  const sizes = collector?.sizes ?? {};
  const sizeRows = [
    "locations",
    "processed_points",
    "heat_cells",
    "ingest_log",
    "segments",
    "daily_stats",
  ]
    .filter((name) => sizes[name] !== undefined)
    .map((name) => {
      const size = sizes[name];
      const perRow = size.rows > 0 ? size.totalBytes / size.rows : null;
      const baseline = /** @type {Record<string, number>} */ (m0.rowBytes)[name];
      return [
        `\`${name}\``,
        show(size.rows),
        `${show(size.totalBytes / 1_048_576, 1)} MB`,
        show(perRow),
        baseline === undefined ? "—" : show(baseline),
      ];
    });
  lines.push(
    table(["Table", "Rows", "Size with indexes", "Bytes a row", "Production (M0)"], sizeRows),
  );
  lines.push("");
  const statements = collector?.statements ?? [];
  if (statements.length > 0) {
    lines.push(
      "Top statements of the run by total time (pg_stat_statements, reset when the collector started):",
    );
    lines.push("");
    lines.push(
      table(
        ["Calls", "Total ms", "Mean ms", "Max ms", "Rows", "Statement"],
        statements
          .slice(0, 12)
          .map((/** @type {any} */ s) => [
            show(s.calls),
            show(Number(s.totalMs)),
            show(Number(s.meanMs), 2),
            show(Number(s.maxMs), 1),
            show(s.rows),
            `\`${String(s.query).replaceAll("|", "\\|").replaceAll("`", "'")}\``,
          ]),
      ),
    );
    lines.push("");
  }

  if (run.history !== null) {
    const h = run.history;
    lines.push("## History and backfill");
    lines.push("");
    lines.push(
      `${show(h.rows)} points of ${h.days} days for ${show(h.phones)} phones written with COPY in ${show(h.copySeconds, 1)} s (${show(h.rowsPerSecond)} rows/s); \`trail recompute\` (heat cells, daily statistics) ${show(h.recomputeSeconds, 1)} s; \`trail reprocess\` over the days ${show(h.reprocessSeconds, 1)} s — ${show(h.windows)} windows, ${show(h.points)} points, ${show(h.segments)} stops and moves: ${show(h.pointsPerSecond)} points/s, ${show(h.deviceDaysPerHour)} device-days an hour (from the averaged level, without map data).`,
    );
    lines.push("");
  }

  lines.push("## What this run cannot tell");
  lines.push("");
  for (const limit of context.limits ?? []) lines.push(`- ${limit}`);
  lines.push("");
  lines.push(`Samples every 10 s: [${context.csvName}](${context.csvName}).`);
  lines.push("");
  return { markdown: lines.join("\n"), rows, failedGates };
}

/** What the harness cannot measure yet, in every report until it can. */
export const limits = [
  "The node: these are the Mac's numbers. The calibration factor (§6.5) needs the same run on a preview of the node; until then the thresholds are the node's targets as they are.",
  "Map matching: the stack has no map data (PROCESSING_OVERPASS_URL empty — a load test never asks the public Overpass), so the mapped level degrades to averaged and the worker does less than in production.",
  "Routes: every phone rides the recorded fixture route (tests/fixtures/overland-batch.json) until generate-routes reads the map-data stream's extract.",
  "The worker as a container of its own, NOTIFY across processes and the rollup tables do not exist yet: processing runs in the app process and is measured there.",
  "A compressed day: stops and moves shrink with the day, so the 5-minute senders' batches are smaller and processing windows shorter than in a real day; the 24-hour soak keeps both.",
  "The edge (TLS, Launchway's proxy), the deploy's restart burst, export throughput, the archive and backups are not part of a Mac run.",
  "Lock waits are seen only when a 10-second sample catches them.",
];

/**
 * Writes the report (and its CSV) of a run folder into `outDir`; returns the file name and the failed gates.
 * @param {string} runDir
 * @param {{ outDir?: string }} [options]
 */
export function writeReport(runDir, options = {}) {
  const outDir = options.outDir ?? perfFolder;
  const run = readJson(runDir, "run.json");
  if (run === null) throw new Error(`${runDir}: no run.json`);
  const name = `${run.startedAt.slice(0, 10)}-${run.commit}-${run.scenario}`;
  const csvName = `${name}.csv`;
  const csvPath = join(runDir, "collector.csv");
  const csvText = existsSync(csvPath) ? readFileSync(csvPath, "utf8") : "";
  const [headerLine, ...dataLines] = csvText.trim().split("\n");
  const header = (headerLine ?? "").split(",");
  const csvRows = dataLines
    .filter((line) => line.length > 0)
    .map((line) =>
      Object.fromEntries(
        line.split(",").map((value, index) => [header[index] ?? String(index), value]),
      ),
    );
  const context = {
    run,
    day: readJson(runDir, "day.summary.json"),
    backlog: readJson(runDir, "backlog.summary.json"),
    probe: readJson(runDir, "probe.result.json"),
    collector: readJson(runDir, "collector.json"),
    checks: readJson(runDir, "checks.json"),
    csvRows,
    csvName,
    limits,
  };
  const { markdown, failedGates } = renderReport(context);
  const fleet = readJson(runDir, "fleet.json");
  const leaks = [...leaksIn(markdown, fleet === null ? [] : secretsOf(fleet)), ...leaksIn(csvText)];
  if (leaks.length > 0)
    throw new Error(`refusing to write the report: it would hold ${leaks.join(", ")}`);
  writeFileSync(join(outDir, `${name}.md`), markdown);
  if (csvText !== "") copyFileSync(csvPath, join(outDir, csvName));
  indexRun(outDir, name, run, failedGates.length === 0);
  return { name, failedGates };
}

/**
 * Adds the run to the index of docs/perf/README.md (between its markers).
 * @param {string} outDir
 * @param {string} name
 * @param {any} run
 * @param {boolean} passed
 */
function indexRun(outDir, name, run, passed) {
  const readme = join(outDir, "README.md");
  if (!existsSync(readme)) return;
  const text = readFileSync(readme, "utf8");
  const start = "<!-- runs:start -->";
  const end = "<!-- runs:end -->";
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < from) return;
  const existing = text
    .slice(from + start.length, to)
    .split("\n")
    .filter((line) => line.startsWith("| [") && !line.includes(`(${name}.md)`));
  const entry = `| [${basename(name)}](${name}.md) | ${run.startedAt.slice(0, 10)} | \`${run.commit}\` | ${run.scenario} | ${passed ? "pass" : "fail"} |`;
  const body = [
    "",
    "| Run | Date | Commit | Scenario | Gates |",
    "| --- | --- | --- | --- | --- |",
    ...[...existing, entry].sort().reverse(),
    "",
  ].join("\n");
  writeFileSync(readme, `${text.slice(0, from + start.length)}${body}${text.slice(to)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: "string" } },
  });
  const runDir = positionals[0];
  if (runDir === undefined) {
    console.error("usage: node tools/load/report.mjs <run folder> [--out docs/perf]");
    process.exit(2);
  }
  const { name, failedGates } = writeReport(
    runDir,
    values.out === undefined ? {} : { outDir: values.out },
  );
  console.log(
    `report: docs/perf/${name}.md (${failedGates.length === 0 ? "every gated target held" : `${failedGates.length} gated targets missed`})`,
  );
  process.exitCode = failedGates.length === 0 ? 0 : 1;
}
