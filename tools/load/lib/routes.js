/*
 * Where the phones go: routes along roads, from a pluggable source. Until the
 * map-data stream's extract reader exists (docs/design/capacity.md §6.2,
 * generate-routes), the routes are recorded tracks from the repository's
 * fixtures — an Overland batch is a route as it was ridden. A file of routes
 * (`{ "routes": [{ "name", "coordinates": [[lon, lat], …] }] }`, what the
 * extract will produce) is read the same way.
 */

const metresPerDegree = 111_195;

/**
 * @typedef {{ name: string, coordinates: [number, number][], cumulative: number[], length: number }} Route
 */

/**
 * Metres between two positions (equirectangular: exact enough over a city).
 * @param {readonly [number, number]} a
 * @param {readonly [number, number]} b
 */
export function metresBetween(a, b) {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const east = (b[0] - a[0]) * metresPerDegree * Math.cos(latitude);
  const north = (b[1] - a[1]) * metresPerDegree;
  return Math.hypot(east, north);
}

/**
 * A route through `coordinates` (`[lon, lat]`), with the distance to each vertex.
 * @param {string} name
 * @param {readonly (readonly [number, number])[]} coordinates
 * @returns {Route}
 */
export function routeOf(name, coordinates) {
  if (coordinates.length < 2) throw new Error(`route ${name}: needs two positions at least`);
  /** @type {[number, number][]} */
  const vertices = coordinates.map(([lon, lat]) => [lon, lat]);
  const cumulative = [0];
  for (let index = 1; index < vertices.length; index += 1) {
    const previous = vertices[index - 1];
    const current = vertices[index];
    if (previous === undefined || current === undefined) continue;
    cumulative.push((cumulative[index - 1] ?? 0) + metresBetween(previous, current));
  }
  const length = cumulative.at(-1) ?? 0;
  if (!(length > 0)) throw new Error(`route ${name}: has no length`);
  return { name, coordinates: vertices, cumulative, length };
}

/**
 * The recorded positions of an Overland batch, in time order, as one route.
 * @param {string} name
 * @param {{ locations?: unknown }} batch
 * @returns {Route}
 */
function routeFromOverlandBatch(name, batch) {
  if (!Array.isArray(batch.locations)) throw new Error(`route ${name}: no "locations"`);
  /** @type {{ t: string, at: [number, number] }[]} */
  const points = [];
  for (const feature of batch.locations) {
    const properties = feature?.properties ?? {};
    const coordinates = feature?.geometry?.coordinates;
    // Points only: visits, trips and log events say where the phone was, not the way it went.
    if (properties.action !== undefined || properties.type === "trip") continue;
    if (!Array.isArray(coordinates) || typeof properties.timestamp !== "string") continue;
    points.push({ t: properties.timestamp, at: [Number(coordinates[0]), Number(coordinates[1])] });
  }
  points.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return routeOf(
    name,
    points.map((point) => point.at),
  );
}

/**
 * The routes of a source file: an Overland batch (a recorded fixture) or a file of routes.
 * @param {string} name
 * @param {unknown} json
 * @returns {Route[]}
 */
export function routesFrom(name, json) {
  if (typeof json !== "object" || json === null) throw new Error(`${name}: not a route source`);
  if ("locations" in json) return [routeFromOverlandBatch(name, json)];
  const listed = "routes" in json ? json.routes : undefined;
  if (!Array.isArray(listed)) throw new Error(`${name}: neither "locations" nor "routes"`);
  return listed.map((route, index) =>
    routeOf(String(route?.name ?? `${name}#${index}`), route?.coordinates ?? []),
  );
}

/**
 * The position `distance` metres along the route, going back and forth over
 * it; the bearing (degrees from north) is the way the phone is heading.
 * @param {Route} route
 * @param {number} distance
 * @returns {{ lon: number, lat: number, bearing: number }}
 */
export function positionAlong(route, distance) {
  const lap = 2 * route.length;
  const within = ((distance % lap) + lap) % lap;
  const outbound = within <= route.length;
  const along = outbound ? within : lap - within;
  let index = 1;
  while (index < route.cumulative.length - 1 && (route.cumulative[index] ?? 0) < along) index += 1;
  const from = route.coordinates[index - 1] ?? route.coordinates[0];
  const to = route.coordinates[index] ?? from;
  if (from === undefined || to === undefined) throw new Error(`route ${route.name}: empty`);
  const start = route.cumulative[index - 1] ?? 0;
  const span = (route.cumulative[index] ?? start) - start;
  const fraction = span > 0 ? (along - start) / span : 0;
  const lon = from[0] + (to[0] - from[0]) * fraction;
  const lat = from[1] + (to[1] - from[1]) * fraction;
  const east = (to[0] - from[0]) * Math.cos((lat * Math.PI) / 180);
  const north = to[1] - from[1];
  const heading = (Math.atan2(east, north) * 180) / Math.PI;
  const bearing = (((outbound ? heading : heading + 180) % 360) + 360) % 360;
  return { lon, lat, bearing };
}

/**
 * West, south, east and north of every route, padded by `padM` metres.
 * @param {readonly Route[]} routes
 * @param {number} padM
 * @returns {[number, number, number, number]}
 */
export function boundsOf(routes, padM) {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const route of routes) {
    for (const [lon, lat] of route.coordinates) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  const padLat = padM / metresPerDegree;
  const padLon = padM / (metresPerDegree * Math.cos((((south + north) / 2) * Math.PI) / 180));
  return [west - padLon, south - padLat, east + padLon, north + padLat];
}
