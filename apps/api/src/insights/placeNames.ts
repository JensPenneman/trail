import type { PlaceName } from "@trail/contracts/insights";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { latToTileY, lonToTileX } from "../heatmap/tileMath";
import { haversineM } from "../tracks/haversine";
import type { PlaceGroup } from "./groupPlaces";

/** A stop within this far from a place's centre names it ("Near …" up to here): decided in SQL. */
const stopNameReachM = 150;
/** The latest stays of a nameless place that are asked what road they were on. */
const roadStays = 10;
/** A road is read from the minute before arrival and after departure. */
const roadWindowS = 60;

type StopKind = NonNullable<PlaceName> extends { kind: infer K } ? NonNullable<K> : never;

export interface StopCandidate {
  name: string;
  kind: StopKind;
  lat: number;
  lon: number;
}

/** The nearest of the stops within reach (`loadStops` brings no others), or null. Ties go to the shorter name, then alphabetically. */
export function stopNameFor(
  centre: readonly [number, number],
  candidates: readonly StopCandidate[],
): PlaceName {
  let best: { candidate: StopCandidate; distanceM: number } | null = null;
  for (const candidate of candidates) {
    const distanceM = haversineM(
      { lat: centre[1], lon: centre[0] },
      { lat: candidate.lat, lon: candidate.lon },
    );
    if (
      best === null ||
      distanceM < best.distanceM - 1e-9 ||
      (Math.abs(distanceM - best.distanceM) <= 1e-9 &&
        (candidate.name.length < best.candidate.name.length ||
          (candidate.name.length === best.candidate.name.length &&
            candidate.name < best.candidate.name)))
    ) {
      best = { candidate, distanceM };
    }
  }
  return best === null
    ? null
    : {
        text: best.candidate.name.slice(0, 200),
        source: "stop",
        kind: best.candidate.kind,
        distanceM: Math.round(best.distanceM),
      };
}

/** The most frequent of some road names; ties alphabetically. */
export function roadNameFrom(names: readonly string[]): PlaceName {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const [top] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return top === undefined
    ? null
    : { text: top[0].slice(0, 200), source: "road", kind: null, distanceM: 0 };
}

interface PoiRow extends Record<string, unknown> {
  i: number;
  name: string;
  kind: StopKind;
  lat: number;
  lon: number;
}

/** Degrees of latitude in the reach of a stop name (150 m), with a little to spare. */
const reachDegrees = 0.0014;
/** Metres in a degree of latitude, for the exact reach in SQL (flat at 150 m). */
const metresPerDegree = 111_195;

/**
 * The stops within reach of each centre, from the map data, by place index: the z14 tiles around
 * the centre pick the rows by index, a box of ±150 m keeps the few that can be near (a city tile
 * holds hundreds of bus stops), and a stop in two sources counts once, the newest.
 */
async function loadStops(
  db: Executor,
  centres: readonly (readonly [number, number])[],
): Promise<Map<number, StopCandidate[]>> {
  const xs: number[] = [];
  const ys: number[] = [];
  const is: number[] = [];
  const lons: number[] = [];
  const lats: number[] = [];
  centres.forEach(([lon, lat], index) => {
    const x = lonToTileX(lon, 14);
    const y = latToTileY(lat, 14);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        xs.push(x + dx);
        ys.push(y + dy);
        is.push(index);
        lons.push(lon);
        lats.push(lat);
      }
    }
  });
  const result = await db.execute<PoiRow>(sql`
    SELECT DISTINCT ON (t.i, p.id) t.i, p.name, p.kind, p.lat, p.lon
    FROM unnest(${sql.param(xs)}::int[], ${sql.param(ys)}::int[], ${sql.param(is)}::int[],
      ${sql.param(lons)}::float8[], ${sql.param(lats)}::float8[]) AS t(x, y, i, lon, lat)
    JOIN osm_pois p ON p.z = 14 AND p.x = t.x AND p.y = t.y AND p.name IS NOT NULL
      AND p.lat BETWEEN t.lat - ${reachDegrees} AND t.lat + ${reachDegrees}
      AND p.lon BETWEEN t.lon - ${reachDegrees} / cos(radians(t.lat))
        AND t.lon + ${reachDegrees} / cos(radians(t.lat))
      AND power((p.lat - t.lat) * ${metresPerDegree}, 2)
        + power((p.lon - t.lon) * ${metresPerDegree} * cos(radians(t.lat)), 2)
        <= ${stopNameReachM * stopNameReachM}
    ORDER BY t.i, p.id, p.fetched_at DESC
  `);
  const stops = new Map<number, StopCandidate[]>();
  for (const row of result.rows) {
    const list = stops.get(row.i) ?? [];
    list.push({ name: row.name, kind: row.kind, lat: row.lat, lon: row.lon });
    stops.set(row.i, list);
  }
  return stops;
}

interface WayRow extends Record<string, unknown> {
  i: number;
  way_id: number;
}

/**
 * Names for the places that have none from a stop: the named way most often
 * under the device in the minute before it arrived and after it left, over the
 * place's ten latest stays.
 */
async function loadRoadNames(
  db: Executor,
  wanted: readonly { index: number; group: PlaceGroup }[],
): Promise<Map<number, PlaceName>> {
  const names = new Map<number, PlaceName>();
  const devices: string[] = [];
  const froms: string[] = [];
  const tos: string[] = [];
  const is: number[] = [];
  for (const { index, group } of wanted) {
    // Each stay's own device, around the arrival and departure it really had: another device of
    // the place that was somewhere else then says nothing of it. At most 10 × 2 ranges a place.
    for (const stay of group.stays.slice(-roadStays)) {
      for (const [from, to] of [
        [stay.startMs - roadWindowS * 1000, stay.startMs],
        [stay.endMs, stay.endMs + roadWindowS * 1000],
      ] as const) {
        devices.push(stay.deviceId);
        froms.push(new Date(from).toISOString());
        tos.push(new Date(to).toISOString());
        is.push(index);
      }
    }
  }
  if (devices.length === 0) return names;
  const points = await db.execute<WayRow>(sql`
    SELECT t.i, pp.way_id
    FROM unnest(${sql.param(devices)}::uuid[], ${sql.param(froms)}::timestamptz[],
      ${sql.param(tos)}::timestamptz[], ${sql.param(is)}::int[]) AS t(device_id, f, e, i)
    JOIN processed_points pp ON pp.device_id = t.device_id
      AND pp.recorded_at >= t.f AND pp.recorded_at < t.e
    WHERE pp.kept AND pp.way_id IS NOT NULL
  `);
  const ids = [...new Set(points.rows.map((row) => row.way_id))];
  if (ids.length === 0) return names;
  const ways = await db.execute<{ id: number; name: string }>(sql`
    SELECT DISTINCT ON (id) id, tags->>'name' AS name
    FROM osm_ways
    WHERE id = ANY(${sql.param(ids)}::bigint[]) AND tags ? 'name'
    ORDER BY id, fetched_at DESC
  `);
  const nameOf = new Map(ways.rows.map((row) => [Number(row.id), row.name]));
  const byPlace = new Map<number, string[]>();
  for (const row of points.rows) {
    const name = nameOf.get(Number(row.way_id));
    if (name === undefined) continue;
    byPlace.set(row.i, [...(byPlace.get(row.i) ?? []), name]);
  }
  for (const [index, list] of byPlace) names.set(index, roadNameFrom(list));
  return names;
}

/**
 * Names for places (the top ones only), from the map data: a stop within
 * 150 m of the centre, else the named road the device was on around its
 * stays, else none. Nothing here reads a position the answer does not
 * already hold, and a name is all that is kept.
 */
export async function placeNames(
  db: Executor,
  groups: readonly PlaceGroup[],
): Promise<PlaceName[]> {
  if (groups.length === 0) return [];
  const stops = await loadStops(
    db,
    groups.map((group) => group.centre),
  );
  const names: PlaceName[] = groups.map((group, index) =>
    stopNameFor(group.centre, stops.get(index) ?? []),
  );
  const wanted = groups.flatMap((group, index) =>
    names[index] === null ? [{ index, group }] : [],
  );
  const roads = await loadRoadNames(db, wanted);
  for (const [index, name] of roads) names[index] = name;
  return names;
}
