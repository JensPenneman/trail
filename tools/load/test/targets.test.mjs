import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  budgetFor,
  historyDayP95Ms,
  requestBudgets,
} from "../../../apps/api/src/requests/requestBudgets.ts";
import {
  batchClass,
  dashboardTargets,
  dashboardThresholds,
  ingestTargets,
  ingestThresholds,
} from "../lib/targets.js";

describe("the targets", () => {
  it("hold every batch size to the row of the next larger size §3.1 names", () => {
    assert.deepEqual(
      [0, 1, 2, 60, 99, 100, 300, 399, 400, 500, 699, 700, 1000, 5000].map(batchClass),
      [
        "1",
        "1",
        "2-99",
        "2-99",
        "2-99",
        "100-399",
        "100-399",
        "100-399",
        "400-699",
        "400-699",
        "400-699",
        "700-plus",
        "700-plus",
        "700-plus",
      ],
    );
    assert.deepEqual(
      ingestTargets.map((target) => [target.p50, target.p95, target.p99]),
      [
        [12, 40, 100],
        [30, 80, 200],
        [60, 150, 300],
        [100, 250, 500],
        [180, 400, 800],
      ],
    );
  });

  it("keep k6's ingest percentiles by phase and batch, without gating on them", () => {
    // §3.1 is gated server-side by the report; k6 only keeps its own durations.
    const thresholds = ingestThresholds("backlog");
    assert.deepEqual(thresholds["http_req_duration{phase:backlog,kind:ingest,batch:400-699}"], [
      "p(95)>=0",
    ]);
    assert.equal(Object.keys(thresholds).length, ingestTargets.length);
    const dashboard = dashboardThresholds();
    assert.deepEqual(dashboard["http_req_duration{kind:dashboard,endpoint:people}"], [
      "p(95)<=100",
    ]);
    // No row of §3.2: the API's budget for every other GET.
    assert.deepEqual(dashboard["http_req_duration{kind:dashboard,endpoint:activity}"], [
      "p(95)<=1000",
    ]);
    assert.equal(Object.keys(dashboard).length, Object.keys(dashboardTargets).length);
  });
});

/* The dashboard's targets are the API's request budgets (docs/architecture.md §8.10): one table in
 * the API, one here for k6, whose container cannot read the API's; their routes link them. */
describe("the dashboard's targets", () => {
  it("are the API's request budgets of the routes they ask", () => {
    for (const [endpoint, target] of Object.entries(dashboardTargets)) {
      const budget = endpoint === "history_day" ? historyDayP95Ms : budgetFor(target.route);
      assert.equal(target.p95, budget, `${endpoint} (${target.route})`);
      assert.ok(
        target.label.startsWith(target.route),
        `${endpoint}: the label starts with the route`,
      );
    }
  });

  it("ask every route the API holds to a budget of its own, but two the model leaves out", () => {
    const asked = new Set(Object.values(dashboardTargets).map((target) => target.route));
    const missing = requestBudgets
      .map((budget) => budget.route)
      .filter((route) => !asked.has(route));
    // §2.4's open is nine requests; the web asks the incoming shares and the raw track beside
    // the level's too, which the API's summary times.
    assert.deepEqual(missing, ["GET /api/v1/shares/incoming", "GET /api/tracks"]);
  });
});
