import { projectOntoSegment } from "./segmentGeometry";
import type { RoutePath } from "./wayGraph";

/*
 * The geometry shared by the two matchers (matchToWays and the rail
 * alignment): a leg between two matched points, a point's place on it and the
 * leg's vertices between two places.
 */

/** A piece of a matched line between two model points, as a polyline with a way per piece (-1: none). */
export interface Leg {
  xs: number[];
  ys: number[];
  ways: number[];
  /** Arc length at each vertex. */
  along: number[];
}

export function legOf(
  path: RoutePath | null,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Leg {
  const xs = path?.xs ?? [from.x, to.x];
  const ys = path?.ys ?? [from.y, to.y];
  const ways = path?.ways ?? [-1];
  const along = [0];
  for (let vertex = 1; vertex < xs.length; vertex += 1) {
    along.push(
      (along[vertex - 1] ?? 0) +
        Math.hypot(
          (xs[vertex] ?? 0) - (xs[vertex - 1] ?? 0),
          (ys[vertex] ?? 0) - (ys[vertex - 1] ?? 0),
        ),
    );
  }
  return { xs, ys, ways, along };
}

/** Where a point lands on a leg, never behind `minAlong`: points follow the line forward. */
export function placeOnLeg(
  leg: Leg,
  x: number,
  y: number,
  minAlong: number,
): { x: number; y: number; along: number; way: number } {
  let best = { x: leg.xs[0] ?? x, y: leg.ys[0] ?? y, along: 0, way: leg.ways[0] ?? -1 };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let piece = 0; piece < leg.xs.length - 1; piece += 1) {
    const end = leg.along[piece + 1] ?? 0;
    if (end < minAlong) continue;
    const projection = projectOntoSegment(
      x,
      y,
      leg.xs[piece] ?? 0,
      leg.ys[piece] ?? 0,
      leg.xs[piece + 1] ?? 0,
      leg.ys[piece + 1] ?? 0,
    );
    const start = leg.along[piece] ?? 0;
    let along = start + projection.t * (end - start);
    let px = projection.x;
    let py = projection.y;
    if (along < minAlong) {
      // Clamp to the earliest allowed position on this piece.
      const t = end === start ? 0 : (minAlong - start) / (end - start);
      along = minAlong;
      px = (leg.xs[piece] ?? 0) + t * ((leg.xs[piece + 1] ?? 0) - (leg.xs[piece] ?? 0));
      py = (leg.ys[piece] ?? 0) + t * ((leg.ys[piece + 1] ?? 0) - (leg.ys[piece] ?? 0));
    }
    const distance = Math.hypot(px - x, py - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: px, y: py, along, way: leg.ways[piece] ?? -1 };
    }
  }
  return best;
}

/** The vertices of a leg strictly between two arc lengths. */
export function verticesBetween(leg: Leg, from: number, to: number): [number, number][] {
  const vertices: [number, number][] = [];
  for (let vertex = 1; vertex < leg.xs.length - 1; vertex += 1) {
    const along = leg.along[vertex] ?? 0;
    if (along > from + 0.01 && along < to - 0.01)
      vertices.push([leg.xs[vertex] ?? 0, leg.ys[vertex] ?? 0]);
  }
  return vertices;
}

/** The point at arc length `along` on a leg (clamped to its ends), with the way of its piece. */
export function pointAtAlong(
  leg: Leg,
  along: number,
): { x: number; y: number; along: number; way: number } {
  const end = leg.along.at(-1) ?? 0;
  const target = Math.min(end, Math.max(0, along));
  for (let piece = 0; piece < leg.xs.length - 1; piece += 1) {
    const start = leg.along[piece] ?? 0;
    const stop = leg.along[piece + 1] ?? 0;
    if (target > stop && piece < leg.xs.length - 2) continue;
    const t = stop === start ? 0 : (target - start) / (stop - start);
    return {
      x: (leg.xs[piece] ?? 0) + t * ((leg.xs[piece + 1] ?? 0) - (leg.xs[piece] ?? 0)),
      y: (leg.ys[piece] ?? 0) + t * ((leg.ys[piece + 1] ?? 0) - (leg.ys[piece] ?? 0)),
      along: target,
      way: leg.ways[piece] ?? -1,
    };
  }
  return { x: leg.xs[0] ?? 0, y: leg.ys[0] ?? 0, along: 0, way: leg.ways[0] ?? -1 };
}
