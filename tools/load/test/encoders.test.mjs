import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as samples from "../../../apps/api/tests/support/trackerSamples.ts";
import {
  base64,
  gpsloggerQuery,
  osmandQuery,
  overlandBatch,
  owntracksLocation,
  owntracksTransition,
  traccarForm,
} from "../lib/encoders.js";

/*
 * The harness sends what the apps send: the same fields as the integration
 * tests' samples (built from the apps' sources) and the repository's
 * Overland fixture, in the same units, the token where each app puts it.
 */
const token = `trl_${"a".repeat(43)}`;
const epochS = 1_793_000_000;
/** @type {import("../lib/schedule.js").Point} */
const moving = {
  t: 30,
  lon: 3.7174,
  lat: 51.0543,
  speedMs: 5.2,
  course: 271,
  accuracyM: 6,
  altitudeM: 9.5,
  motion: ["cycling"],
  battery: 0.81,
  moving: true,
  mode: "cycling",
};
const still = {
  ...moving,
  t: 90,
  speedMs: 0,
  course: null,
  motion: ["stationary"],
  moving: false,
  mode: null,
};
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../apps/api/tests/fixtures/overland-batch.json", import.meta.url),
    "utf8",
  ),
);

/** @param {string} query */
const paramsOf = (query) => new URLSearchParams(query.slice(query.indexOf("?") + 1));

describe("the encoders", () => {
  it("send Overland's batch as the fixture has it: features, visits, current, trip", () => {
    const request = overlandBatch(token, [moving, still], epochS, {
      deviceKey: "load-abc123-1",
      uniqueId: "5E0B7C1A-8A7D-4C49-9E62-3B2F1D6A0C44",
      desiredAccuracy: -1,
      visits: [{ at: 60, arrived: 60, departed: null, place: { lon: 3.7, lat: 51.04 } }],
      trip: { mode: "cycling", startedAt: 0, distanceM: 120, start: { lon: 3.71, lat: 51.05 } },
    });
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/api/overland");
    assert.equal(request.headers["Authorization"], `Bearer ${token}`);
    assert.equal(request.points, 2);
    const body = JSON.parse(request.body ?? "");
    const point = fixture.locations.find(
      (/** @type {any} */ feature) =>
        feature.properties.action === undefined && feature.properties.type === undefined,
    );
    assert.deepEqual(
      Object.keys(body.locations[0].properties).sort(),
      Object.keys(point.properties).sort(),
    );
    assert.equal(
      body.locations[0].properties.timestamp,
      new Date((epochS + 30) * 1000).toISOString().replace(/\.000Z$/, "Z"),
      "whole seconds, UTC",
    );
    assert.deepEqual(body.locations[0].geometry.coordinates, [3.7174, 51.0543]);
    assert.equal(body.locations[1].properties.speed, 0);
    assert.equal(body.locations[1].properties.course, -1);
    const visit = fixture.locations.find(
      (/** @type {any} */ feature) => feature.properties.action === "visit",
    );
    assert.deepEqual(
      Object.keys(body.locations[2].properties).sort(),
      Object.keys(visit.properties).sort(),
    );
    assert.equal(body.locations[2].properties.departure_date, null);
    assert.deepEqual(Object.keys(body.trip).sort(), Object.keys(fixture.trip).sort());
    assert.equal(body.trip.mode, "bicycle");
    assert.ok(body.current.properties.timestamp.endsWith("Z"));
    // A feature is about the 604 bytes of the fixture's (docs/design/capacity.md §2.2).
    const size = JSON.stringify(body.locations[0]).length;
    assert.ok(size > 520 && size < 680, `${size} bytes`);
  });

  it("send OwnTracks' messages as the apps do, with the token where each app puts it", () => {
    const ios = owntracksLocation("ios", token, moving, epochS, "load-abc123-5");
    const iosBody = JSON.parse(ios.body ?? "");
    const iosSample = samples.owntracksIosLocation(new Date(epochS * 1000));
    for (const key of [
      "_type",
      "lat",
      "lon",
      "tst",
      "acc",
      "alt",
      "vac",
      "vel",
      "cog",
      "p",
      "motionactivities",
      "conn",
      "m",
      "tid",
      "batt",
      "bs",
      "topic",
    ]) {
      assert.ok(key in iosBody && key in iosSample, key);
    }
    assert.equal(iosBody.tst, epochS + 30);
    assert.equal(iosBody.vel, 19, "km/h, whole");
    assert.equal(iosBody.batt, 81, "percent");
    assert.equal(ios.headers["Authorization"], `Bearer ${token}`);

    const android = owntracksLocation("android", token, still, epochS, "load-abc123-6");
    const androidBody = JSON.parse(android.body ?? "");
    const androidSample = samples.owntracksAndroidLocation(new Date(epochS * 1000));
    for (const key of [
      "_type",
      "_id",
      "created_at",
      "batt",
      "bs",
      "acc",
      "vac",
      "lat",
      "lon",
      "alt",
      "vel",
      "tst",
      "m",
      "conn",
      "SSID",
      "BSSID",
      "tid",
      "source",
      "topic",
    ]) {
      assert.ok(key in androidBody && key in androidSample, key);
    }
    assert.equal("cog" in androidBody, false, "Android leaves out what it does not know");
    assert.equal(
      android.headers["Authorization"],
      `Basic ${Buffer.from(`load-abc123-6:${token}`).toString("base64")}`,
    );

    const transition = JSON.parse(
      owntracksTransition(token, moving, epochS, 60, "leave", "load-abc123-5").body ?? "",
    );
    const transitionSample = samples.owntracksTransition(new Date(epochS * 1000), "leave");
    assert.deepEqual(Object.keys(transition).sort(), Object.keys(transitionSample).sort());
  });

  it("send the OsmAnd format as Traccar Client, OsmAnd and GPSLogger do, in their units", () => {
    const traccar = traccarForm(token, moving, epochS);
    const form = new URLSearchParams(traccar.body ?? "");
    const sample = new URLSearchParams(samples.traccarForm(token, new Date(epochS * 1000)));
    assert.deepEqual([...form.keys()].sort(), [...sample.keys()].sort());
    assert.equal(form.get("id"), token);
    assert.equal(form.get("timestamp"), String(epochS + 30), "seconds");
    assert.equal(form.get("speed"), (5.2 / 0.514444).toFixed(2), "knots");
    assert.equal(traccar.headers["Content-Type"], "application/x-www-form-urlencoded");

    const osmand = osmandQuery(token, moving, epochS);
    const query = paramsOf(osmand.path);
    assert.deepEqual(
      [...query.keys()].sort(),
      [...new URLSearchParams(samples.osmandQuery(token, new Date())).keys()].sort(),
    );
    assert.equal(query.get("token"), token);
    assert.equal(query.get("timestamp"), String((epochS + 30) * 1000), "milliseconds");
    assert.equal(osmand.method, "GET");

    const gpslogger = gpsloggerQuery(token, moving, epochS);
    const gpsQuery = paramsOf(gpslogger.path);
    assert.deepEqual(
      [...gpsQuery.keys()].sort(),
      [...new URLSearchParams(samples.gpsloggerQuery(new Date())).keys()].sort(),
    );
    assert.equal(
      gpsQuery.get("timestamp"),
      new Date((epochS + 30) * 1000).toISOString(),
      "ISO 8601",
    );
    assert.equal(gpsQuery.has("token"), false, "GPSLogger's token travels in a header");
    assert.equal(gpslogger.headers["Authorization"], `Bearer ${token}`);
  });

  it("encode Basic credentials as Buffer does", () => {
    // Device keys and tokens are ASCII.
    for (const text of ["", "a", "ab", "abc", "load-1:trl_xyz", "user:pa ss/word~"]) {
      assert.equal(base64(text), Buffer.from(text).toString("base64"));
    }
  });
});
