import { type WayKind, wayKinds } from "@trail/contracts/transport";
import type { LocalProjection } from "./localProjection";
import { type MapData, type WayClass, wayClassOf } from "./mapData";
import { projectOntoSegment } from "./segmentGeometry";

/** A way in projected metres. */
export interface IndexedWay {
  id: number;
  kind: WayKind;
  wayClass: WayClass;
  nodes: readonly number[];
  xs: Float64Array;
  ys: Float64Array;
  /** Distance along the way at each vertex. */
  offsets: Float64Array;
}

/** The point of a way nearest to a position. */
export interface WayCandidate {
  /** Index into `WayIndex.ways`. */
  way: number;
  /** Segment from vertex `segment` to `segment + 1`. */
  segment: number;
  /** Position along that segment, 0–1. */
  t: number;
  x: number;
  y: number;
  distance: number;
  /** Distance along the way from its first vertex. */
  offset: number;
}

/** One bit per way kind, for `kindsNear`. */
export const kindBits = Object.fromEntries(
  wayKinds.map((kind, position) => [kind, 1 << position]),
) as Readonly<Record<WayKind, number>>;

const cellSizeM = 100;
/** Segments per way stay far below this (OSM allows 2000 nodes per way). */
const segmentSlots = 4096;
const cellKey = (cx: number, cy: number): number => (cx + 1_048_576) * 2_097_152 + (cy + 1_048_576);

/** Visits every grid cell the segment a–b passes through (Amanatides & Woo). */
function forEachCell(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  visit: (cx: number, cy: number) => void,
): void {
  let cx = Math.floor(ax / cellSizeM);
  let cy = Math.floor(ay / cellSizeM);
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const deltaX = stepX === 0 ? Number.POSITIVE_INFINITY : cellSizeM / Math.abs(dx);
  const deltaY = stepY === 0 ? Number.POSITIVE_INFINITY : cellSizeM / Math.abs(dy);
  let maxX =
    stepX > 0
      ? ((cx + 1) * cellSizeM - ax) / dx
      : stepX < 0
        ? (cx * cellSizeM - ax) / dx
        : Number.POSITIVE_INFINITY;
  let maxY =
    stepY > 0
      ? ((cy + 1) * cellSizeM - ay) / dy
      : stepY < 0
        ? (cy * cellSizeM - ay) / dy
        : Number.POSITIVE_INFINITY;
  visit(cx, cy);
  while (Math.min(maxX, maxY) <= 1) {
    if (maxX < maxY) {
      cx += stepX;
      maxX += deltaX;
    } else {
      cy += stepY;
      maxY += deltaY;
    }
    visit(cx, cy);
  }
  const endX = Math.floor(bx / cellSizeM);
  const endY = Math.floor(by / cellSizeM);
  if (endX !== cx || endY !== cy) visit(endX, endY);
}

/**
 * The ways of a window in projected metres, with a 100 m grid over their
 * segments: candidates for map matching, and "is a railway near here?" for the
 * corridor ratio. Ways are ordered by id, so results never depend on the order
 * the map data arrived in.
 */
export class WayIndex {
  readonly projection: LocalProjection;
  readonly ways: readonly IndexedWay[];
  readonly #cells = new Map<number, number[]>();

  constructor(map: MapData, projection: LocalProjection) {
    this.projection = projection;
    const sorted = [...map.ways]
      .filter((way) => way.geometry.length >= 2 && way.geometry.length === way.nodes.length)
      .sort((a, b) => a.id - b.id);
    const ways: IndexedWay[] = [];
    let previousId = Number.NaN;
    for (const way of sorted) {
      if (way.id === previousId) continue; // the same way from two tiles
      previousId = way.id;
      const count = way.geometry.length;
      const xs = new Float64Array(count);
      const ys = new Float64Array(count);
      const offsets = new Float64Array(count);
      for (const [vertex, [lon, lat]] of way.geometry.entries()) {
        xs[vertex] = projection.x(lon);
        ys[vertex] = projection.y(lat);
        if (vertex > 0) {
          offsets[vertex] =
            (offsets[vertex - 1] ?? 0) +
            Math.hypot(
              (xs[vertex] ?? 0) - (xs[vertex - 1] ?? 0),
              (ys[vertex] ?? 0) - (ys[vertex - 1] ?? 0),
            );
        }
      }
      ways.push({
        id: way.id,
        kind: way.kind,
        wayClass: wayClassOf(way.kind),
        nodes: way.nodes,
        xs,
        ys,
        offsets,
      });
    }
    this.ways = ways;
    for (const [wayIndex, way] of ways.entries()) {
      for (let segment = 0; segment < way.xs.length - 1; segment += 1) {
        const code = wayIndex * segmentSlots + segment;
        forEachCell(
          way.xs[segment] ?? 0,
          way.ys[segment] ?? 0,
          way.xs[segment + 1] ?? 0,
          way.ys[segment + 1] ?? 0,
          (cx, cy) => {
            const key = cellKey(cx, cy);
            let list = this.#cells.get(key);
            if (list === undefined) {
              list = [];
              this.#cells.set(key, list);
            }
            if (list.at(-1) !== code) list.push(code);
          },
        );
      }
    }
  }

  /** Calls `visit` with every segment code in the cells within `radius` of (x, y). */
  #forEachSegmentNear(x: number, y: number, radius: number, visit: (code: number) => void): void {
    const minX = Math.floor((x - radius) / cellSizeM);
    const maxX = Math.floor((x + radius) / cellSizeM);
    const minY = Math.floor((y - radius) / cellSizeM);
    const maxY = Math.floor((y + radius) / cellSizeM);
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) {
        for (const code of this.#cells.get(cellKey(cx, cy)) ?? []) visit(code);
      }
    }
  }

  /** The nearest point of each way within `radius`, nearest first (then by way id), at most `limit`. */
  candidates(x: number, y: number, radius: number, limit: number): WayCandidate[] {
    const best = new Map<number, WayCandidate>();
    this.#forEachSegmentNear(x, y, radius, (code) => {
      const wayIndex = Math.floor(code / segmentSlots);
      const segment = code % segmentSlots;
      const way = this.ways[wayIndex];
      if (way === undefined) return;
      const projection = projectOntoSegment(
        x,
        y,
        way.xs[segment] ?? 0,
        way.ys[segment] ?? 0,
        way.xs[segment + 1] ?? 0,
        way.ys[segment + 1] ?? 0,
      );
      const distance = Math.sqrt(projection.distanceSquared);
      if (distance > radius) return;
      const current = best.get(wayIndex);
      if (current !== undefined && current.distance <= distance) return;
      const start = way.offsets[segment] ?? 0;
      const length = (way.offsets[segment + 1] ?? 0) - start;
      best.set(wayIndex, {
        way: wayIndex,
        segment,
        t: projection.t,
        x: projection.x,
        y: projection.y,
        distance,
        offset: start + projection.t * length,
      });
    });
    return [...best.values()]
      .sort((a, b) => a.distance - b.distance || a.way - b.way)
      .slice(0, limit);
  }

  /** The kinds of the ways within `radius` of (x, y), as a bit mask (`1 << wayKinds.indexOf(kind)`). */
  kindsNear(x: number, y: number, radius: number): number {
    let mask = 0;
    const limit = radius * radius;
    this.#forEachSegmentNear(x, y, radius, (code) => {
      const way = this.ways[Math.floor(code / segmentSlots)];
      if (way === undefined) return;
      const bit = kindBits[way.kind];
      if ((mask & bit) !== 0) return;
      const segment = code % segmentSlots;
      const projection = projectOntoSegment(
        x,
        y,
        way.xs[segment] ?? 0,
        way.ys[segment] ?? 0,
        way.xs[segment + 1] ?? 0,
        way.ys[segment + 1] ?? 0,
      );
      if (projection.distanceSquared <= limit) mask |= bit;
    });
    return mask;
  }
}
