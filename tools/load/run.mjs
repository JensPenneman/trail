/*
 * A load test on the Mac (docs/perf/README.md): `npm run load -- fleet-10`.
 *
 * Builds the image of the working tree, starts the capped stack (project
 * trail-load: the production Compose file with tools/load/compose.load.yaml),
 * measures the database volume's fsync, creates the fleet with `trail
 * load-fleet`, writes its history (backfill.mjs), then plays the day — the
 * phones and the people in k6 (day.js) with the SSE probe and the collector
 * beside them — and the backlog (backlog.js), checks that nothing acknowledged
 * was lost, writes the report into docs/perf/ and removes the stack and its
 * volume. It never reaches anything but that stack: there is no option for
 * another address.
 *
 * At most two Trail stacks run on this Mac at a time: it waits while two
 * others run (`trail-*-dev-1` containers), and its own counts as one.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generateHistory } from "./backfill.mjs";
import { parseDockerStats, startCollector } from "./collect.mjs";
import { LoadStack, otherTrailStacks, projectName, repositoryRoot, run } from "./lib/compose.mjs";
import { secretsOf } from "./lib/redact.js";
import { boundsOf, routesFrom } from "./lib/routes.js";
import { writeReport } from "./report.mjs";

/**
 * The runs (docs/perf/README.md, "Scenarios"). `daySeconds`: the day played in
 * that many seconds (86 400 = real time); `opensPerMinute`: the people's
 * opens, the evening peak's rate at this size but at least one a minute.
 */
export const presets = {
  // Five minutes to see that the harness works end to end; its report is not for docs/perf.
  smoke: {
    people: 10,
    daySeconds: 180,
    dayStartHour: 7,
    historyDays: 1,
    backlogHours: 1,
    opensPerMinute: 2,
    sseStreams: 1,
    probeIntervalS: 2,
  },
  "fleet-10": {
    people: 10,
    daySeconds: 1800,
    dayStartHour: 0,
    historyDays: 2,
    backlogHours: 8,
    opensPerMinute: 1,
    sseStreams: 1,
    probeIntervalS: 5,
  },
  "fleet-100": {
    people: 100,
    daySeconds: 3600,
    dayStartHour: 0,
    historyDays: 2,
    backlogHours: 8,
    opensPerMinute: 1,
    sseStreams: 15,
    probeIntervalS: 1,
  },
  "fleet-1000": {
    people: 1000,
    daySeconds: 3600,
    dayStartHour: 0,
    historyDays: 0,
    backlogHours: 8,
    opensPerMinute: 3,
    sseStreams: 150,
    probeIntervalS: 1,
  },
  "soak-100": {
    people: 100,
    daySeconds: 86_400,
    dayStartHour: 0,
    historyDays: 7,
    backlogHours: 8,
    opensPerMinute: 1,
    sseStreams: 15,
    probeIntervalS: 1,
  },
};

const defaultRoutes = fileURLToPath(
  new URL("../../apps/api/tests/fixtures/overland-batch.json", import.meta.url),
);

/** @param {string} message */
const say = (message) => console.log(`load ${new Date().toISOString().slice(11, 19)} ${message}`);

/**
 * Text of a command, or "" when it fails.
 * @param {string} command
 * @param {string[]} args
 */
async function textOf(command, args) {
  const result = await run(command, args, { allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : "";
}

async function machineInfo() {
  const info = JSON.parse((await textOf("docker", ["info", "--format", "{{json .}}"])) || "{}");
  return {
    model: (await textOf("sysctl", ["-n", "machdep.cpu.brand_string"])) || process.arch,
    memoryGb: Math.round(Number(await textOf("sysctl", ["-n", "hw.memsize"])) / 2 ** 30) || null,
    os: (await textOf("sw_vers", ["-productVersion"])) || process.platform,
    docker: {
      version: info.ServerVersion ?? "?",
      cpus: info.NCPU ?? null,
      memoryGb: typeof info.MemTotal === "number" ? info.MemTotal / 2 ** 30 : null,
    },
  };
}

/** What a run would share the Mac with: the host's load average and every other container's CPU (cores). */
async function machineLoad() {
  const stats = await run("docker", ["stats", "--no-stream", "--format", "{{json .}}"], {
    allowFailure: true,
  });
  let othersCpu = 0;
  for (const line of stats.stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    const parsed = JSON.parse(line);
    if (!String(parsed.Name ?? "").startsWith(`${projectName}-`))
      othersCpu += parseDockerStats(parsed).cpu;
  }
  return { load1: loadavg()[0] ?? 0, othersCpu, cpus: availableParallelism() };
}

/**
 * Waits until the Mac is quiet — the other containers below half a CPU and the
 * load average below half the cores, three times in a row a minute apart — so
 * that a run measures Trail rather than the Mac's other work.
 */
async function waitForQuiet() {
  let quiet = 0;
  let waited = 0;
  while (quiet < 3) {
    const load = await machineLoad();
    if (load.othersCpu < 0.5 && load.load1 < load.cpus / 2) quiet += 1;
    else {
      quiet = 0;
      if (waited % 5 === 0) {
        say(
          `waiting for a quiet Mac: load average ${load.load1.toFixed(1)}, other containers ${load.othersCpu.toFixed(1)} CPUs`,
        );
      }
      waited += 1;
    }
    if (quiet < 3) await sleep(60_000);
  }
}

/**
 * pg_test_fsync's ops/s for one 8 kB write, on the database volume.
 * @param {LoadStack} stack
 */
async function measureFsync(stack) {
  const result = await stack.exec(
    "db",
    ["pg_test_fsync", "-s", "2", "-f", "/var/lib/postgresql/trailload-fsync.tmp"],
    { allowFailure: true },
  );
  if (result.code !== 0) return null;
  const block = result.stdout.split("Compare file sync methods using two 8kB writes")[0] ?? "";
  /** @param {string} method */
  const opsOf = (method) => {
    const match = new RegExp(`^\\s+${method}\\s+([\\d.]+) ops/sec`, "m").exec(block);
    return match === null ? null : Number(match[1]);
  };
  return {
    open_datasync: opsOf("open_datasync"),
    fdatasync: opsOf("fdatasync"),
    fsync: opsOf("fsync"),
  };
}

/**
 * The run's own record from the database: what was stored and the ingest log's latencies and rates.
 * @param {LoadStack} stack
 * @param {{ probeDevice: string, day: { from: number, to: number, daySeconds: number }, backlog: { from: number, to: number } }} window
 * @param {number} historyRows
 */
async function databaseChecks(stack, window, historyRows) {
  const iso = (/** @type {number} */ ms) => `'${new Date(ms).toISOString()}'::timestamptz`;
  const probe = `'${window.probeDevice}'::uuid`;
  /** @param {number} from @param {number} to */
  const classes = (from, to) => `
    SELECT coalesce(json_agg(c ORDER BY c.lo), '[]'::json) FROM (
      SELECT CASE WHEN records < 10 THEN '<10' WHEN records < 100 THEN '10–99'
        WHEN records < 500 THEN '100–499' ELSE '500+' END AS batch,
        min(records) AS lo, count(*) AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99,
        max(duration_ms) AS max
      FROM ingest_log
      WHERE received_at >= ${iso(from)} AND received_at < ${iso(to)} AND device_id <> ${probe}
      GROUP BY 1) c`;
  const hour = window.day.daySeconds / 24;
  const stored = await stack.json(
    `SELECT json_build_object('total', (SELECT count(*) FROM locations))`,
  );
  const day = await stack.json(`
    SELECT json_build_object(
      'classes', (${classes(window.day.from, window.day.to)}),
      'byProfile', (SELECT coalesce(json_agg(p), '[]'::json) FROM (
        SELECT d.name AS profile, count(*) AS uploads, sum(l.locations) AS points, sum(l.records) AS records
        FROM ingest_log l JOIN devices d ON d.id = l.device_id
        WHERE l.received_at >= ${iso(window.day.from)} AND l.received_at < ${iso(window.day.to)} AND l.device_id <> ${probe}
        GROUP BY d.name) p),
      'hours', (SELECT coalesce(json_agg(h ORDER BY h.bucket), '[]'::json) FROM (
        SELECT floor(extract(epoch FROM received_at - ${iso(window.day.from)}) / ${hour})::int AS bucket,
          count(*) AS uploads, sum(locations) AS points
        FROM ingest_log
        WHERE received_at >= ${iso(window.day.from)} AND received_at < ${iso(window.day.to)} AND device_id <> ${probe}
        GROUP BY 1) h),
      'worst10s', (SELECT coalesce(max(n), 0) FROM (
        SELECT count(*) AS n FROM ingest_log
        WHERE received_at >= ${iso(window.day.from)} AND received_at < ${iso(window.day.to)} AND device_id <> ${probe}
        GROUP BY floor(extract(epoch FROM received_at) / 10)) w)
    )`);
  const backlog = await stack.json(
    `SELECT json_build_object('classes', (${classes(window.backlog.from, window.backlog.to)}))`,
  );
  const seconds = Math.max(1, (window.day.to - window.day.from) / 1000);
  /** @type {Record<string, number>[]} */
  const hours = day.hours ?? [];
  /** @param {string} key */
  const sum = (key) => hours.reduce((total, h) => total + Number(h[key] ?? 0), 0);
  /** @param {string} key */
  const peak = (key) => Math.max(0, ...hours.map((h) => Number(h[key] ?? 0)));
  return {
    stored: { total: Number(stored.total), history: historyRows },
    ingestLog: {
      day: {
        classes: day.classes,
        byProfile: (day.byProfile ?? []).map((/** @type {any} */ p) => ({
          profile: p.profile,
          uploads: Number(p.uploads),
          points: Number(p.points),
          records: Number(p.records),
        })),
        rates: {
          pointsPerSecond: sum("points") / seconds,
          uploadsPerSecond: sum("uploads") / seconds,
          peakHourPointsPerSecond: peak("points") / hour,
          peakHourUploadsPerSecond: peak("uploads") / hour,
          worst10sUploads: Number(day.worst10s ?? 0),
        },
      },
      backlog: { classes: backlog.classes },
    },
  };
}

/**
 * A k6 phase in its container: its output redacted on the way; resolves to k6's exit code
 * (0 every threshold held, 99 some failed).
 * @param {LoadStack} stack
 * @param {string} script
 * @param {readonly string[]} known
 */
async function k6(stack, script, known) {
  const result = await stack.compose(
    [
      "--profile",
      "k6",
      "run",
      "--rm",
      "--no-deps",
      "k6",
      "run",
      "--quiet",
      "--no-color",
      `/load/${script}`,
    ],
    { show: true, known, allowFailure: true },
  );
  return result.code;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      keep: { type: "boolean" },
      image: { type: "string" },
      tmp: { type: "string" },
      seed: { type: "string" },
      port: { type: "string" },
      routes: { type: "string" },
      quiet: { type: "boolean" },
      "no-report": { type: "boolean" },
    },
  });
  const scenario = positionals[0] ?? "";
  const preset = /** @type {Record<string, (typeof presets)["fleet-10"]>} */ (presets)[scenario];
  if (preset === undefined) {
    console.error(
      `usage: npm run load -- <${Object.keys(presets).join("|")}> [--quiet] [--keep] [--image <tag>] [--tmp <dir>] [--seed <n>] [--port <n>] [--routes <file>]`,
    );
    process.exit(2);
  }
  const seed = Number(values.seed ?? 1);
  const port = Number(values.port ?? 18787);
  const startedAt = new Date().toISOString();

  // Which commit, and whether the tree has changes of its own.
  const commitFull = await textOf("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]);
  const commit = commitFull.slice(0, 7);
  const branch = await textOf("git", ["-C", repositoryRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty =
    (await textOf("git", [
      "-C",
      repositoryRoot,
      "status",
      "--porcelain",
      "--untracked-files=no",
    ])) !== "";

  // At most two Trail stacks on this Mac: wait while two others run.
  for (;;) {
    const others = await otherTrailStacks();
    if (others.length < 2) break;
    say(`waiting: ${others.length} other Trail stacks are running (${others.join(", ")})`);
    await sleep(60_000);
  }
  const runDir = mkdtempSync(join(values.tmp ?? tmpdir(), `trailload-${scenario}-`));
  const image = values.image ?? `trail-load:${commit}`;
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, DOCKER_CLI_HINTS: "false" };
  for (const key of [
    "NODE_ENV",
    "DATABASE_URL",
    "AUTH_SECRET",
    "COMPOSE_PROFILES",
    "COMPOSE_FILE",
    "COMPOSE_PROJECT_NAME",
  ])
    delete env[key];
  const envFile = join(runDir, "compose.env");
  writeFileSync(
    envFile,
    [
      `POSTGRES_PASSWORD=${randomBytes(32).toString("hex")}`,
      `TRAIL_IMAGE=${image}`,
      `TRAIL_LOAD_PORT=${port}`,
      `PUBLIC_URL=http://localhost:${port}`,
      `TRAILLOAD_RUN_DIR=${runDir}`,
      "COMPOSE_PROFILES=",
      "TRAIL_DB_VOLUME=",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const stack = new LoadStack({ envFile, env });
  if ((await stack.containers()).length > 0) {
    throw new Error(
      `a ${projectName} stack is running already: docker compose -p ${projectName} down -v`,
    );
  }
  /** @type {string[]} */
  let known = [];
  /** @type {import("node:child_process").ChildProcess | null} */
  let probe = null;
  try {
    if (values.image === undefined) {
      say(`building ${image}`);
      const version = JSON.parse(
        readFileSync(join(repositoryRoot, "package.json"), "utf8"),
      ).version;
      await run(
        "docker",
        [
          "build",
          "--tag",
          image,
          "--build-arg",
          `APP_VERSION=${version}`,
          "--build-arg",
          `GIT_SHA=${commitFull}`,
          "--build-arg",
          `BUILD_TIME=${new Date().toISOString()}`,
          ".",
        ],
        { env },
      );
    }
    if (values.quiet === true) await waitForQuiet();
    const machineAtStart = await machineLoad();
    say(`starting ${projectName} (${runDir})`);
    const upStarted = Date.now();
    await stack.compose(["up", "--detach", "--wait", "--wait-timeout", "240", "app", "db"]);
    const caps = JSON.parse(
      (await stack.compose(["--profile", "k6", "config", "--format", "json"])).stdout,
    ).services;
    /** @param {any} service */
    const capOf = (service) =>
      `${service?.cpus ?? "?"} CPU / ${Math.round(Number(service?.mem_limit ?? 0) / 1_048_576)} MiB`;

    say("measuring fsync on the database volume");
    const fsync = await measureFsync(stack);

    say(`creating the fleet: ${preset.people} people and the probe`);
    const fleetPath = join(runDir, "fleet.json");
    const fleetFile = createWriteStream(fleetPath, { mode: 0o600 });
    await stack.exec("app", ["trail", "load-fleet", "--people", String(preset.people), "--probe"], {
      stdoutTo: fleetFile,
    });
    await new Promise((resolve) => fleetFile.end(resolve));
    const fleet = JSON.parse(readFileSync(fleetPath, "utf8"));
    known = secretsOf(fleet);
    const probePerson = fleet.people.find((/** @type {any} */ person) => person.probe);
    const fleetPeople = fleet.people.filter((/** @type {any} */ person) => !person.probe);
    /** @type {Record<string, number>} */
    const profileCounts = {};
    /** @type {Record<string, number>} */
    const appCounts = {};
    for (const person of fleetPeople) {
      for (const device of person.devices) {
        profileCounts[device.profile] = (profileCounts[device.profile] ?? 0) + 1;
        appCounts[device.app] = (appCounts[device.app] ?? 0) + 1;
      }
    }

    const routes = routesFrom(
      "routes",
      JSON.parse(readFileSync(values.routes ?? defaultRoutes, "utf8")),
    );
    writeFileSync(
      join(runDir, "routes.json"),
      JSON.stringify({
        routes: routes.map((route) => ({ name: route.name, coordinates: route.coordinates })),
      }),
    );

    // History first, ending a day before the backlog's window, so no point is ever sent twice.
    let history = null;
    if (preset.historyDays > 0) {
      say(
        `writing ${preset.historyDays} days of history (COPY), then trail recompute and reprocess`,
      );
      history = await generateHistory({
        stack,
        fleet,
        routes,
        seed,
        days: preset.historyDays,
        endMs: Date.now() - (preset.backlogHours + 1) * 3_600_000,
      });
      say(
        `history: ${history.rows} points; reprocess ${history.reprocessSeconds.toFixed(0)} s (${Math.round(history.pointsPerSecond)} points/s)`,
      );
    }

    await stack.psql("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
    await stack.psql("SELECT pg_stat_statements_reset()");
    const collectorStarted = Date.now();
    const collector = startCollector({ stack, out: runDir, sinceMs: collectorStarted });

    const first = routes[0]?.coordinates[0] ?? [3.72, 51.05];
    const probeConfig = {
      baseUrl: `http://127.0.0.1:${port}`,
      cookieName: "trail_session",
      sessions: fleetPeople
        .slice(0, preset.sseStreams)
        .map((/** @type {any} */ person) => person.session),
      probe: {
        session: probePerson.session,
        token: probePerson.devices[0].token,
        deviceKey: probePerson.devices[0].deviceKey,
        deviceId: probePerson.devices[0].id,
        lon: first[0],
        lat: first[1],
      },
      intervalS: preset.probeIntervalS,
      out: join(runDir, "probe.result.json"),
    };
    writeFileSync(join(runDir, "probe.json"), JSON.stringify(probeConfig), { mode: 0o600 });
    probe = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./sse-probe.mjs", import.meta.url)),
        "--config",
        join(runDir, "probe.json"),
      ],
      {
        stdio: ["ignore", "inherit", "inherit"],
      },
    );

    const config = {
      baseUrl: "http://app:8080",
      daySeconds: preset.daySeconds,
      dayStartHour: preset.dayStartHour,
      seed,
      slotMs: 100,
      fleetFile: "/out/fleet.json",
      routesFile: "/out/routes.json",
      cookieName: "trail_session",
      heatmapBbox: boundsOf(routes, 2000)
        .map((value) => value.toFixed(4))
        .join(","),
      dashboard: { opensPerMinute: preset.opensPerMinute, historyDays: preset.historyDays + 1 },
      backlog: { hours: preset.backlogHours, endsAgoS: 0 },
    };
    writeFileSync(join(runDir, "config.json"), JSON.stringify(config, null, 2));

    say(`the day: ${preset.daySeconds} s of phones and people (k6 day.js)`);
    const dayFrom = Date.now();
    const dayExit = await k6(stack, "day.js", known);
    const dayTo = Date.now();

    config.backlog.endsAgoS = Math.round((Date.now() - dayFrom) / 1000) + 60;
    writeFileSync(join(runDir, "config.json"), JSON.stringify(config, null, 2));
    say(`the backlog: ${preset.backlogHours} h of every phone at once (k6 backlog.js)`);
    const backlogFrom = Date.now();
    const backlogExit = await k6(stack, "backlog.js", known);
    const backlogTo = Date.now();

    say("settling: the last load line and the backlog's processing");
    await sleep(65_000);
    probe.kill("SIGTERM");
    await new Promise((resolve) => probe?.once("exit", resolve));
    probe = null;
    await collector.stop();

    const checks = await databaseChecks(
      stack,
      {
        probeDevice: probePerson.devices[0].id,
        day: { from: dayFrom, to: dayTo, daySeconds: preset.daySeconds },
        backlog: { from: backlogFrom, to: backlogTo },
      },
      history?.rows ?? 0,
    );
    writeFileSync(join(runDir, "checks.json"), JSON.stringify(checks, null, 2));

    const listening = JSON.parse(readFileSync(join(runDir, "collector.json"), "utf8")).app
      ?.listeningAt;
    const appStartedAt = await textOf("docker", [
      "inspect",
      "--format",
      "{{.State.StartedAt}}",
      `${projectName}-dev-1`,
    ]);
    const startupS =
      listening && appStartedAt ? (listening - Date.parse(appStartedAt)) / 1000 : null;
    const runRecord = {
      scenario,
      preset,
      seed,
      commit,
      commitFull,
      branch,
      dirty,
      image,
      startedAt,
      finishedAt: new Date().toISOString(),
      machine: await machineInfo(),
      machineAtStart,
      caps: { app: capOf(caps.app), db: capOf(caps.db), k6: capOf(caps.k6) },
      fsync,
      startupS,
      upSeconds: (dayFrom - upStarted) / 1000,
      fleet: {
        people: fleetPeople.length,
        phones: fleetPeople.length,
        mix: fleet.mix,
        shares: fleet.shares,
        profiles: profileCounts,
        apps: appCounts,
      },
      history,
      phases: {
        day: {
          from: new Date(dayFrom).toISOString(),
          to: new Date(dayTo).toISOString(),
          k6Exit: dayExit,
        },
        backlog: {
          from: new Date(backlogFrom).toISOString(),
          to: new Date(backlogTo).toISOString(),
          k6Exit: backlogExit,
        },
      },
      collectorStartedAt: new Date(collectorStarted).toISOString(),
    };
    writeFileSync(join(runDir, "run.json"), JSON.stringify(runRecord, null, 2));
    say(`k6: the day exited ${dayExit}, the backlog ${backlogExit}`);
    if (values["no-report"] !== true) {
      mkdirSync(fileURLToPath(new URL("../../docs/perf/", import.meta.url)), { recursive: true });
      const { name, failedGates } = writeReport(runDir);
      say(
        `report: docs/perf/${name}.md — ${failedGates.length === 0 ? "every gated target held" : `${failedGates.length} gated targets missed`}`,
      );
      process.exitCode = failedGates.length === 0 && dayExit === 0 && backlogExit === 0 ? 0 : 1;
    }
  } finally {
    probe?.kill("SIGTERM");
    if (values.keep === true) {
      say(
        `kept: ${projectName} still runs; remove it with docker compose -p ${projectName} down -v (and ${runDir})`,
      );
    } else {
      say(`removing ${projectName} and its volume`);
      await stack.compose(["--profile", "k6", "down", "--volumes", "--remove-orphans"], {
        allowFailure: true,
      });
      // The fleet's secrets go with the stack; the rest of the run's folder stays for a look.
      rmSync(join(runDir, "fleet.json"), { force: true });
      rmSync(join(runDir, "probe.json"), { force: true });
      rmSync(join(runDir, "compose.env"), { force: true });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`load: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
