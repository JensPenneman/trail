import type { PersonTrackSummary } from "./summarizePersonTrack";

/**
 * What a view has of someone's track for its day or period — asked for only
 * where their share includes history (`personTrackRequests`).
 */
export type PersonTrackState =
  | { status: "pending" }
  | { status: "error" }
  | { status: "ready"; summary: PersonTrackSummary };
