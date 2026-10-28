import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fleetMixes, fleetProfiles } from "../../../apps/api/src/load/fleetProfiles.ts";
import { behaviours, hourlyWeights, probeProfile, profiles } from "../lib/profiles.js";

describe("the phone profiles", () => {
  it("are the ones trail load-fleet hands out, each with its app", () => {
    assert.deepEqual(
      Object.keys(profiles).sort(),
      fleetProfiles.map((profile) => profile.name).sort(),
    );
    for (const { name, app } of fleetProfiles) assert.equal(profiles[name]?.app, app, name);
    for (const mix of Object.values(fleetMixes)) {
      assert.deepEqual(Object.keys(mix).sort(), Object.keys(profiles).sort());
    }
    assert.equal(profiles[probeProfile], undefined, "the probe is outside the mix");
  });

  it("give §2.2's points a day at 91.5 moving minutes", () => {
    const designed = {
      "overland-balanced": 1_100,
      "overland-balanced-plus": 6_570,
      "overland-high-resolution": 42_000,
      "overland-battery-saver": 150,
      "owntracks-ios-move": 2_450,
      "owntracks-ios-significant": 100,
      "owntracks-android": 300,
      traccar: 200,
      osmand: 1_100,
      gpslogger: 1_440,
    };
    for (const [name, profile] of Object.entries(profiles)) {
      const day = profile.movingPerMin * 91.5 + profile.stillPerMin * 1348.5 + profile.tailPerDay;
      const expected = designed[/** @type {keyof typeof designed} */ (name)];
      // §2.2 rounds the slow apps' days up (Android 274.5 → 300, Traccar 183 → 200)
      assert.ok(Math.abs(day - expected) / expected < 0.1, `${name}: ${day} against ${expected}`);
    }
  });

  it("weigh the hours to a mean of one, busiest at 08 (§2.1)", () => {
    assert.equal(hourlyWeights.length, 24);
    assert.ok(Math.abs(hourlyWeights.reduce((sum, weight) => sum + weight, 0) - 24) < 1e-9);
    const busiest = hourlyWeights.indexOf(Math.max(...hourlyWeights));
    assert.equal(busiest, 8);
    assert.ok(Math.abs((hourlyWeights[8] ?? 0) - 2.64) < 0.01);
    const shares = Object.values(behaviours).reduce((sum, behaviour) => sum + behaviour.share, 0);
    assert.ok(Math.abs(shares - 1) < 1e-9);
    const moving = Object.values(behaviours).reduce(
      (sum, behaviour) => sum + behaviour.share * behaviour.movingMinutes,
      0,
    );
    assert.equal(moving, 91.5);
  });
});
