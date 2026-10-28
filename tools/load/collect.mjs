/*
 * The collector (docs/design/capacity.md §6.3): every 10 s, Docker's CPU and
 * memory per container and Postgres' counters (pg_stat_database, pg_stat_wal,
 * pg_stat_checkpointer, the hot tables of pg_stat_user_tables, the waits in
 * pg_stat_activity) into collector.csv of the run's folder; at the end the
 * top statements of pg_stat_statements, the tables' sizes and the app's
 * `load` lines and processing windows from its log, into collector.json.
 * Numbers only: no row of a table, no log line's text is kept.
 *
 *   node tools/load/collect.mjs --env-file <run>/compose.env --out <run>   until Ctrl-C
 */
import { createWriteStream, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { LoadStack, run } from "./lib/compose.mjs";

/** The tables whose rows the ingest and processing write. */
export const hotTables = [
  "locations",
  "processed_points",
  "heat_cells",
  "devices",
  "ingest_log",
  "daily_stats",
  "segments",
  "processing_queue",
  "visits",
  "device_events",
  "sessions",
  "data_access_events",
];

const counters = `
SELECT json_build_object(
  't', extract(epoch FROM clock_timestamp()),
  'db', (SELECT row_to_json(d) FROM (
    SELECT xact_commit, xact_rollback, blks_read, blks_hit, tup_inserted, tup_updated, tup_deleted,
      temp_bytes, deadlocks
    FROM pg_stat_database WHERE datname = current_database()) d),
  'wal', (SELECT row_to_json(w) FROM (SELECT wal_records, wal_fpi, wal_bytes FROM pg_stat_wal) w),
  'checkpoints', (SELECT row_to_json(c) FROM (
    SELECT num_timed, num_requested, buffers_written FROM pg_stat_checkpointer) c),
  'tables', (SELECT json_object_agg(relname, json_build_object(
      'ins', n_tup_ins, 'upd', n_tup_upd, 'hot', n_tup_hot_upd, 'del', n_tup_del,
      'live', n_live_tup, 'dead', n_dead_tup, 'vacuums', autovacuum_count))
    FROM pg_stat_user_tables WHERE relname IN (${hotTables.map((name) => `'${name}'`).join(", ")})),
  'activity', (SELECT json_build_object(
      'total', count(*),
      'active', count(*) FILTER (WHERE state = 'active'),
      'idleInTransaction', count(*) FILTER (WHERE state LIKE 'idle in transaction%'),
      'lockWaits', count(*) FILTER (WHERE wait_event_type = 'Lock'),
      'longestLockWaitS', coalesce(max(extract(epoch FROM clock_timestamp() - state_change))
        FILTER (WHERE wait_event_type = 'Lock'), 0))
    FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()),
  'sizeBytes', pg_database_size(current_database())
)`;

const statements = `
SELECT coalesce(json_agg(s), '[]'::json) FROM (
  SELECT calls, round(total_exec_time::numeric, 1) AS "totalMs", round(mean_exec_time::numeric, 2) AS "meanMs",
    round(max_exec_time::numeric, 1) AS "maxMs", rows,
    left(regexp_replace(query, '\\s+', ' ', 'g'), 140) AS query
  FROM pg_stat_statements
  WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  ORDER BY total_exec_time DESC LIMIT 20) s`;

const sizes = `
SELECT coalesce(json_object_agg(relname, json_build_object(
    'totalBytes', pg_total_relation_size(relid), 'heapBytes', pg_relation_size(relid),
    'indexBytes', pg_indexes_size(relid), 'rows', n_live_tup)), '{}'::json)
FROM pg_stat_user_tables`;

/**
 * "12.34%" → 0.1234; "123.4MiB / 1GiB" → MiB of the first.
 * @param {{ CPUPerc?: string, MemUsage?: string }} stats
 */
export function parseDockerStats(stats) {
  const cpu = Number.parseFloat(String(stats.CPUPerc ?? "0").replace("%", "")) / 100;
  const used =
    String(stats.MemUsage ?? "0B")
      .split("/")[0]
      ?.trim() ?? "0B";
  const match = /^([\d.]+)\s*([KMGT]?i?B)$/.exec(used);
  const factor = {
    B: 1 / 1_048_576,
    KiB: 1 / 1024,
    MiB: 1,
    GiB: 1024,
    TiB: 1_048_576,
    kB: 1 / 1024,
    KB: 1 / 1024,
    MB: 1,
    GB: 1024,
  };
  const unit = /** @type {keyof typeof factor} */ (match?.[2] ?? "B");
  const memMb = match === null ? 0 : Number(match[1]) * (factor[unit] ?? 0);
  return { cpu: Number.isFinite(cpu) ? cpu : 0, memMb };
}

/**
 * @typedef {{ t: number, db: Record<string, number>, wal: Record<string, number>, checkpoints: Record<string, number>,
 *   tables: Record<string, Record<string, number>>, activity: Record<string, number>, sizeBytes: number }} PgSample
 */

/** @param {number} value */
const r = (value) => Math.round(value * 100) / 100;

/**
 * One CSV row of the interval between two samples.
 * @param {PgSample} previous
 * @param {PgSample} current
 * @param {Record<string, { cpu: number, memMb: number }>} docker
 * @param {number} startedS
 * @param {{ load1: number, othersCpu: number }} [machine] the host's load average and what
 *   every other container used (cores): a busy Mac measures itself, not Trail
 */
export function rowOf(previous, current, docker, startedS, machine = { load1: 0, othersCpu: 0 }) {
  const seconds = Math.max(0.001, current.t - previous.t);
  /** @param {(sample: PgSample) => number | undefined} read */
  const rate = (read) => r(((read(current) ?? 0) - (read(previous) ?? 0)) / seconds);
  /** @param {string} table @param {string} field */
  const table = (table, field) => (/** @type {PgSample} */ sample) =>
    sample.tables?.[table]?.[field];
  const hits = (current.db["blks_hit"] ?? 0) - (previous.db["blks_hit"] ?? 0);
  const reads = (current.db["blks_read"] ?? 0) - (previous.db["blks_read"] ?? 0);
  /** @param {string} name */
  const hotShare = (name) => {
    const updates =
      (current.tables?.[name]?.["upd"] ?? 0) - (previous.tables?.[name]?.["upd"] ?? 0);
    const hot = (current.tables?.[name]?.["hot"] ?? 0) - (previous.tables?.[name]?.["hot"] ?? 0);
    return updates > 0 ? r(hot / updates) : "";
  };
  return {
    elapsed_s: Math.round(current.t - startedS),
    app_cpu: r(docker["app"]?.cpu ?? 0),
    app_mem_mb: Math.round(docker["app"]?.memMb ?? 0),
    db_cpu: r(docker["db"]?.cpu ?? 0),
    db_mem_mb: Math.round(docker["db"]?.memMb ?? 0),
    k6_cpu: r(docker["k6"]?.cpu ?? 0),
    k6_mem_mb: Math.round(docker["k6"]?.memMb ?? 0),
    commits_s: rate((sample) => sample.db["xact_commit"]),
    cache_hit: hits + reads > 0 ? r(hits / (hits + reads)) : "",
    wal_kb_s: r(rate((sample) => sample.wal["wal_bytes"]) / 1024),
    wal_fpi_s: rate((sample) => sample.wal["wal_fpi"]),
    checkpoints_timed: current.checkpoints["num_timed"] ?? 0,
    checkpoints_requested: current.checkpoints["num_requested"] ?? 0,
    locations_ins_s: rate(table("locations", "ins")),
    processed_writes_s: r(
      rate(table("processed_points", "ins")) + rate(table("processed_points", "upd")),
    ),
    heat_upd_s: rate(table("heat_cells", "upd")),
    heat_hot: hotShare("heat_cells"),
    devices_upd_s: rate(table("devices", "upd")),
    devices_hot: hotShare("devices"),
    devices_dead: current.tables?.["devices"]?.["dead"] ?? 0,
    heat_dead: current.tables?.["heat_cells"]?.["dead"] ?? 0,
    active: current.activity["active"] ?? 0,
    lock_waits: current.activity["lockWaits"] ?? 0,
    longest_lock_wait_s: r(current.activity["longestLockWaitS"] ?? 0),
    db_size_mb: Math.round(current.sizeBytes / 1_048_576),
    host_load1: r(machine.load1),
    others_cpu: r(machine.othersCpu),
  };
}

/**
 * The app's log, as numbers: its `load` lines, the processing windows and how
 * long it took to listen; nothing of a line's text is kept.
 * @param {string} log
 * @param {number} sinceMs
 */
export function readAppLog(log, sinceMs) {
  /** @type {Record<string, number | null>[]} */
  const loadLines = [];
  /** @type {{ t: number, points: number, segments: number, ms: number, reason: string }[]} */
  const windows = [];
  let listeningAt = null;
  let errors = 0;
  let warnings = 0;
  for (const line of log.split("\n")) {
    if (!line.startsWith("{")) continue;
    /** @type {Record<string, unknown>} */
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    // pino writes ISO times (createLogger's isoTime)
    const time =
      typeof entry["time"] === "number" ? entry["time"] : Date.parse(String(entry["time"] ?? ""));
    // The start is before the collector's; everything else counts from it.
    if (entry["msg"] === "Trail API listening" && listeningAt === null) listeningAt = time;
    if (Number.isFinite(time) && time < sinceMs) continue;
    const level = Number(entry["level"]);
    if (level >= 50) errors += 1;
    else if (level === 40) warnings += 1;
    if (entry["msg"] === "load") {
      /** @type {Record<string, number | null>} */
      const numbers = { t: time };
      for (const [key, value] of Object.entries(entry)) {
        if (typeof value === "number" && !["level", "time", "pid"].includes(key))
          numbers[key] = value;
        if (value === null) numbers[key] = null;
      }
      loadLines.push(numbers);
    } else if (entry["msg"] === "processing window done") {
      windows.push({
        t: time,
        points: Number(entry["points"] ?? 0),
        segments: Number(entry["segments"] ?? 0),
        ms: Number(entry["ms"] ?? 0),
        reason: String(entry["reason"] ?? ""),
      });
    }
  }
  return { loadLines, windows, listeningAt, errors, warnings };
}

/**
 * Samples until stopped; `stop` takes the last sample, the statements, the sizes
 * and the log, and writes collector.json.
 * @param {{ stack: LoadStack, out: string, intervalS?: number, sinceMs?: number }} options
 */
export function startCollector({ stack, out, intervalS = 10, sinceMs = Date.now() }) {
  const csv = createWriteStream(join(out, "collector.csv"));
  let header = false;
  let stopped = false;
  /** @type {PgSample | null} */
  let first = null;
  /** @type {PgSample | null} */
  let previous = null;
  /** @type {Record<string, number>[]} */
  const rows = [];

  const sample = async () => {
    const [current, containers] = await Promise.all([
      /** @type {Promise<PgSample>} */ (stack.json(counters)),
      stack.containers(),
    ]);
    /** @type {Record<string, { cpu: number, memMb: number }>} */
    const docker = {};
    let othersCpu = 0;
    // Every running container: this stack's by service, the rest summed.
    const stats = await run("docker", ["stats", "--no-stream", "--format", "{{json .}}"], {
      allowFailure: true,
    });
    for (const line of stats.stdout.split("\n")) {
      if (!line.startsWith("{")) continue;
      const parsed = JSON.parse(line);
      const container = containers.find(
        (c) => parsed.ID?.startsWith(c.id) || c.id.startsWith(parsed.ID ?? "-"),
      );
      if (container !== undefined) docker[container.service] = parseDockerStats(parsed);
      else othersCpu += parseDockerStats(parsed).cpu;
    }
    if (first === null) first = current;
    if (previous !== null) {
      const row = rowOf(previous, current, docker, first.t, {
        load1: loadavg()[0] ?? 0,
        othersCpu,
      });
      if (!header) {
        csv.write(`${Object.keys(row).join(",")}\n`);
        header = true;
      }
      csv.write(`${Object.values(row).join(",")}\n`);
      rows.push(/** @type {Record<string, number>} */ (row));
    }
    previous = current;
  };

  const loop = (async () => {
    while (!stopped) {
      const started = Date.now();
      try {
        await sample();
      } catch (error) {
        process.stderr.write(
          `collect: a sample failed (${error instanceof Error ? error.message.split("\n")[0] : "?"})\n`,
        );
      }
      const wait = intervalS * 1000 - (Date.now() - started);
      if (wait > 0 && !stopped) await sleep(wait);
    }
  })();

  return {
    rows,
    async stop() {
      stopped = true;
      await loop;
      await sample().catch(() => undefined);
      csv.end();
      const [top, tableSizes, logs] = await Promise.all([
        stack.json(statements).catch(() => []),
        stack.json(sizes).catch(() => ({})),
        stack.compose(["logs", "--no-color", "--no-log-prefix", "app"], { allowFailure: true }),
      ]);
      const result = {
        first,
        last: previous,
        statements: top,
        sizes: tableSizes,
        app: readAppLog(logs.stdout, sinceMs),
      };
      writeFileSync(join(out, "collector.json"), JSON.stringify(result, null, 2));
      return result;
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      "env-file": { type: "string" },
      out: { type: "string" },
      interval: { type: "string" },
    },
  });
  if (values["env-file"] === undefined || values.out === undefined) {
    console.error(
      "usage: node tools/load/collect.mjs --env-file <run>/compose.env --out <dir> [--interval 10]",
    );
    process.exit(2);
  }
  const collector = startCollector({
    stack: new LoadStack({ envFile: values["env-file"], env: process.env }),
    out: values.out,
    intervalS: Number(values.interval ?? 10),
  });
  const finish = () => {
    collector.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", finish);
  process.once("SIGTERM", finish);
}
