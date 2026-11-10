import type { FromLevel } from "./processingQueue";

/**
 * Versions of the processing algorithms, one per level (docs/architecture.md
 * §17). A level's version counts the changes to that level and to the levels
 * below it: a change to a stage or a threshold bumps its own level and every
 * level above it. Stops and moves are found before map matching (which
 * matches the moves only), so a change to them bumps the mapped level too —
 * unless the stored mapped points still serve: a window worked out again from
 * the inferred level reuses the mapping of a move whose points all have one,
 * and matches every other move (a point that was part of a stop has none), so
 * a change that only turns points of stops into moves needs the inferred
 * level alone. The derived rows record the version of what they hold: a
 * processed point the mapped one (it holds the averaged and mapped levels), a
 * segment the inferred one. At boot the server works the history out again
 * from the lowest level whose version changed, newest days first at low
 * priority; after a change to the inference alone, that runs on the stored
 * mapped points and the cached map data, without map matching again.
 *
 * - inferred 2: `features.wayKinds`, the distance shares by way kind.
 * - inferred 3: a visit's stop ends when the phone leaves (its arrival and
 *   departure reports merged, an open one over by the next arrival; a fix far
 *   off now and then is no departure), a real walk between two stays is a
 *   move, a recording gap the phone lay still through is a stop until it
 *   woke up (windows reach back over a gap to see both its ends), no stop
 *   holds travel, a stop keeps how far apart its points lie and when the
 *   last of its own was (`features.spreadM`, `features.lastPointT`), and a
 *   quick toggle runs until the first stop of ten minutes or more, or the
 *   first move of another kind of travel (on foot, by bike, by vehicle).
 * - inferred 4: train moves drawn along the railway: `features.railPath`, the verdict on the
 *   rail line of every move over the rail ways of its tiles, and `processed_points.lat_rail`,
 *   `lon_rail`, `path_rail`, the places of the accepted ones. Derived data of its own; the
 *   mapped level keeps its version, and the stored mapping a later pass reuses is `lat_map`.
 */
export const processingVersions = { averaged: 1, mapped: 1, inferred: 4 } as const;

/** A version per level, as `processing_state` records them. */
export type ProcessingVersions = Readonly<Record<FromLevel, number>>;

/**
 * Features of the stored data that are filled in afterwards, from rows already derived, without
 * working the history out again (processing/featureBackfill.ts, docs/architecture.md §17.4): the
 * version of each, as `processing_state` records it under `features`. New windows write them from
 * the pipeline; a bump runs the fill once more over the history.
 *
 * - wayTotals 1: `features.wayTotals`, the metres on each way of a mapped move (Insights › named
 *   roads), from the stored processed points.
 * - heatDays 1: the rows of `heat_days` (the heatmap by time on the move and speed), from the
 *   stored processed points and the segments, a local day at a time.
 */
export const processingFeatureVersions = { wayTotals: 1, heatDays: 1 } as const;

/** A feature of the segments that the backfill fills in. */
export type ProcessingFeature = keyof typeof processingFeatureVersions;
