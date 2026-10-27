import type { PersonTrackState } from "../../people/PersonTrackState";
import { summarizePersonTrack } from "../../people/summarizePersonTrack";
import type { PersonTrackRequest, PersonTracks } from "../../queries/usePersonTracks";

/** Each requested person's track as a card shows it: waiting, failed, or summed up. */
export function personTrackStates(
  requests: readonly PersonTrackRequest[],
  tracks: PersonTracks,
): ReadonlyMap<string, PersonTrackState> {
  const states = new Map<string, PersonTrackState>();
  for (const [index, request] of requests.entries()) {
    const answer = tracks.data[index];
    states.set(
      request.userId,
      answer !== undefined
        ? { status: "ready", summary: summarizePersonTrack(answer, request.from) }
        : tracks.states[index]?.failed === true
          ? { status: "error" }
          : { status: "pending" },
    );
  }
  return states;
}
