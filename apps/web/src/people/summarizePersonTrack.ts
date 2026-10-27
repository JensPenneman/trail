import type { PersonTrackResponse } from "@trail/contracts/person";
import type { Track } from "@trail/contracts/track";

/** Someone's track for a day or a period, as the device that recorded most of it has it. */
export interface PersonTrackSummary {
  /** Of the device that recorded the most points (a phone and a tablet in one bag ride once). */
  distanceM: number;
  points: number;
  /** Its first and last point; null without points. */
  firstAt: string | null;
  lastAt: string | null;
  /** How many of their devices recorded anything: more than one is said, never added up. */
  devices: number;
  /** The period reaches back before the history they share: the server moved its start up. */
  limited: boolean;
}

/** The device that recorded the most points, the longer track on a tie. */
const busier = (best: Track | null, track: Track): Track =>
  best === null ||
  track.total > best.total ||
  (track.total === best.total && track.distanceM > best.distanceM)
    ? track
    : best;

/**
 * What `GET /api/v1/people/{userId}/track` answered for `[requestedFrom, …)`,
 * in a few numbers: nothing more than the answer holds. Devices are not added
 * up — a phone and an iPad on the same ride would double it, and a car's
 * tracker may have been driven by someone else — so the summary is that of
 * the device that recorded the most, with how many recorded at all.
 */
export function summarizePersonTrack(
  response: PersonTrackResponse,
  requestedFrom: string,
): PersonTrackSummary {
  const recorded = response.tracks.filter((track) => track.total > 0);
  const main = recorded.reduce<Track | null>(busier, null);
  return {
    distanceM: main?.distanceM ?? 0,
    points: main?.total ?? 0,
    firstAt: main?.firstAt ?? null,
    lastAt: main?.lastAt ?? null,
    devices: recorded.length,
    limited: Date.parse(response.from) > Date.parse(requestedFrom),
  };
}
