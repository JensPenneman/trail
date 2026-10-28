import type { RegionPolygon } from "../db/schema/osmRegions";
import { MapDataError } from "./mapDataError";

/** Europe's polygon has about 8 000 points; these bounds leave room and stop a runaway file. */
const maxRings = 10_000;
const maxPoints = 500_000;

type Ring = [number, number][];

export interface RegionOutline {
  polygon: RegionPolygon;
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/** Even-odd ray casting: whether (lon, lat) lies inside the ring. */
function insideRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index] ?? [0, 0];
    const [xj, yj] = ring[previous] ?? [0, 0];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The region's polygon from region.poly (Osmosis's polygon filter format, as
 * Geofabrik publishes it: a name line, then sections of `lon lat` lines that
 * each end with END, a section whose name starts with `!` a hole, and a last
 * END) as a GeoJSON MultiPolygon with its bounding box. Rings are closed; a
 * hole goes with the outline that holds its first point.
 */
export function parseRegionPoly(text: string): RegionOutline {
  const lines = text.split("\n").map((line) => line.trim());
  const outlines: Ring[][] = [];
  const holes: Ring[] = [];
  let points = 0;
  let index = 1;
  let finished = false;
  const problem = (why: string) => new MapDataError(`region.poly ${why} (line ${index})`);
  if (lines.length < 2) throw problem("is empty");
  while (index < lines.length && !finished) {
    const header = lines[index] ?? "";
    index += 1;
    if (header === "") continue;
    if (header === "END") {
      finished = true;
      break;
    }
    const ring: Ring = [];
    for (;;) {
      if (index >= lines.length) throw problem("ends inside a ring");
      const line = lines[index] ?? "";
      index += 1;
      if (line === "END") break;
      const parts = line.split(/\s+/);
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      if (parts.length !== 2 || !(Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) {
        throw problem("has a line that is no longitude and latitude");
      }
      ring.push([lon, lat]);
      points += 1;
      if (points > maxPoints) throw problem(`has more than ${maxPoints} points`);
    }
    const [first] = ring;
    const last = ring.at(-1);
    if (
      first !== undefined &&
      last !== undefined &&
      (first[0] !== last[0] || first[1] !== last[1])
    ) {
      ring.push([first[0], first[1]]);
    }
    if (ring.length < 4) throw problem("has a ring of fewer than three points");
    if (header.startsWith("!")) holes.push(ring);
    else outlines.push([ring]);
    if (outlines.length + holes.length > maxRings) throw problem(`has more than ${maxRings} rings`);
  }
  if (!finished) throw problem("does not end with END");
  if (lines.slice(index).some((line) => line !== "")) throw problem("goes on after its last END");
  if (outlines.length === 0) throw problem("has no ring");
  for (const hole of holes) {
    const [lon, lat] = hole[0] ?? [0, 0];
    const outline = outlines.find(([ring]) => ring !== undefined && insideRing(ring, lon, lat));
    if (outline === undefined) throw problem("has a hole outside its rings");
    outline.push(hole);
  }
  let minLat = Number.POSITIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const [ring] of outlines) {
    for (const [lon, lat] of ring ?? []) {
      minLat = Math.min(minLat, lat);
      minLon = Math.min(minLon, lon);
      maxLat = Math.max(maxLat, lat);
      maxLon = Math.max(maxLon, lon);
    }
  }
  return {
    polygon: { type: "MultiPolygon", coordinates: outlines },
    minLat,
    minLon,
    maxLat,
    maxLon,
  };
}
