/*
 * History for the fleet (docs/design/capacity.md §6.2): `days` whole days
 * before today, as the phones' profiles record them (lib/schedule.js, an
 * uncompressed day each, every day its own), written straight into
 * `locations` with COPY; then the derived data the way an operator rebuilds
 * it — `trail recompute` (heat cells and daily statistics) and `trail
 * reprocess` over the range (the processed levels) — timed, which gives the
 * backfill's throughput of §3.2 (≥ 600 device-days an hour from the averaged
 * level, ≥ 1 500 points a second). The COPY goes through psql in the database
 * container: no port, no dependency.
 *
 *   node tools/load/backfill.mjs --env-file <run>/compose.env --fleet <run>/fleet.json --routes <run>/routes.json --days 2
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { LoadStack } from "./lib/compose.mjs";
import { secretsOf } from "./lib/redact.js";
import { routesFrom } from "./lib/routes.js";
import { planPhone, pointsBetween } from "./lib/schedule.js";

const dayMs = 86_400_000;
const columns = [
  "device_id",
  "recorded_at",
  "received_at",
  "lat",
  "lon",
  "altitude",
  "speed",
  "course",
  "horizontal_accuracy",
  "vertical_accuracy",
  "motion",
  "battery_level",
  "battery_state",
];

/**
 * The phones of a fleet file with their device ids (the probe's left out).
 * @param {{ people: { index: number, probe: boolean, devices: { id: string, profile: string }[] }[] }} fleet
 */
export function phonesOf(fleet) {
  /** @type {{ index: number, id: string, profile: string }[]} */
  const phones = [];
  for (const person of fleet.people) {
    if (person.probe) continue;
    for (const device of person.devices)
      phones.push({ index: phones.length, id: device.id, profile: device.profile });
  }
  return phones;
}

/**
 * CSV lines of one phone's day, `dayStartMs` its UTC midnight.
 * @param {{ index: number, id: string, profile: string }} phone
 * @param {readonly import("./lib/routes.js").Route[]} routes
 * @param {number} seed
 * @param {number} dayStartMs
 */
export function dayRows(phone, routes, seed, dayStartMs) {
  const plan = planPhone(phone, routes, {
    daySeconds: 86_400,
    dayStartHour: 0,
    seed: seed + Math.floor(dayStartMs / dayMs),
  });
  return pointsBetween(plan, 0, 86_400).map((point) => {
    const recorded = new Date(dayStartMs + point.t * 1000).toISOString();
    const received = new Date(dayStartMs + point.t * 1000 + 30_000).toISOString();
    return [
      phone.id,
      recorded,
      received,
      point.lat,
      point.lon,
      point.altitudeM,
      point.speedMs ?? "",
      point.course ?? "",
      point.accuracyM,
      3,
      `"{${point.motion.join(",")}}"`,
      point.battery,
      "unplugged",
    ].join(",");
  });
}

/**
 * Writes the history and rebuilds what is derived from it; resolves to the
 * counts and how long each step took.
 * The days end at the UTC midnight at or before `endMs` (by default now), so
 * that a backlog played later never sends a point of a day already written.
 * @param {{ stack: LoadStack, fleet: any, routes: readonly import("./lib/routes.js").Route[], seed: number, days: number, endMs?: number }} options
 */
export async function generateHistory({ stack, fleet, routes, seed, days, endMs = Date.now() }) {
  const phones = phonesOf(fleet);
  const known = secretsOf(fleet);
  const today = Math.floor(endMs / dayMs) * dayMs;
  const from = today - days * dayMs;
  const input = new PassThrough();
  const copy = stack.exec(
    "db",
    [
      "psql",
      "-U",
      "trail",
      "-d",
      "trail",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `COPY locations (${columns.join(", ")}) FROM STDIN WITH (FORMAT csv)`,
    ],
    { input, known },
  );
  let rows = 0;
  const copyStarted = performance.now();
  for (let day = 0; day < days; day += 1) {
    for (const phone of phones) {
      const lines = dayRows(phone, routes, seed, from + day * dayMs);
      rows += lines.length;
      if (lines.length > 0 && !input.write(`${lines.join("\n")}\n`)) {
        await new Promise((resolve) => input.once("drain", resolve));
      }
    }
  }
  input.end();
  await copy;
  const copySeconds = (performance.now() - copyStarted) / 1000;

  // The device's cached count, as the uploads would have kept it.
  await stack.psql(
    "UPDATE devices SET points_total = c.n FROM (SELECT device_id, count(*) AS n FROM locations GROUP BY device_id) c WHERE c.device_id = devices.id",
  );

  const recomputeStarted = performance.now();
  await stack.exec("app", ["trail", "recompute"], { known });
  const recomputeSeconds = (performance.now() - recomputeStarted) / 1000;

  const reprocessStarted = performance.now();
  const reprocessed = await stack.exec(
    "app",
    [
      "trail",
      "reprocess",
      "--from",
      new Date(from).toISOString(),
      "--to",
      new Date(today).toISOString(),
    ],
    { known },
  );
  const reprocessSeconds = (performance.now() - reprocessStarted) / 1000;
  // "<name> (<id>): 2 windows, 41870 points, 23 stops and moves": the numbers only.
  let windows = 0;
  let points = 0;
  let segments = 0;
  for (const line of reprocessed.stdout.split("\n")) {
    const match = /: (\d+) windows, (\d+) points, (\d+) stops and moves/.exec(line);
    if (match === null) continue;
    windows += Number(match[1]);
    points += Number(match[2]);
    segments += Number(match[3]);
  }
  return {
    days,
    from: new Date(from).toISOString(),
    to: new Date(today).toISOString(),
    phones: phones.length,
    rows,
    copySeconds,
    rowsPerSecond: rows / Math.max(copySeconds, 0.001),
    recomputeSeconds,
    reprocessSeconds,
    windows,
    points,
    segments,
    deviceDaysPerHour: (phones.length * days) / Math.max(reprocessSeconds / 3600, 1e-9),
    pointsPerSecond: points / Math.max(reprocessSeconds, 0.001),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      "env-file": { type: "string" },
      fleet: { type: "string" },
      routes: { type: "string" },
      days: { type: "string" },
      seed: { type: "string" },
      out: { type: "string" },
    },
  });
  if (
    values["env-file"] === undefined ||
    values.fleet === undefined ||
    values.routes === undefined
  ) {
    console.error(
      "usage: node tools/load/backfill.mjs --env-file <run>/compose.env --fleet <run>/fleet.json --routes <run>/routes.json [--days 2] [--seed 1] [--out history.json]",
    );
    process.exit(2);
  }
  const result = await generateHistory({
    stack: new LoadStack({ envFile: values["env-file"], env: process.env }),
    fleet: JSON.parse(readFileSync(values.fleet, "utf8")),
    routes: routesFrom("routes", JSON.parse(readFileSync(values.routes, "utf8"))),
    seed: Number(values.seed ?? 1),
    days: Number(values.days ?? 2),
  });
  if (values.out !== undefined) writeFileSync(values.out, JSON.stringify(result, null, 2));
  console.log(
    `backfill: ${result.rows} points over ${result.days} days by COPY in ${result.copySeconds.toFixed(1)} s; recompute ${result.recomputeSeconds.toFixed(1)} s; reprocess ${result.reprocessSeconds.toFixed(1)} s (${Math.round(result.pointsPerSecond)} points/s)`,
  );
}
