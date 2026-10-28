import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  batchClass,
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

  it("become k6 thresholds by phase, endpoint and batch", () => {
    const thresholds = ingestThresholds("day");
    assert.deepEqual(thresholds["http_req_duration{phase:day,kind:ingest,batch:1}"], [
      "p(50)<=12",
      "p(95)<=40",
      "p(99)<=100",
    ]);
    assert.equal(Object.keys(thresholds).length, ingestTargets.length);
    const dashboard = dashboardThresholds();
    assert.deepEqual(dashboard["http_req_duration{kind:dashboard,endpoint:people}"], [
      "p(95)<=100",
    ]);
    assert.deepEqual(dashboard["http_req_duration{kind:dashboard,endpoint:activity}"], [
      "p(95)>=0",
    ]);
  });
});
