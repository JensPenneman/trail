import type { FromLevel } from "./processingQueue";

/**
 * Versions of the processing algorithms, one per level (docs/architecture.md
 * §17). A level's version counts the changes to that level and to the levels
 * below it: a change to a stage or a threshold bumps its own level and every
 * level above it. Stops and moves are found before map matching (which
 * matches the moves only), so a change to them bumps the mapped level too.
 * The derived rows record the version of what they hold: a processed point the
 * mapped one (it holds the averaged and mapped levels), a segment the inferred
 * one. At boot the server works the history out again from the lowest level
 * whose version changed, newest days first at low priority; after a change to
 * the inference alone, that runs on the stored mapped points and the cached
 * map data, without map matching.
 *
 * - inferred 2: `features.wayKinds`, the distance shares by way kind.
 */
export const processingVersions = { averaged: 1, mapped: 1, inferred: 2 } as const;

/** A version per level, as `processing_state` records them. */
export type ProcessingVersions = Readonly<Record<FromLevel, number>>;
