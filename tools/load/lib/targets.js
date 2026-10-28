/*
 * The targets of docs/design/capacity.md §3, once, for the k6 scripts (their
 * thresholds) and for report.mjs (the table of every target with what a run
 * measured). They are the node's targets; the Mac's thresholds are these
 * divided by the calibration factor of §6.5, which stays 1 until the same run
 * has been made on the node (docs/perf/README.md, "Calibration").
 */

/** The Mac against the node (§6.5): measured once a preview run on the node exists. */
export const calibration = { latency: 1 };

/**
 * Upload latency by batch size (§3.1), in ms. Every size is held to the row of
 * the next larger size the design names: 2–99 points to the 30–60 row,
 * 100–399 to the 200–300 row, 400–699 to the 500 row, more to the 1 000 row.
 */
export const ingestTargets = [
  { batch: "1", label: "1 point", from: 0, to: 1, p50: 12, p95: 40, p99: 100 },
  { batch: "2-99", label: "2–99 points (30–60 row)", from: 2, to: 99, p50: 30, p95: 80, p99: 200 },
  {
    batch: "100-399",
    label: "100–399 points (200–300 row)",
    from: 100,
    to: 399,
    p50: 60,
    p95: 150,
    p99: 300,
  },
  {
    batch: "400-699",
    label: "400–699 points (500 row)",
    from: 400,
    to: 699,
    p50: 100,
    p95: 250,
    p99: 500,
  },
  {
    batch: "700-plus",
    label: "700 points or more (1 000 row)",
    from: 700,
    to: Number.POSITIVE_INFINITY,
    p50: 180,
    p95: 400,
    p99: 800,
  },
];

/**
 * The batch-size class of an upload of `points` points (a region event or a
 * batch of visits only counts as one: the fixed cost of an upload).
 * @param {number} points
 */
export function batchClass(points) {
  const entry = ingestTargets.find((target) => points <= target.to);
  return entry?.batch ?? "700-plus";
}

/**
 * The dashboard's requests (§2.4) and their p95 targets in ms (§3.2); null:
 * §3.2 names none, the run reports what it measured.
 * @type {Readonly<Record<string, { label: string, p95: number | null }>>}
 */
export const dashboardTargets = {
  session: { label: "GET /api/auth/session", p95: 100 },
  config: { label: "GET /api/config", p95: 100 },
  devices: { label: "GET /api/devices", p95: 100 },
  people: { label: "GET /api/v1/people", p95: 100 },
  shares: { label: "GET /api/v1/shares", p95: 100 },
  tracks_today: { label: "today's tracks at the account's level (/api/v1/tracks)", p95: 400 },
  timeline: { label: "the timeline of a day (/api/v1/segments)", p95: 200 },
  days: { label: "day statistics (/api/stats/days)", p95: null },
  activity: { label: "activity (/api/stats/activity)", p95: null },
  history_day: { label: "History, one day of one device (/api/v1/tracks)", p95: 800 },
  heatmap: { label: "heatmap viewport (/api/heatmap)", p95: 150 },
  insights: { label: "Insights, a month (/api/v1/insights/overview)", p95: 1000 },
  access_log: { label: "access log (/api/v1/access-log)", p95: null },
};

/** The error budget (§3.1): shares of the ingest requests. */
export const errorBudget = {
  /** 5xx and other failures of valid uploads, not the limits' 429/503. */
  failed: 0.0001,
  /** 429/503 from the per-device limits on a normal day … */
  throttledDay: 0.001,
  /** … and during a backlog flush. */
  throttledBacklog: 0.02,
};

/** SSE, processing, the event loop and memory (§3.2, §3.3). */
export const serverTargets = {
  sseLagP95Ms: 1000,
  sseLagP99Ms: 3000,
  queueAgeP95QuietS: 300,
  queueAgeP95PeakS: 900,
  queueAgeMaxS: 3600,
  loopP99Ms: 50,
  loopMaxMs: 200,
  appRssMb: 700,
  appHeapMb: 450,
  appCpuPeak: 0.3,
  dbCpuSustained: 1,
  cacheHit: 0.98,
  deadTupleShare: 0.2,
  hotShare: 0.9,
  statementMaxMs: 5000,
  walPerDayGb: 15,
  diskPerDayGb: 2,
  amplification: 4,
  processingPointsPerS: 1500,
  backfillDeviceDaysPerHour: 600,
  startupS: 20,
};

/**
 * What k6 keeps of the ingest's latencies, by phase and batch class: its own
 * `http_req_duration`, the COMMIT and the hop included. §3 defines §3.1's
 * targets server-side, as `ingest_log.duration_ms` records them, so the
 * report gates on that column and shows these beside it, tracked: a
 * threshold that always holds is what makes k6 keep a tag's percentiles.
 * @param {string} phase
 * @returns {Record<string, string[]>}
 */
export function ingestThresholds(phase) {
  /** @type {Record<string, string[]>} */
  const thresholds = {};
  for (const target of ingestTargets) {
    thresholds[`http_req_duration{phase:${phase},kind:ingest,batch:${target.batch}}`] = [
      "p(95)>=0",
    ];
  }
  return thresholds;
}

/**
 * k6 thresholds of the dashboard's requests; those without a target only make
 * k6 keep their percentiles (a threshold is what makes it keep a tag's).
 * @returns {Record<string, string[]>}
 */
export function dashboardThresholds() {
  /** @type {Record<string, string[]>} */
  const thresholds = {};
  for (const [endpoint, target] of Object.entries(dashboardTargets)) {
    thresholds[`http_req_duration{kind:dashboard,endpoint:${endpoint}}`] = [
      target.p95 === null ? "p(95)>=0" : `p(95)<=${Math.round(target.p95 / calibration.latency)}`,
    ];
  }
  return thresholds;
}
