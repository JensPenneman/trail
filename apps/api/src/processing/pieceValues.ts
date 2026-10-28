import { haversineM } from "../tracks/haversine";
import { centroidOf, spreadOf } from "./detectStops";
import type { KeptPoint } from "./keptPoint";

/** A kept point of a stored segment as `processed_points` holds it, oldest first. */
export interface PiecePoint {
  t: number;
  latAvg: number;
  lonAvg: number;
  /** Null: not matched (a stop's point, or no map data). */
  latMap: number | null;
  lonMap: number | null;
  /** The way's shape from the point before, `[lon, lat]`, both ends excluded. */
  pathMap: readonly (readonly [number, number])[] | null;
  /** The averaged speed, m/s. */
  speed: number | null;
  accuracy: number;
}

/** What a piece of a stored segment holds of its own (`segments` columns and features). */
export interface PieceValues {
  pointCount: number;
  distanceM: number;
  /** Null when it has no point of its own: the stored ones stay. */
  start: { lat: number; lon: number } | null;
  end: { lat: number; lon: number } | null;
  centroid: { lat: number; lon: number } | null;
  features: Record<string, unknown>;
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** As the inference measures a move (`moveSeries`): along the matched way where both ends were matched. */
function intervalM(from: PiecePoint, to: PiecePoint): number {
  if (from.latMap === null || from.lonMap === null || to.latMap === null || to.lonMap === null) {
    return haversineM({ lat: from.latAvg, lon: from.lonAvg }, { lat: to.latAvg, lon: to.lonAvg });
  }
  let length = 0;
  let previous = { lat: from.latMap, lon: from.lonMap };
  for (const [lon, lat] of to.pathMap ?? []) {
    length += haversineM(previous, { lat, lon });
    previous = { lat, lon };
  }
  return length + haversineM(previous, { lat: to.latMap, lon: to.lonMap });
}

/**
 * A piece of a stored segment — the part beyond a window's end, or before its
 * start, that the window could not take in (docs/architecture.md §17.4) —
 * worked out from its own points, so that nothing counts twice: how many, how
 * far (a move's, as the inference measures it), where it starts, ends and
 * lies, and what follows from those among its features (a move's distance,
 * duration, points and average speed; a stop's spread and its last point).
 * Its mode and the rest stay the whole segment's until a window over it works
 * it out again.
 */
export function pieceValues(
  kind: "stop" | "move",
  points: readonly PiecePoint[],
  span: { startT: number; endT: number },
  features: Record<string, unknown>,
): PieceValues {
  const first = points[0];
  const last = points.at(-1);
  const position = (point: PiecePoint | undefined) =>
    point === undefined ? null : { lat: point.latAvg, lon: point.lonAvg };
  if (kind === "stop") {
    const kept = points.map(
      (point, index): KeptPoint => ({
        index,
        t: point.t,
        lat: point.latAvg,
        lon: point.lonAvg,
        speed: point.speed ?? 0,
        accuracy: point.accuracy,
        stationary: false,
        reportedSpeed: null,
        altitude: null,
        verticalAccuracy: null,
        motion: [],
      }),
    );
    return {
      pointCount: points.length,
      distanceM: 0,
      start: position(first),
      end: position(last),
      centroid: kept.length === 0 ? null : centroidOf(kept, 0, kept.length - 1),
      features: {
        ...features,
        spreadM: kept.length === 0 ? 0 : Math.round(spreadOf(kept, 0, kept.length - 1)),
        ...(last === undefined ? {} : { lastPointT: last.t }),
      },
    };
  }
  let distanceM = 0;
  let lat = 0;
  let lon = 0;
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    if (previous !== undefined) distanceM += intervalM(previous, point);
    lat += point.latAvg;
    lon += point.lonAvg;
  }
  const durationS = span.endT - span.startT;
  const speed =
    typeof features["speed"] === "object" && features["speed"] !== null ? features["speed"] : {};
  return {
    pointCount: points.length,
    distanceM: round(distanceM, 1),
    start: position(first),
    end: position(last),
    centroid: points.length === 0 ? null : { lat: lat / points.length, lon: lon / points.length },
    features: {
      ...features,
      durationS,
      distanceM: round(distanceM, 1),
      points: points.length,
      speed: { ...speed, average: round(durationS > 0 ? (distanceM / durationS) * 3.6 : 0, 2) },
    },
  };
}
