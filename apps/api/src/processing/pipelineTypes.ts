import type { ChosenMode, TransportMode, WayKind } from "@trail/contracts/transport";
import type { StopShape } from "./stayParts";

/** A recorded point as the pipeline reads it from `locations`, oldest first. */
export interface RawPoint {
  /** Epoch seconds (Overland's timestamps are whole seconds). */
  t: number;
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres; null when the phone did not say. */
  accuracy: number | null;
  /** Reported speed in m/s; null when unknown. */
  speed: number | null;
  altitude: number | null;
  verticalAccuracy: number | null;
  /** CoreMotion activity (`walking`, `driving` …). */
  motion: readonly string[];
}

/** The averaged level of one point (`processed_points.lat_avg` …), in the order of the input. */
export interface AveragedPoint {
  t: number;
  /** False for points dropped as too inaccurate or as a spike. */
  kept: boolean;
  lat: number;
  lon: number;
  /** Median of the reported and the derived speeds, m/s. */
  speed: number;
  /** Part of a stationary cluster (collapsed to its centroid). */
  stationary: boolean;
  /** Accuracy used for weights and radii (a default when unknown). */
  accuracy: number;
}

/** The mapped level of one point. `lat`/`lon` null: not mapped (no map data). */
export interface MappedPoint {
  lat: number | null;
  lon: number | null;
  /** OSM way id; null for stop points and points no way was near. */
  wayId: number | null;
  /** Null for stop points (not matched) and when not mapped. */
  wayKind: WayKind | null;
  /** Distance between the averaged and the mapped position, metres. */
  snapM: number | null;
  /** The way's shape between the previous point of the move and this one, `[lon, lat]`, both ends excluded. */
  path: readonly (readonly [number, number])[] | null;
}

/** An iOS visit (CLVisit) as stops use it. */
export interface VisitSpan {
  arrivedAt: number;
  /** Null while the visit is still open (or its departure was never reported). */
  departedAt: number | null;
  /** Without a departure: the next visit's arrival, by which this one was over (else none). */
  endsBy?: number | null;
  lat: number;
  lon: number;
  accuracy: number | null;
}

/** A trip recorded with Overland's trip button, or the one running now. */
export interface ManualTrip {
  startedAt: number;
  endedAt: number;
  /** Overland's trip mode (`walk`, `bicycle`, `train` …). */
  mode: string;
}

/** An active correction (`mode_overrides`), in creation order. */
export interface OverrideSpan {
  id: string;
  kind: "segment" | "toggle";
  mode: ChosenMode;
  from: number;
  /** Null: open, until the first stop of `toggleEndingStopS` or more, or move of another kind of travel. */
  to: number | null;
  /** That stop when it lies before the window (from stored segments); else null. */
  endsBy: number | null;
  /**
   * A toggle that began before the window: whether a stay of the device began
   * between its start and the window's (stored segments) — then the window's
   * moves are no longer the toggle's own first move, and their kind of travel
   * counts.
   */
  stoppedBefore: boolean;
  createdAt: number;
  source: "ui" | "api" | "mcp";
}

/**
 * The stored stop the window begins in or right after (`loadStayBefore`), as
 * the window leaves it: the earlier part of a stay the window's first stop
 * may continue (`continuesStop`).
 */
export interface StayBefore extends StopShape {
  /** When its stay began; null: at or before the earliest start of the window's toggles. */
  stayStartT: number | null;
}

/** A stop or move over a range of the window's kept points (indices into the kept list). */
export interface Span {
  kind: "stop" | "move";
  /**
   * First and last kept point (inclusive). A move shares its end points with
   * the stops beside it, unless the stop lasted beyond its last point.
   */
  first: number;
  last: number;
  /**
   * A stop's last point of its own when `last` is a later one: the point the
   * phone resumed or woke up at, which no move starts at, so the stop takes
   * it — it only says when the phone had left.
   */
  ownLast?: number;
  startT: number;
  endT: number;
}

/** What a move was judged on (`segments.features`). */
export interface MoveFeatures {
  durationS: number;
  distanceM: number;
  points: number;
  /** Median and p85 interval speed (time-weighted), the p98 as top speed, and distance over time; km/h. */
  speed: { median: number; p85: number; max: number; average: number };
  /** Variance of the acceleration between dense intervals, (m/s²)²; null with too few of them. */
  accelerationVariance: number | null;
  /** Shares of the distance by the way the points were matched to; null without map data. */
  ways: WayShares | null;
  /**
   * The same shares by way kind, every kind present (a matched point without a
   * way kind counts as `other`): what `ways` sums up by family. Null exactly
   * when `ways` is.
   */
  wayKinds: Record<WayKind, number> | null;
  /** Shares of the distance near tram tracks, cycleways and footways (they run beside roads). */
  near: { tram: number; cycleway: number; foot: number } | null;
  /** Share of points sampled every 250 m along the straight lines between points that lie near a railway / motorway. */
  corridor: { rail: number; motorway: number; samples: number } | null;
  /** Pauses inside the move near a public transport stop, by kind; null without map data. */
  dwells: StopCounts | null;
  /** The stops before and after the move near a public transport stop (0, 1 or 2 each). */
  ends: StopCounts | null;
  /** Bus and tram stops the move passed (within a few metres), stopping or not. */
  passed: { busStop: number; tramStop: number } | null;
  /** Time shares of CoreMotion's activities; `coverage` is the share with any reading. */
  motion: {
    stationary: number;
    walking: number;
    running: number;
    cycling: number;
    automotive: number;
    coverage: number;
  };
  /** Mode of an Overland trip covering most of the move. */
  tripMode: TransportMode | null;
  altitude: { maxM: number | null; climbMs: number | null };
  /** Largest distance of a point from the move's first point, metres. */
  extentM: number;
}

export interface WayShares {
  rail: number;
  subway: number;
  tram: number;
  motorway: number;
  road: number;
  cycleway: number;
  foot: number;
  ferry: number;
  none: number;
}

export interface StopCounts {
  station: number;
  tramStop: number;
  subway: number;
  busStop: number;
  ferry: number;
  aerodrome: number;
}

/** The scores of every mode and what won. */
export interface ModeVerdict {
  mode: TransportMode;
  confidence: number;
  scores: Readonly<Record<TransportMode, number>>;
}

/** A finished stop or move of the inferred level (`segments`). */
export interface InferredSegment {
  kind: "stop" | "move";
  startT: number;
  endT: number;
  /** Kept-point indices (inclusive). */
  first: number;
  last: number;
  distanceM: number;
  pointCount: number;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  centroid: { lat: number; lon: number };
  modeInferred: TransportMode | null;
  modeUser: ChosenMode | null;
  confidence: number | null;
  averageSpeedMs: number | null;
  maxSpeedMs: number | null;
  /**
   * `segments.features`: of a move what the mode was judged on, the scores and
   * the override that applies; of a stop how far apart its points lie
   * (`spreadM`) and when its last point of its own was recorded
   * (`lastPointT`, epoch seconds: a stop can last until after it).
   */
  features: Record<string, unknown>;
}
