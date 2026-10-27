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
 *   departure reports merged), a real walk between two stays is a move, a
 *   recording gap the phone lay still through is a stop, no stop holds travel,
 *   and a stop keeps how far apart its points lie (`features.spreadM`).
 */
export const processingVersions = { averaged: 1, mapped: 1, inferred: 3 } as const;

/** A version per level, as `processing_state` records them. */
export type ProcessingVersions = Readonly<Record<FromLevel, number>>;
