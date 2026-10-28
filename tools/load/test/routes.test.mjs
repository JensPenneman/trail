import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { boundsOf, metresBetween, positionAlong, routeOf, routesFrom } from "../lib/routes.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../apps/api/tests/fixtures/overland-batch.json", import.meta.url),
    "utf8",
  ),
);

describe("routes", () => {
  it("read a recorded Overland batch as the way it was ridden, points only, in time order", () => {
    const [route] = routesFrom("fixture", fixture);
    assert.ok(route !== undefined);
    // 30 points of a bicycle ride from Ghent towards Aalter, about 13.7 km.
    assert.equal(route.coordinates.length, 30);
    assert.ok(route.length > 13_000 && route.length < 14_500, `${route.length} m`);
    assert.deepEqual(route.coordinates[0], [3.7108, 51.0357334]);
  });

  it("read a file of routes, as the extract will write it", () => {
    const routes = routesFrom("file", {
      routes: [
        {
          name: "a",
          coordinates: [
            [3.7, 51.05],
            [3.71, 51.05],
            [3.71, 51.06],
          ],
        },
      ],
    });
    assert.equal(routes[0]?.name, "a");
    assert.ok(Math.abs((routes[0]?.length ?? 0) - 1810) < 20);
    assert.throws(() => routesFrom("bad", { roads: [] }), /neither/);
    assert.throws(() => routeOf("short", [[3.7, 51]]), /two positions/);
  });

  it("go back and forth along the route, heading the way the phone goes", () => {
    const route = routeOf("line", [
      [3.7, 51.0],
      [3.7, 51.01],
    ]);
    const start = positionAlong(route, 0);
    const middle = positionAlong(route, route.length / 2);
    const back = positionAlong(route, route.length * 1.5);
    assert.ok(Math.abs(start.lat - 51.0) < 1e-9);
    assert.ok(Math.abs(middle.lat - 51.005) < 1e-6);
    assert.ok(Math.abs(back.lat - 51.005) < 1e-6);
    assert.ok(Math.abs(middle.bearing - 0) < 1e-6, "north on the way out");
    assert.ok(Math.abs(back.bearing - 180) < 1e-6, "south on the way back");
    assert.ok(Math.abs(positionAlong(route, 2 * route.length).lat - 51.0) < 1e-9);
    assert.ok(
      metresBetween([3.7, 51.0], [3.7, 51.01]) > 1110 &&
        metresBetween([3.7, 51.0], [3.7, 51.01]) < 1113,
    );
  });

  it("bound the routes for the heatmap's viewport", () => {
    const [west, south, east, north] = boundsOf(routesFrom("fixture", fixture), 2000);
    assert.ok(west < 3.53 && east > 3.72 && south < 50.98 && north > 51.04);
  });
});
