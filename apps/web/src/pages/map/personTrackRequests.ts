import type { Person } from "@trail/contracts/person";
import { sharesHistory } from "../../people/sharesHistory";
import type { PersonTrackRequest } from "../../queries/usePersonTracks";

/**
 * The track requests for `[from, to)`: one per person shown whose share has
 * history and whose devices are shown, none for anyone else.
 */
export function personTrackRequests(
  people: readonly Person[],
  shown: (userId: string) => readonly string[],
  range: { from: string; to: string },
): PersonTrackRequest[] {
  return people.filter(sharesHistory).flatMap((person) => {
    const deviceIds = shown(person.userId);
    return deviceIds.length === 0
      ? []
      : [
          {
            userId: person.userId,
            from: range.from,
            to: range.to,
            deviceIds,
            share: `${person.share.id}:${person.share.historyDays ?? "live"}`,
          },
        ];
  });
}
