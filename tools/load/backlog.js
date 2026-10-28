/*
 * The morning after (docs/design/capacity.md §2.3, §6.2): the node was away
 * for `backlog.hours`, and every phone sends what it recorded meanwhile as its
 * app does — Overland its batches back to back, the one-point apps a message
 * at a time, in order — retrying by its app's rules when the per-device
 * limits answer 429 or 503. The drain time is the slowest phone's; the
 * thresholds hold the latencies, the limits' share (≤ 2 %) and the loss.
 */
import exec from "k6/execution";
import { Trend } from "k6/metrics";
import { requestsOf, sendUploads } from "./k6/ingest.js";
import { config, phones, routeList, shape } from "./k6/run.js";
import { summaryWriter } from "./k6/summary.js";
import { planBacklog } from "./lib/schedule.js";
import { backlogThresholds, errorBudget } from "./lib/targets.js";

const backlog = config.backlog || {};
const seconds = Math.round((backlog.hours || 8) * 3600);
const drain = new Trend("backlog_drain_s");

export const options = {
  scenarios: {
    backlog: {
      executor: "per-vu-iterations",
      exec: "flush",
      vus: phones.length,
      iterations: 1,
      maxDuration: "30m",
    },
  },
  thresholds: {
    ...backlogThresholds(),
    "ingest_failed{phase:backlog}": [`rate<=${errorBudget.failed}`],
    "ingest_throttled{phase:backlog}": [`rate<=${errorBudget.throttledBacklog}`],
    points_dropped: ["count==0"],
    backlog_drain_s: ["max>=0"],
  },
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
};

export function setup() {
  return { epochMs: Date.now() };
}

/** One phone's queue, sent as its app sends it. */
export function flush(data) {
  const phone = phones[exec.vu.idInTest - 1];
  if (phone === undefined) return;
  const plan = planBacklog(phone, routeList(), shape, seconds);
  // The backlog ends before the day's first point: its seconds count back from then.
  const epochS = Math.floor(data.epochMs / 1000) - Math.round(backlog.endsAgoS || 0);
  const started = Date.now();
  const deadline = started + 25 * 60_000;
  const upload = [plan.index, 0, -seconds, 0, 0];
  for (const request of requestsOf(phone, plan, upload, epochS)) {
    sendUploads(
      config.baseUrl,
      "backlog",
      [{ app: phone.app, encoder: plan.profile.encoder, intervalS: 60, request }],
      deadline,
    );
  }
  drain.add((Date.now() - started) / 1000);
}

export const handleSummary = summaryWriter("backlog");
