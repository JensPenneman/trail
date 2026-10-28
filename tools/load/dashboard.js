/*
 * The people (docs/design/capacity.md §2.4, §6.2): people open Trail at the
 * evening peak's rate — at least one a minute, so that a small fleet still
 * yields percentiles — signed in with the sessions `trail load-fleet` made.
 * An open is the home page's nine requests at once (session, configuration,
 * devices, people, shares, today's tracks at the account's level, the
 * timeline, day statistics, activity); a visit then looks at two History days
 * and now and then the heatmap, Insights or the access log, a little apart.
 *
 *   k6 run dashboard.js        the people alone; day.js runs them with the phones
 */
import { sleep } from "k6";
import exec from "k6/execution";
import http from "k6/http";
import { config, people, shape } from "./k6/run.js";
import { summaryWriter } from "./k6/summary.js";
import { randomFor } from "./lib/random.js";
import { dashboardThresholds } from "./lib/targets.js";

const dayMs = 86_400_000;
const dashboard = config.dashboard || {};
const opensPerMinute = Math.max(1, dashboard.opensPerMinute || 1);

export const peopleScenario = {
  executor: "constant-arrival-rate",
  exec: "personVisit",
  rate: opensPerMinute,
  timeUnit: "1m",
  duration: `${shape.daySeconds}s`,
  preAllocatedVUs: Math.max(2, opensPerMinute * 5),
  maxVUs: Math.max(20, opensPerMinute * 20),
  gracefulStop: "60s",
};

export const peopleThresholds = {
  ...dashboardThresholds(),
  "http_req_failed{kind:dashboard}": ["rate<0.001"],
};

export const options = {
  scenarios: { people: peopleScenario },
  thresholds: peopleThresholds,
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

/** @param {number} ms */
const iso = (ms) => new Date(ms).toISOString();
/** @param {number} ms */
const date = (ms) => iso(ms).slice(0, 10);

/**
 * A GET of the dashboard with the person's session, tagged by what it is for.
 * @param {string} cookie
 * @param {string} endpoint
 * @param {string} path
 */
function get(cookie, endpoint, path) {
  return {
    method: "GET",
    url: `${config.baseUrl}${path}`,
    params: {
      headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin", Accept: "application/json" },
      tags: { name: endpoint, kind: "dashboard", endpoint },
      responseCallback: http.expectedStatuses(200),
      timeout: "60s",
    },
  };
}

/** One person's visit: the open, then a few views. */
export function personVisit() {
  const iteration = exec.scenario.iterationInTest;
  const random = randomFor(config.seed, "visit", iteration);
  const person = people[Math.floor(random() * people.length)];
  const cookie = `${config.cookieName}=${person.session}`;
  const now = Date.now();
  const today = Math.floor(now / dayMs) * dayMs;
  const range = `from=${iso(today)}&to=${iso(now + 60_000)}`;

  http.batch([
    get(cookie, "session", "/api/auth/session"),
    get(cookie, "config", "/api/config"),
    get(cookie, "devices", "/api/devices"),
    get(cookie, "people", "/api/v1/people"),
    get(cookie, "shares", "/api/v1/shares"),
    get(cookie, "tracks_today", `/api/v1/tracks?${range}&level=inferred`),
    get(cookie, "timeline", `/api/v1/segments?${range}&limit=1000`),
    get(cookie, "days", `/api/stats/days?from=${date(today - 7 * dayMs)}&to=${date(today)}`),
    get(cookie, "activity", "/api/stats/activity?hours=48"),
  ]);

  const historyDays = Math.max(0, dashboard.historyDays || 0);
  for (let view = 0; view < 2; view += 1) {
    sleep(15 + random() * 30);
    const back = Math.floor(random() * (historyDays + 1));
    const from = today - back * dayMs;
    const to = back === 0 ? now + 60_000 : from + dayMs;
    const day = `from=${iso(from)}&to=${iso(to)}`;
    http.batch([
      get(cookie, "history_day", `/api/v1/tracks?${day}&level=inferred`),
      get(cookie, "timeline", `/api/v1/segments?${day}&limit=1000`),
    ]);
  }
  if (random() < 0.3) {
    sleep(10 + random() * 20);
    http.batch([get(cookie, "heatmap", `/api/heatmap?bbox=${config.heatmapBbox}&zoom=13`)]);
  }
  if (random() < 0.2) {
    sleep(10 + random() * 20);
    http.batch([
      get(
        cookie,
        "insights",
        `/api/v1/insights/overview?from=${date(today - 30 * dayMs)}&to=${date(today)}`,
      ),
    ]);
  }
  if (random() < 0.1) {
    sleep(10 + random() * 20);
    http.batch([get(cookie, "access_log", "/api/v1/access-log?limit=50")]);
  }
}

export const handleSummary = summaryWriter("dashboard");
