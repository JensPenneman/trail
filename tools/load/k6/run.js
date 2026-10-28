/*
 * What every k6 script of the harness reads: the run's settings (written by
 * run.mjs to /out/config.json), the fleet's phones and people (fleet.json from
 * `trail load-fleet`) and the routes — once, shared by every virtual user.
 * k6 only: it runs in k6's init context.
 */
import { SharedArray } from "k6/data";
import { routesFrom } from "../lib/routes.js";

const configPath = __ENV.LOAD_CONFIG || "/out/config.json";

/** The run's settings (docs/perf/README.md, "What a run writes"). */
export const config = JSON.parse(open(configPath));

/** Every phone of the fleet but the probe's: its profile, app, token and device key. */
export const phones = new SharedArray("phones", () => {
  const fleet = JSON.parse(open(config.fleetFile));
  const list = [];
  for (const person of fleet.people) {
    if (person.probe) continue;
    for (const device of person.devices) {
      list.push({
        index: list.length,
        person: person.index,
        profile: device.profile,
        app: device.app,
        token: device.token,
        deviceKey: device.deviceKey,
      });
    }
  }
  return list;
});

/** The people of the fleet with their session (the dashboard signs in with it). */
export const people = new SharedArray("people", () => {
  const fleet = JSON.parse(open(config.fleetFile));
  return fleet.people
    .filter((person) => !person.probe)
    .map((person) => ({ index: person.index, session: person.session }));
});

/** The routes, as lib/routes.js reads them. */
const routes = new SharedArray("routes", () =>
  routesFrom("routes", JSON.parse(open(config.routesFile))),
);

/** The day's shape for lib/schedule.js. */
export const shape = {
  daySeconds: config.daySeconds,
  dayStartHour: config.dayStartHour,
  seed: config.seed,
};

/** A copy of every route for this virtual user (a SharedArray hands out copies). */
export function routeList() {
  const list = [];
  for (let index = 0; index < routes.length; index += 1) list.push(routes[index]);
  return list;
}
