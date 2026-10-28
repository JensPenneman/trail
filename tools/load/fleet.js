/*
 * The phones (docs/design/capacity.md §6.2): every phone of the fleet plays
 * its day (lib/schedule.js) and uploads as its app does, through the three
 * ingest protocols. An open model: a constant-arrival-rate executor starts one
 * iteration every tenth of a second, whether or not the server keeps up, and
 * each iteration sends the uploads that fall in its tenth — so the arrivals
 * are the schedule's, bursts included, and a slow server makes k6 start more
 * virtual users instead of sending less (`dropped_iterations` counts what it
 * could not start).
 *
 *   k6 run fleet.js            the phones alone; day.js runs them with the people
 */

import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { requestsOf, sendUploads } from "./k6/ingest.js";
import { config, phones, routeList, shape } from "./k6/run.js";
import { summaryWriter } from "./k6/summary.js";
import { planPhone, uploadsOf } from "./lib/schedule.js";
import { errorBudget, ingestThresholds } from "./lib/targets.js";

const slotMs = config.slotMs || 100;

/** Every upload of the run, oldest first: `[phone, at ms, from s, to s, kind]`. */
const schedule = new SharedArray("schedule", () => {
  const routes = routeList();
  const all = [];
  for (let index = 0; index < phones.length; index += 1) {
    const plan = planPhone(phones[index], routes, shape);
    for (const upload of uploadsOf(plan, 0, shape.daySeconds)) all.push(upload);
  }
  return all.sort((a, b) => a[1] - b[1]);
});

/** @type {Map<number, { phone: object, plan: object }>} */
const plans = new Map();
let routesOfThisVu = null;

function planOf(index) {
  let entry = plans.get(index);
  if (entry === undefined) {
    if (routesOfThisVu === null) routesOfThisVu = routeList();
    const phone = phones[index];
    entry = { phone, plan: planPhone(phone, routesOfThisVu, shape) };
    plans.set(index, entry);
  }
  return entry;
}

/** The first upload at or after `ms`. */
function firstAt(ms) {
  let low = 0;
  let high = schedule.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (schedule[middle][1] < ms) low = middle + 1;
    else high = middle;
  }
  return low;
}

export const phonesScenario = {
  executor: "constant-arrival-rate",
  exec: "phonesSlot",
  rate: 1,
  timeUnit: `${slotMs}ms`,
  duration: `${shape.daySeconds}s`,
  preAllocatedVUs: 20,
  maxVUs: Math.max(200, phones.length * 3),
  gracefulStop: "30s",
};

export const phonesThresholds = {
  ...ingestThresholds("day"),
  "ingest_failed{phase:day}": [`rate<=${errorBudget.failed}`],
  "ingest_throttled{phase:day}": [`rate<=${errorBudget.throttledDay}`],
  points_dropped: ["count==0"],
  dropped_iterations: ["count==0"],
};

export const options = {
  scenarios: { phones: phonesScenario },
  thresholds: phonesThresholds,
  systemTags: [
    "status",
    "method",
    "name",
    "group",
    "check",
    "error",
    "error_code",
    "scenario",
    "expected_response",
  ],
  summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(90)", "p(95)", "p(99)", "count"],
  discardResponseBodies: false,
};

/** The wall clock of run second 0, shared with every iteration. */
export function setup() {
  return { epochMs: Date.now() };
}

/** One tenth of a second of the day: the uploads due in it. */
export function phonesSlot(data) {
  const slot = exec.scenario.iterationInTest;
  const fromMs = slot * slotMs;
  const toMs = fromMs + slotMs;
  const epochS = Math.floor(data.epochMs / 1000);
  const items = [];
  for (let index = firstAt(fromMs); index < schedule.length; index += 1) {
    const upload = schedule[index];
    if (upload[1] >= toMs) break;
    const { phone, plan } = planOf(upload[0]);
    for (const request of requestsOf(phone, plan, upload, epochS)) {
      items.push({
        app: phone.app,
        encoder: plan.profile.encoder,
        intervalS: plan.profile.upload.kind === "batch" ? plan.profile.upload.intervalS : 30,
        request,
      });
    }
  }
  if (items.length === 0) return;
  sendUploads(config.baseUrl, "day", items, data.epochMs + shape.daySeconds * 1000);
}

export const handleSummary = summaryWriter("fleet");
