import type { PersonTrackResponse } from "@trail/contracts/person";

/** Someone's track for a day or a period, summed over the devices they share. */
export interface PersonTrackSummary {
  distanceM: number;
  points: number;
  /** The first and last point of all their devices; null without points. */
  firstAt: string | null;
  lastAt: string | null;
  /** The period reaches back before the history they share: the server moved its start up. */
  limited: boolean;
}

/**
 * What `GET /api/v1/people/{userId}/track` answered for `[requestedFrom, …)`,
 * in a few numbers: nothing more than the answer holds.
 */
export function summarizePersonTrack(
  response: PersonTrackResponse,
  requestedFrom: string,
): PersonTrackSummary {
  let distanceM = 0;
  let points = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const track of response.tracks) {
    distanceM += track.distanceM;
    points += track.total;
    if (track.firstAt !== null) first = Math.min(first, Date.parse(track.firstAt));
    if (track.lastAt !== null) last = Math.max(last, Date.parse(track.lastAt));
  }
  return {
    distanceM,
    points,
    firstAt: Number.isFinite(first) ? new Date(first).toISOString() : null,
    lastAt: Number.isFinite(last) ? new Date(last).toISOString() : null,
    limited: Date.parse(response.from) > Date.parse(requestedFrom),
  };
}
