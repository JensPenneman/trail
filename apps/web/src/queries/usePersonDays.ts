import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { personDaysResponseSchema } from "@trail/contracts/person";
import { useMemo } from "react";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";
import type { PersonDays } from "../pages/map/history/playback";

/**
 * The days someone recorded something, within the history they share
 * (`GET /api/v1/people/{userId}/days`): one request for the whole window,
 * which counts as one look in their access log, with no positions. Playback
 * takes its next day from it, instead of asking the track of every day. Null
 * asks for nothing. Nothing of it stays cached once it is off screen (as with
 * their tracks), and `person` events refetch it.
 */
export function usePersonDays(userId: string | null, today: string): PersonDays | undefined {
  const query = useQuery({
    queryKey: userId === null ? queryKeys.all.personDays : queryKeys.personDays(userId),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.v1.people.days(userId ?? ""), personDaysResponseSchema, { signal }),
    enabled: userId !== null,
    gcTime: 0,
  });
  const data = query.data;
  return useMemo<PersonDays | undefined>(
    () =>
      data === undefined || userId === null
        ? undefined
        : {
            days: data.days.map((day) => ({ date: day.date, lastAt: day.lastAt })),
            // Their today is theirs: the answer reaches it when its window ends there or later.
            complete: data.window.to >= today,
          },
    [data, userId, today],
  );
}
