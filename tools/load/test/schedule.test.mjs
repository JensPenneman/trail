import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fleetMixes } from "../../../apps/api/src/load/fleetProfiles.ts";
import { routesFrom } from "../lib/routes.js";
import {
  countBetween,
  planBacklog,
  planPhone,
  pointsBetween,
  stateAt,
  uploadsOf,
  visitsBetween,
} from "../lib/schedule.js";

const routes = routesFrom(
  "fixture",
  JSON.parse(
    readFileSync(
      new URL("../../../apps/api/tests/fixtures/overland-batch.json", import.meta.url),
      "utf8",
    ),
  ),
);

/** A fleet as `trail load-fleet` makes it: the mix, per thousand phones. */
const fleetOf = (/** @type {keyof typeof fleetMixes} */ mix) => {
  /** @type {{ index: number, profile: string }[]} */
  const phones = [];
  for (const [profile, count] of Object.entries(fleetMixes[mix])) {
    for (let index = 0; index < count; index += 1) phones.push({ index: phones.length, profile });
  }
  return phones;
};

/** What a fleet sends over a run of `daySeconds` (lib/schedule.js), per day and per hour of the day. */
function play(/** @type {number} */ daySeconds) {
  const hourly = Array.from({ length: 24 }, () => ({ uploads: 0, points: 0 }));
  /** @type {Map<number, number>} */
  const perTenSeconds = new Map();
  /** @type {Record<string, { phones: number, uploads: number, points: number }>} */
  const byProfile = {};
  let uploads = 0;
  let points = 0;
  for (const phone of fleetOf("default")) {
    const plan = planPhone(phone, routes, { daySeconds, dayStartHour: 0, seed: 1 });
    const profile = byProfile[phone.profile] ?? { phones: 0, uploads: 0, points: 0 };
    byProfile[phone.profile] = profile;
    profile.phones += 1;
    for (const upload of uploadsOf(plan, 0, daySeconds)) {
      const count = upload[4] === 1 ? 0 : countBetween(plan, upload[2], upload[3]);
      const hour = Math.min(23, Math.floor(upload[1] / 1000 / (daySeconds / 24)));
      uploads += 1;
      points += count;
      profile.uploads += 1;
      profile.points += count;
      const bucket = hourly[hour];
      if (bucket !== undefined) {
        bucket.uploads += 1;
        bucket.points += count;
      }
      const tenth = Math.floor(upload[1] / 10_000);
      perTenSeconds.set(tenth, (perTenSeconds.get(tenth) ?? 0) + 1);
    }
  }
  return {
    uploads,
    points,
    hourly,
    worstTenSeconds: Math.max(...perTenSeconds.values()),
    byProfile,
  };
}

/** @param {number} actual @param {number} expected @param {number} tolerance */
const near = (actual, expected, tolerance) =>
  assert.ok(
    Math.abs(actual - expected) / expected <= tolerance,
    `${actual.toFixed(2)} is not within ${tolerance * 100} % of ${expected}`,
  );

describe("a thousand phones' day (docs/design/capacity.md §2)", () => {
  const day = play(86_400);

  it("sends the design's points and requests a day (§2.3)", () => {
    near(day.points, 3_118_000, 0.05);
    near(day.uploads, 482_600, 0.05);
    near(day.points / 86_400, 36.1, 0.05);
    near(day.uploads / 86_400, 5.59, 0.05);
  });

  it("peaks at the morning hour and is quietest at night", () => {
    const pointsPerSecond = day.hourly.map((hour) => hour.points / 3600);
    const uploadsPerSecond = day.hourly.map((hour) => hour.uploads / 3600);
    near(pointsPerSecond[8] ?? 0, 51.4, 0.1);
    near(uploadsPerSecond[8] ?? 0, 9.42, 0.15);
    near(pointsPerSecond[2] ?? 0, 27.8, 0.15);
    near(uploadsPerSecond[2] ?? 0, 3.49, 0.1);
    assert.ok(
      Math.max(...pointsPerSecond) === Math.max(pointsPerSecond[8] ?? 0, pointsPerSecond[17] ?? 0),
    );
    // The worst ten seconds: Poisson around the peak (§2.3: 117 requests at p99).
    near(day.worstTenSeconds, 117, 0.15);
  });

  it("keeps every profile near its §2.2 day", () => {
    /** @type {Record<string, [number, number]>} */
    const designed = {
      "overland-balanced": [22, 1_100],
      "overland-balanced-plus": [22, 6_570],
      "overland-high-resolution": [1_440, 42_000],
      "overland-battery-saver": [37, 150],
      "owntracks-ios-move": [2_450, 2_450],
      "owntracks-ios-significant": [100, 100],
      "owntracks-android": [300, 300],
      traccar: [200, 200],
      osmand: [1_100, 1_100],
      gpslogger: [1_440, 1_440],
    };
    for (const [name, [uploads, points]] of Object.entries(designed)) {
      const profile = day.byProfile[name];
      assert.ok(profile !== undefined, name);
      // 50 to 250 phones of a profile, each with its own behaviour: within a fifth (a third for the 5-minute senders' uploads).
      near(
        profile.uploads / profile.phones,
        uploads,
        name.startsWith("overland-balanced") ? 0.4 : 0.2,
      );
      near(profile.points / profile.phones, points, 0.2);
    }
  });

  it("plays a compressed day at the same rates", () => {
    const hour = play(3600);
    near(hour.points / 3600, day.points / 86_400, 0.05);
    // The 5-minute senders send more, smaller batches: their moves shrink with the day.
    near(hour.uploads / 3600, day.uploads / 86_400, 0.15);
    near(hour.worstTenSeconds, day.worstTenSeconds, 0.2);
  });

  it("queues a third of a day in an eight-hour backlog (§2.3)", () => {
    let queued = 0;
    for (const phone of fleetOf("default")) {
      const plan = planBacklog(
        phone,
        routes,
        { daySeconds: 3600, dayStartHour: 0, seed: 1 },
        8 * 3600,
      );
      queued += countBetween(plan, -8 * 3600, 0);
    }
    near(queued, 1_040_000, 0.05);
  });
});

describe("a phone's points", () => {
  const plan = planPhone({ index: 7, profile: "overland-high-resolution" }, routes, {
    daySeconds: 3600,
    dayStartHour: 0,
    seed: 3,
  });

  it("are the same whenever they are asked for, and change with the seed", () => {
    assert.deepEqual(pointsBetween(plan, 1000, 1200), pointsBetween(plan, 1000, 1200));
    const whole = pointsBetween(plan, 0, 3600);
    const halves = [...pointsBetween(plan, 0, 1801), ...pointsBetween(plan, 1801, 3600)];
    assert.deepEqual(halves, whole);
    const other = planPhone({ index: 7, profile: "overland-high-resolution" }, routes, {
      daySeconds: 3600,
      dayStartHour: 0,
      seed: 4,
    });
    assert.notDeepEqual(pointsBetween(other, 0, 3600), whole);
  });

  it("fall on whole seconds, one a second at most, in order", () => {
    const points = pointsBetween(plan, 0, 3600);
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      assert.ok(previous !== undefined && point !== undefined);
      assert.ok(Number.isInteger(point.t) && point.t > previous.t);
    }
    assert.equal(countBetween(plan, 0, 3600), points.length);
  });

  it("move along the route at the mode's speed and stay put while still", () => {
    const moving = plan.states.find(
      (state) => state.kind === "moving" && state.to - state.from > 30,
    );
    assert.ok(moving !== undefined && moving.move !== null);
    const points = pointsBetween(plan, moving.from, moving.to);
    assert.ok(points.every((point) => point.moving && point.speedMs !== null && point.speedMs > 0));
    const still = plan.states.find((state) => state.kind === "still" && state.to - state.from > 60);
    assert.ok(still !== undefined);
    const stillPoints = pointsBetween(plan, still.from, still.to);
    assert.ok(
      stillPoints.every(
        (point) => !point.moving && point.speedMs === 0 && point.motion[0] === "stationary",
      ),
    );
    assert.equal(stateAt(plan, moving.from)?.kind, "moving");
  });

  it("are uploaded as each app does: Overland every minute, the others point by point", () => {
    const overland = uploadsOf(plan, 0, 3600);
    for (let index = 1; index < overland.length; index += 1) {
      assert.equal(((overland[index]?.[1] ?? 0) - (overland[index - 1]?.[1] ?? 0)) % 60_000, 0);
    }
    const gpslogger = planPhone({ index: 2, profile: "gpslogger" }, routes, {
      daySeconds: 3600,
      dayStartHour: 0,
      seed: 3,
    });
    const single = uploadsOf(gpslogger, 0, 3600);
    assert.ok(single.length >= 59 && single.length <= 61);
    assert.ok(single.every((upload) => upload[3] - upload[2] === 1));
    const ios = planPhone({ index: 4, profile: "owntracks-ios-move" }, routes, {
      daySeconds: 86_400,
      dayStartHour: 0,
      seed: 3,
    });
    const transitions = uploadsOf(ios, 0, 86_400).filter((upload) => upload[4] === 1);
    // Leaving and reaching each stop; a move the run's end cuts off has not arrived yet.
    assert.ok(
      transitions.length >= ios.moves.length * 2 - 1 && transitions.length <= ios.moves.length * 2,
    );
  });

  it("report iOS's visits to Overland: reaching a stop and leaving it", () => {
    const visits = visitsBetween(plan, 0, 3600);
    assert.ok(visits.length >= plan.moves.length * 2 - 1 && visits.length <= plan.moves.length * 2);
    assert.ok(visits.some((visit) => visit.departed === null));
  });
});
